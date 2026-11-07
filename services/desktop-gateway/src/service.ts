import { randomUUID } from 'node:crypto';
import { legislativeStructuralDiffSchema } from '@lex-editor/legal-domain';
import { activeSourceImportConfigurationSchema } from '@lex-editor/source-ingestion';
import { createNodeSourceDryRunRunner } from '@lex-editor/source-ingestion/node';
import { z } from 'zod';

import {
  createPublisherAuditProvider,
  createSourceCatalogAuditProvider,
  createUpdateWorkerAuditProvider,
  type AuditSqlClient,
} from '../../../src/main/audit/remote-audit-provider.js';
import {
  DESKTOP_UPDATE_LIMITS,
  LegislativeUpdateCountsDtoSchema,
  LegislativeUpdateDecisionDtoSchema,
  LegislativeUpdateDetailDtoSchema,
  LegislativeUpdateIdCommandSchema,
  LegislativeUpdateItemDtoSchema,
  LegislativeUpdateListDtoSchema,
  ListLegislativeUpdatesCommandSchema,
  RejectLegislativeUpdateCommandSchema,
} from '../../../src/shared/ipc/updates.js';
import {
  activateBindingRevisionRequestSchema,
  changeBindingActivationRequestSchema,
  createBindingRevisionRequestSchema,
  createProviderRevisionRequestSchema,
  createSourceCatalogAuthority,
  createSourceCatalogDatabase,
  createSourceCatalogImportResolver,
  createSourceCatalogService,
  dryRunBindingRevisionRequestSchema,
  listSourceCatalogRequestSchema,
  requestSourceCheckRequestSchema,
  SourceCatalogAuthorityError,
} from '../../source-catalog/src/index.js';
import {
  ApproveUpdateCandidateRequestSchema,
  GATEWAY_LIMITS,
  GatewayAuditGetRequestSchema,
  GatewayAuditGetResponseSchema,
  GatewayAuditListRequestSchema,
  GatewayAuditListResponseSchema,
  GatewayIdentitySchema,
  PublicationContextSchema,
  PublicationHistoryInspectionResponseSchema,
  PublicationHistoryEvidenceRequestSchema,
  PublicationHistoryRequestSchema,
  PublicationHistoryResponseSchema,
  PublicationIdentityRequestSchema,
  gatewayRequestLimit,
  gatewayResponseLimit,
} from './contracts.js';
import { legislativeCandidateArtifactSchema } from '../../update-worker/src/candidate-artifacts.js';
import { assertPreparedLegislativeCandidate } from './candidate-approval.js';

export interface GatewayAuthenticator {
  authenticate(accessToken: string): Promise<Readonly<{ userId: string }> | null>;
}
export interface DesktopGatewaySqlPorts {
  readonly identity?: AuditSqlClient;
  readonly catalog: AuditSqlClient;
  readonly importer: AuditSqlClient;
  readonly updateEditor: AuditSqlClient;
  readonly auditReader: AuditSqlClient;
  readonly publicationReader: AuditSqlClient;
}
class GatewayError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const profileSchema = z.object({
  user_id: z.uuid(),
  account_status: z.enum(['active', 'suspended']),
  papel: z.enum(['usuario', 'curador', 'administrador']),
});
const empty = z.strictObject({});
const ROUTES = new Set([
  '/session/identity',
  '/sources/list',
  '/sources/createProviderRevision',
  '/sources/createBindingRevision',
  '/sources/dryRun',
  '/sources/activate',
  '/sources/pause',
  '/sources/archive',
  '/sources/restore',
  '/sources/requestCheck',
  '/sources/resolveActive',
  '/audit/list',
  '/audit/get',
  '/updates/list',
  '/updates/getDetail',
  '/updates/getCounts',
  '/updates/reject',
  '/updates/reprocess',
  '/updates/getCandidate',
  '/updates/approve',
  '/publication/context',
  '/publication/history',
  '/publication/historyEvidence',
]);
const response = (
  status: number,
  payload: unknown,
  maximumBytes = GATEWAY_LIMITS.responseBytes,
): Response => {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes)
    throw new GatewayError(503, 'response_too_large');
  return new Response(encoded, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
const readBody = async (request: Request, maximumBytes: number): Promise<unknown> => {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(length) || length < 0 || length > maximumBytes)
    throw new GatewayError(413, 'request_too_large');
  const reader = request.body?.getReader();
  if (reader === undefined) throw new GatewayError(422, 'invalid_request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = (await reader.read()) as { done: boolean; value?: unknown };
      if (chunk.done) break;
      const bytes = z.instanceof(Uint8Array).parse(chunk.value);
      size += bytes.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new GatewayError(413, 'request_too_large');
      }
      chunks.push(bytes);
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(422, 'invalid_request');
  } finally {
    reader.releaseLock();
  }
};
const value = async (
  sql: AuditSqlClient,
  query: string,
  parameters: readonly unknown[],
): Promise<unknown> => {
  const rows = await sql.query(query, parameters);
  if (rows.length !== 1 || rows[0]?.['value'] === undefined)
    throw new GatewayError(503, 'invalid_response');
  return rows[0]['value'];
};
const emptySummary = {
  unchanged: 0,
  amended: 0,
  included: 0,
  revoked: 0,
  renumbered: 0,
  missingPublished: 0,
};
const normalizeItem = (input: unknown) => {
  if (typeof input !== 'object' || input === null) throw new GatewayError(503, 'invalid_response');
  const row = input as Record<string, unknown>;
  return LegislativeUpdateItemDtoSchema.parse({
    ...row,
    summary: row['summary'] ?? emptySummary,
    detectedAt: new Date(String(row['detectedAt'])).toISOString(),
    lastDetectedAt: new Date(String(row['lastDetectedAt'])).toISOString(),
  });
};

// PostgreSQL JSON timestamps include an offset while shared contracts require
// canonical UTC instants. Normalize only timestamp-named fields, never text.
const normalizeDatabaseTimestamps = (input: unknown, key = ''): unknown => {
  if (
    typeof input === 'string' &&
    /(?:At|_at)$/u.test(key) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(input)
  )
    return new Date(input).toISOString();
  if (Array.isArray(input)) return input.map((child) => normalizeDatabaseTimestamps(child));
  if (typeof input === 'object' && input !== null && !(input instanceof Date))
    return Object.fromEntries(
      Object.entries(input).map(([field, child]) => [
        field,
        normalizeDatabaseTimestamps(child, field),
      ]),
    );
  return input;
};
const canonicalTimestampSql = (sql: AuditSqlClient): AuditSqlClient => ({
  async query<T extends Record<string, unknown>>(text: string, parameters?: readonly unknown[]) {
    return (await sql.query(text, parameters)).map((row) => normalizeDatabaseTimestamps(row) as T);
  },
});

export const createDesktopGateway = (options: {
  sql: DesktopGatewaySqlPorts;
  authenticator: GatewayAuthenticator;
  now?: () => Date;
}) => {
  const now = options.now ?? (() => new Date());
  const identitySql = options.sql.identity ?? options.sql.publicationReader;
  const profile = async (userId: string) => {
    const rows = await identitySql.query(
      'select * from private.get_desktop_editor_identity($1::uuid)',
      [userId],
    );
    const raw = rows[0];
    if (rows.length !== 1 || raw === undefined)
      throw new GatewayError(403, 'identity_not_authorized');
    const parsed = profileSchema.parse(raw);
    if (
      parsed.user_id !== userId ||
      parsed.account_status !== 'active' ||
      parsed.papel === 'usuario'
    )
      throw new GatewayError(403, 'identity_not_authorized');
    return parsed;
  };
  const database = createSourceCatalogDatabase(canonicalTimestampSql(options.sql.catalog));
  const identities = {
    async findByUserId(userId: string) {
      const identity = await profile(userId);
      return {
        userId,
        accountStatus: identity.account_status,
        roles: identity.papel === 'administrador' ? ['source_catalog_admin'] : [],
      };
    },
  };
  const catalog = createSourceCatalogService({
    authenticator: options.authenticator,
    authority: createSourceCatalogAuthority({
      identities,
      repository: database.repository,
      dryRun: createNodeSourceDryRunRunner(),
      generateUuid: randomUUID,
      now,
    }),
  });
  const importer = createSourceCatalogImportResolver(canonicalTimestampSql(options.sql.importer));

  const execute = async (
    path: string,
    input: unknown,
    token: string,
    userId: string,
  ): Promise<unknown> => {
    if (path === '/session/identity') {
      empty.parse(input);
      const identity = await profile(userId);
      return GatewayIdentitySchema.parse({
        userId,
        role: identity.papel === 'administrador' ? 'administrador_tecnico' : 'editor_juridico',
      });
    }
    const identity = await profile(userId);
    const admin =
      path.startsWith('/audit/') ||
      (path.startsWith('/sources/') && path !== '/sources/resolveActive');
    if (
      (admin && identity.papel !== 'administrador') ||
      (path.startsWith('/publication/') && identity.papel !== 'curador') ||
      (path.startsWith('/updates/') &&
        identity.papel !== 'curador' &&
        path !== '/updates/reprocess' &&
        path !== '/updates/getCandidate')
    )
      throw new GatewayError(403, 'identity_not_authorized');
    switch (path) {
      case '/sources/list':
        return catalog.listCatalog(token, listSourceCatalogRequestSchema.parse(input));
      case '/sources/createProviderRevision':
        return catalog.createProviderRevision(
          token,
          createProviderRevisionRequestSchema.parse(input),
        );
      case '/sources/createBindingRevision':
        return catalog.createBindingRevision(
          token,
          createBindingRevisionRequestSchema.parse(input),
        );
      case '/sources/dryRun':
        return catalog.dryRunBindingRevision(
          token,
          dryRunBindingRevisionRequestSchema.parse(input),
        );
      case '/sources/activate':
        return catalog.activateBindingRevision(
          token,
          activateBindingRevisionRequestSchema.parse(input),
        );
      case '/sources/pause':
        return catalog.pauseBinding(token, changeBindingActivationRequestSchema.parse(input));
      case '/sources/archive':
        return catalog.archiveBinding(token, changeBindingActivationRequestSchema.parse(input));
      case '/sources/restore':
        return catalog.restoreBindingRevision(
          token,
          activateBindingRevisionRequestSchema.parse(input),
        );
      case '/sources/requestCheck':
        return catalog.requestSourceCheck(token, requestSourceCheckRequestSchema.parse(input));
      case '/sources/resolveActive': {
        const command = z.strictObject({ sourceUrl: z.url().max(2048) }).parse(input);
        return activeSourceImportConfigurationSchema
          .nullable()
          .parse(await importer.resolve(command.sourceUrl));
      }
      case '/audit/list': {
        const command = GatewayAuditListRequestSchema.parse(input);
        const create =
          command.origin === 'publisher'
            ? createPublisherAuditProvider
            : command.origin === 'update_worker'
              ? createUpdateWorkerAuditProvider
              : createSourceCatalogAuditProvider;
        return GatewayAuditListResponseSchema.parse(
          await create({ sql: options.sql.auditReader, getActorUserId: () => userId }).list(
            command,
          ),
        );
      }
      case '/audit/get': {
        const command = GatewayAuditGetRequestSchema.parse(input);
        const create =
          command.origin === 'publisher'
            ? createPublisherAuditProvider
            : command.origin === 'update_worker'
              ? createUpdateWorkerAuditProvider
              : createSourceCatalogAuditProvider;
        return GatewayAuditGetResponseSchema.parse(
          await create({ sql: options.sql.auditReader, getActorUserId: () => userId }).getDetail(
            command.eventId,
          ),
        );
      }
      case '/updates/list': {
        const command = ListLegislativeUpdatesCommandSchema.parse(input);
        const rows = z
          .array(z.unknown())
          .parse(
            await value(
              options.sql.updateEditor,
              'select private.list_legislative_updates($1::text, $2::integer, $3::timestamptz) as value',
              [command.updateReviewStatus, command.limit, command.cursor],
            ),
          );
        const items = rows.map(normalizeItem);
        return LegislativeUpdateListDtoSchema.parse({
          items,
          nextCursor: items.length === command.limit ? (items.at(-1)?.detectedAt ?? null) : null,
        });
      }
      case '/updates/getDetail': {
        const command = LegislativeUpdateIdCommandSchema.parse(input);
        const raw = z
          .object({ diff: legislativeStructuralDiffSchema.nullable(), baseVersionId: z.uuid() })
          .loose()
          .parse(
            await value(
              options.sql.updateEditor,
              'select private.get_legislative_update($1::uuid) as value',
              [command.updateId],
            ),
          );
        // The private detail RPC deliberately omits list-only counts. Obtain
        // its safe list projection by ID through a dedicated closed read.
        const item = normalizeItem(
          await value(
            options.sql.publicationReader,
            'select private.get_desktop_update_list_item($1::uuid, $2::uuid) as value',
            [userId, command.updateId],
          ),
        );
        const entries = (raw.diff?.entries ?? [])
          .slice(0, DESKTOP_UPDATE_LIMITS.maxDiffEntries)
          .map((entry) => ({
            ...entry,
            before:
              entry.before === null
                ? null
                : {
                    blockId: entry.before.blockId,
                    path: entry.before.path.map((part) => part.label),
                    text: entry.before.text,
                    deviceStatus: entry.before.deviceStatus,
                  },
            after:
              entry.after === null
                ? null
                : {
                    blockId: entry.after.blockId,
                    path: entry.after.path.map((part) => part.label),
                    text: entry.after.text,
                    deviceStatus: entry.after.deviceStatus,
                  },
          }));
        return LegislativeUpdateDetailDtoSchema.parse({
          ...item,
          baseVersionId: raw.baseVersionId,
          entries,
          missingPublishedBlockIds: (raw.diff?.missingPublished ?? [])
            .slice(0, DESKTOP_UPDATE_LIMITS.maxDiffEntries)
            .map((part) => part.blockId),
          truncated:
            (raw.diff?.entries.length ?? 0) > entries.length ||
            (raw.diff?.missingPublished.length ?? 0) > DESKTOP_UPDATE_LIMITS.maxDiffEntries,
        });
      }
      case '/updates/getCounts':
        empty.parse(input);
        return LegislativeUpdateCountsDtoSchema.parse(
          await value(
            options.sql.updateEditor,
            'select private.count_legislative_updates() as value',
            [],
          ),
        );
      case '/updates/getCandidate': {
        const command = LegislativeUpdateIdCommandSchema.parse(input);
        return legislativeCandidateArtifactSchema.parse(
          await value(
            options.sql.updateEditor,
            'select private.get_legislative_update_candidate($1::uuid, $2::uuid) as value',
            [command.updateId, userId],
          ),
        );
      }
      case '/updates/approve': {
        const command = ApproveUpdateCandidateRequestSchema.parse(input);
        const candidate = legislativeCandidateArtifactSchema.parse(
          await value(
            options.sql.updateEditor,
            'select private.get_legislative_update_candidate($1::uuid, $2::uuid) as value',
            [command.updateId, userId],
          ),
        );
        try {
          assertPreparedLegislativeCandidate({ ...command, userId, candidate });
        } catch {
          throw new GatewayError(409, 'candidate_mismatch');
        }
        return LegislativeUpdateDecisionDtoSchema.parse(
          await value(
            options.sql.updateEditor,
            'select private.approve_legislative_update_candidate($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text) as value',
            [
              command.updateId,
              userId,
              command.publicationId,
              candidate.candidateArtifactId,
              command.manifestCanonical,
            ],
          ),
        );
      }
      case '/updates/reject': {
        const command = RejectLegislativeUpdateCommandSchema.parse(input);
        return LegislativeUpdateDecisionDtoSchema.parse(
          await value(
            options.sql.updateEditor,
            'select private.decide_legislative_update($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid) as value',
            [command.updateId, userId, 'rejected', command.reason, null],
          ),
        );
      }
      case '/updates/reprocess': {
        const command = LegislativeUpdateIdCommandSchema.extend({
          requestId: z.uuid().optional(),
        }).parse(input);
        return LegislativeUpdateDecisionDtoSchema.parse(
          await value(
            options.sql.updateEditor,
            command.requestId === undefined
              ? 'select private.request_legislative_update_reprocess($1::uuid, $2::uuid) as value'
              : 'select private.request_legislative_update_reprocess($1::uuid, $2::uuid, $3::uuid) as value',
            command.requestId === undefined
              ? [command.updateId, userId]
              : [command.updateId, userId, command.requestId],
          ),
        );
      }
      case '/publication/context': {
        const command = PublicationIdentityRequestSchema.parse(input);
        const context = await value(
          options.sql.publicationReader,
          'select private.get_desktop_publication_context($1::uuid, $2::text, $3::text, $4::integer, $5::text) as value',
          [userId, command.tipoNorma, command.numero, command.ano, command.sigla],
        );
        if (context === null) throw new GatewayError(404, 'law_not_registered');
        return PublicationContextSchema.parse(context);
      }
      case '/publication/history': {
        const command = PublicationHistoryRequestSchema.parse(input);
        return PublicationHistoryResponseSchema.parse(
          await value(
            options.sql.publicationReader,
            'select private.list_desktop_publication_history($1::uuid, $2::uuid, $3::integer, $4::integer) as value',
            [
              userId,
              command.lawId,
              command.cursor === null ? null : Number(command.cursor),
              command.limit,
            ],
          ),
        );
      }
      case '/publication/historyEvidence': {
        const command = PublicationHistoryEvidenceRequestSchema.parse(input);
        return PublicationHistoryInspectionResponseSchema.parse(
          await value(
            options.sql.publicationReader,
            'select private.inspect_desktop_publication_history($1::uuid, $2::text, $3::text, $4::integer, $5::text) as value',
            [userId, command.tipoNorma, command.numero, command.ano, command.sigla ?? null],
          ),
        );
      }
      default:
        throw new GatewayError(404, 'route_not_found');
    }
  };
  return {
    async fetch(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        if (!ROUTES.has(url.pathname) || url.search.length > 0)
          throw new GatewayError(404, 'route_not_found');
        if (request.method !== 'POST') throw new GatewayError(405, 'method_not_allowed');
        const token = /^Bearer ([^\s]{16,16384})$/u.exec(
          request.headers.get('authorization') ?? '',
        )?.[1];
        if (token === undefined) throw new GatewayError(401, 'authentication_required');
        const input = await readBody(request, gatewayRequestLimit(url.pathname));
        const actor = await options.authenticator.authenticate(token);
        if (actor === null) throw new GatewayError(401, 'authentication_required');
        const userId = z.uuid().parse(actor.userId);
        return response(
          200,
          { result: await execute(url.pathname, input, token, userId) },
          gatewayResponseLimit(url.pathname),
        );
      } catch (error) {
        if (error instanceof GatewayError) return response(error.httpStatus, { error: error.code });
        if (error instanceof z.ZodError) return response(422, { error: 'invalid_request' });
        if (error instanceof SourceCatalogAuthorityError)
          return response(error.code === 'identity_not_authorized' ? 403 : 409, {
            error: error.code,
          });
        const code =
          typeof error === 'object' && error !== null
            ? (error as Record<string, unknown>)['code']
            : null;
        if (code === '42501') return response(403, { error: 'identity_not_authorized' });
        if (code === 'P0002') return response(404, { error: 'not_found' });
        return response(503, { error: 'gateway_unavailable' });
      }
    },
  };
};
