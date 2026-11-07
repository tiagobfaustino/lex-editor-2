import {
  legalNormIdentitySchema,
  publicationHistoryInspectionSchema,
  type PublicationHistoryAuthority,
} from '@lex-editor/legal-domain';
import {
  activeSourceImportConfigurationSchema,
  lawSourceBindingSchema,
  lawSourceBindingRevisionSchema,
  providerRevisionSchema,
  sourceProviderSchema,
  sourceTestEvidenceSchema,
  sourceCheckRequestResultSchema,
} from '@lex-editor/source-ingestion';
import { z } from 'zod';

import {
  GatewayAuditGetRequestSchema,
  GatewayAuditGetResponseSchema,
  GatewayAuditListRequestSchema,
  GatewayAuditListResponseSchema,
} from '../../../services/desktop-gateway/src/contracts.js';
import type { SourceCatalogService } from '../../../services/source-catalog/src/service.js';
import { SourceCatalogPageDtoSchema } from '../../shared/ipc/sources.js';
import {
  LegislativeUpdateCountsDtoSchema,
  LegislativeUpdateDecisionDtoSchema,
  LegislativeUpdateDetailDtoSchema,
  LegislativeUpdateListDtoSchema,
  LegislativeUpdateIdCommandSchema,
  ListLegislativeUpdatesCommandSchema,
  RejectLegislativeUpdateCommandSchema,
  ApproveLegislativeUpdateCommandSchema,
  type LegislativeUpdateDetailDto,
  type LegislativeUpdateIdCommand,
} from '../../shared/ipc/updates.js';
import type {
  AuditProvider,
  AuditProviderUnavailableReason,
} from '../audit/federated-audit-service.js';
import { decodeRemoteAuditEventId } from '../audit/remote-audit-event-id.js';
import { matchesAuditFilters } from '../audit/audit-filter.js';
import { DesktopIpcError } from '../ipc/validated-handler.js';
import type { ActiveSourceImportResolver } from '../local-project-service.js';
import type { DesktopSession } from '../session/desktop-session.js';
import type { LegislativeUpdateReviewOperations } from '../updates/desktop-service.js';

export type AuthenticatedDesktopRemote = Pick<
  DesktopSession,
  'getAccessToken' | 'getState' | 'request'
>;
export type AuthenticatedDesktopAdapterOptions = Readonly<{
  approveUpdate?: LegislativeUpdateReviewOperations['approve'];
  enrichUpdateDetail?(
    input: LegislativeUpdateIdCommand,
    detail: LegislativeUpdateDetailDto,
  ): Promise<LegislativeUpdateDetailDto>;
}>;

const providerAppendSchema = z.strictObject({
  provider: sourceProviderSchema,
  revision: providerRevisionSchema,
});
const bindingAppendSchema = z.strictObject({
  binding: lawSourceBindingSchema,
  revision: lawSourceBindingRevisionSchema,
});
const activationSchema = z.strictObject({
  provider: sourceProviderSchema,
  binding: lawSourceBindingSchema,
});
const unavailableReason = (error: unknown): AuditProviderUnavailableReason => {
  if (!(error instanceof DesktopIpcError)) return 'invalid_response';
  if (error.code === 'NOT_ALLOWED') return 'access_denied';
  if (error.code === 'NETWORK_TIMEOUT') return 'timeout';
  if (error.code === 'NETWORK_FAILED' || error.code === 'NETWORK_DNS') return 'offline';
  return 'invalid_response';
};

export const createAuthenticatedDesktopAdapters = (
  remote: AuthenticatedDesktopRemote,
  options: AuthenticatedDesktopAdapterOptions = {},
) => {
  const call = async <T>(
    accessToken: string,
    path: string,
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> => {
    if (accessToken !== (await remote.getAccessToken())) throw new DesktopIpcError('NOT_ALLOWED');
    return remote.request(path, input, schema);
  };
  const sourceCatalogService: SourceCatalogService = {
    listCatalog: (token, input) =>
      call(
        token,
        '/sources/list',
        input,
        SourceCatalogPageDtoSchema.omit({ adapterCapabilities: true }),
      ),
    createProviderRevision: (token, input) =>
      call(token, '/sources/createProviderRevision', input, providerAppendSchema),
    createBindingRevision: (token, input) =>
      call(token, '/sources/createBindingRevision', input, bindingAppendSchema),
    dryRunBindingRevision: (token, input) =>
      call(token, '/sources/dryRun', input, sourceTestEvidenceSchema),
    activateBindingRevision: (token, input) =>
      call(token, '/sources/activate', input, activationSchema),
    pauseBinding: (token, input) => call(token, '/sources/pause', input, lawSourceBindingSchema),
    archiveBinding: (token, input) =>
      call(token, '/sources/archive', input, lawSourceBindingSchema),
    restoreBindingRevision: (token, input) =>
      call(token, '/sources/restore', input, activationSchema),
    requestSourceCheck: (token, input) =>
      call(token, '/sources/requestCheck', input, sourceCheckRequestResultSchema),
  };
  const activeSourceImportResolver: ActiveSourceImportResolver = {
    resolve: (sourceUrl) =>
      remote.request(
        '/sources/resolveActive',
        z.strictObject({ sourceUrl: z.url().max(2048) }).parse({ sourceUrl }),
        activeSourceImportConfigurationSchema.nullable(),
      ),
  };
  const publicationHistoryAuthority: PublicationHistoryAuthority = {
    async inspect(identity) {
      const state = await remote.getState();
      if (state.sessionState === 'not_configured')
        return { availability: 'unavailable', reason: 'not_configured' };
      if (state.sessionState !== 'authenticated')
        return { availability: 'unavailable', reason: 'authority_error' };
      try {
        return await remote.request(
          '/publication/historyEvidence',
          legalNormIdentitySchema.parse(identity),
          publicationHistoryInspectionSchema,
        );
      } catch (error) {
        return {
          availability: 'unavailable',
          reason: unavailableReason(error) === 'offline' ? 'offline' : 'authority_error',
        };
      }
    },
  };

  const auditAccess = async (): Promise<AuditProviderUnavailableReason | null> => {
    const state = await remote.getState();
    if (state.sessionState === 'not_configured') return 'not_configured';
    return state.sessionState === 'authenticated' && state.role === 'administrador_tecnico'
      ? null
      : 'access_denied';
  };
  const auditProviders: readonly AuditProvider[] = (
    ['publisher', 'update_worker', 'source_catalog'] as const
  ).map((origin) => ({
    origin,
    async list(input) {
      const denied = await auditAccess();
      if (denied !== null) return { available: false, reason: denied };
      try {
        const result = await remote.request(
          '/audit/list',
          GatewayAuditListRequestSchema.parse({ ...input, origin }),
          GatewayAuditListResponseSchema,
        );
        if (
          result.available &&
          (result.items.length > input.limit ||
            result.items.some(
              ({ event }) =>
                event.origin !== origin || !matchesAuditFilters(event, input.filters, input.cutoff),
            ))
        )
          return { available: false, reason: 'invalid_response' };
        return result;
      } catch (error) {
        return { available: false, reason: unavailableReason(error) };
      }
    },
    async getDetail(eventId) {
      const decoded = decodeRemoteAuditEventId(eventId);
      const belongs =
        decoded !== null &&
        (origin === 'publisher'
          ? decoded.table === 'publication'
          : origin === 'update_worker'
            ? decoded.table === 'legislative_update'
            : decoded.table === 'source_catalog' || decoded.table === 'source_check');
      if (!belongs) return { available: true, detail: null };
      const denied = await auditAccess();
      if (denied !== null) return { available: false, reason: denied };
      try {
        const result = await remote.request(
          '/audit/get',
          GatewayAuditGetRequestSchema.parse({ origin, eventId }),
          GatewayAuditGetResponseSchema,
        );
        if (
          result.available &&
          result.detail !== null &&
          (result.detail.event.origin !== origin || result.detail.event.eventId !== eventId)
        )
          return { available: false, reason: 'invalid_response' };
        return result;
      } catch (error) {
        return { available: false, reason: unavailableReason(error) };
      }
    },
  }));

  const updateOperations: LegislativeUpdateReviewOperations = {
    list: (input) =>
      remote.request(
        '/updates/list',
        ListLegislativeUpdatesCommandSchema.parse(input),
        LegislativeUpdateListDtoSchema,
      ),
    async getDetail(input) {
      const command = LegislativeUpdateIdCommandSchema.parse(input);
      const detail = await remote.request(
        '/updates/getDetail',
        command,
        LegislativeUpdateDetailDtoSchema,
      );
      if (detail.updateId !== command.updateId) throw new DesktopIpcError('FAILED');
      const enriched =
        options.enrichUpdateDetail === undefined
          ? detail
          : LegislativeUpdateDetailDtoSchema.parse(
              await options.enrichUpdateDetail(command, detail),
            );
      if (enriched.updateId !== command.updateId) throw new DesktopIpcError('FAILED');
      return enriched;
    },
    getCounts: () => remote.request('/updates/getCounts', {}, LegislativeUpdateCountsDtoSchema),
    async approve(input) {
      if (options.approveUpdate === undefined) throw new DesktopIpcError('NOT_ALLOWED');
      const command = ApproveLegislativeUpdateCommandSchema.parse(input);
      const decision = LegislativeUpdateDecisionDtoSchema.parse(
        await options.approveUpdate(command),
      );
      if (decision.updateId !== command.updateId) throw new DesktopIpcError('FAILED');
      return decision;
    },
    async reject(input) {
      const command = RejectLegislativeUpdateCommandSchema.parse(input);
      const decision = await remote.request(
        '/updates/reject',
        command,
        LegislativeUpdateDecisionDtoSchema,
      );
      if (decision.updateId !== command.updateId) throw new DesktopIpcError('FAILED');
      return decision;
    },
    async reprocess(input) {
      const command = LegislativeUpdateIdCommandSchema.parse(input);
      const decision = await remote.request(
        '/updates/reprocess',
        command,
        LegislativeUpdateDecisionDtoSchema,
      );
      if (decision.updateId !== command.updateId || !decision.reprocessRequested)
        throw new DesktopIpcError('FAILED');
      return decision;
    },
  };
  return {
    sourceCatalogService,
    activeSourceImportResolver,
    publicationHistoryAuthority,
    auditProviders,
    updateOperations,
  };
};
