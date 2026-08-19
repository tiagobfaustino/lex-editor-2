import { randomUUID } from 'node:crypto';

import {
  DESKTOP_AUDIT_LIMITS,
  type AuditEventDetailDto,
  type AuditEventListItemDto,
  type AuditOriginDto,
  type AuditPageDto,
  type AuditQueryCommand,
  type AuditQueryFilters,
  type AuditTimelineCommand,
  type IncidentDetailDto,
} from '../../shared/ipc/audit.js';
import {
  deriveIncidentAvailableActions,
  deriveIncidentResolutionState,
} from './incident-resolution.js';

export type AuditProviderUnavailableReason =
  | 'not_configured'
  | 'offline'
  | 'timeout'
  | 'access_denied'
  | 'invalid_response'
  | 'integrity_failed';

export type AuditProviderEvent = Readonly<{
  event: AuditEventListItemDto;
  position: string;
}>;

export type AuditProviderPageResult =
  | Readonly<{
      available: true;
      items: readonly AuditProviderEvent[];
      hasMore: boolean;
    }>
  | Readonly<{ available: false; reason: AuditProviderUnavailableReason }>;

export type AuditProviderDetailResult =
  | Readonly<{ available: true; detail: AuditEventDetailDto | null }>
  | Readonly<{ available: false; reason: AuditProviderUnavailableReason }>;

export interface AuditProvider {
  readonly origin: AuditOriginDto;
  list(
    input: Readonly<{
      filters: AuditQueryFilters;
      cutoff: string;
      afterPosition: string | null;
      limit: number;
    }>,
  ): Promise<AuditProviderPageResult>;
  getDetail(eventId: string): Promise<AuditProviderDetailResult>;
}

export type AuditActor = Readonly<{
  actorKey: string;
  actorRole: 'administrador_tecnico';
}>;

export class FederatedAuditError extends Error {
  constructor(
    readonly code:
      | 'cursor_invalid'
      | 'rate_limited'
      | 'event_not_found'
      | 'incident_not_found'
      | 'evidence_not_available',
  ) {
    super(
      code === 'cursor_invalid'
        ? 'A página de auditoria expirou ou não pertence à consulta.'
        : code === 'rate_limited'
          ? 'Muitas consultas de auditoria foram solicitadas.'
          : code === 'event_not_found'
            ? 'O evento de auditoria não está disponível.'
            : code === 'incident_not_found'
              ? 'O incidente não está disponível.'
              : 'O trecho de evidência não está disponível.',
    );
  }
}

type CursorRecord = Readonly<{
  actorKey: string;
  filtersDigest: string;
  cutoff: string;
  positions: ReadonlyMap<AuditOriginDto, string>;
  expiresAt: number;
}>;

const ORIGINS = ['desktop', 'publisher', 'update_worker', 'source_catalog'] as const;
const ORIGIN_ORDER = new Map<AuditOriginDto, number>(
  ORIGINS.map((origin, index) => [origin, index]),
);
const CURSOR_TTL_MS = 5 * 60 * 1_000;
const MAX_CURSOR_RECORDS = 500;
const RATE_WINDOW_MS = 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 60;

const filtersDigest = (filters: AuditQueryFilters): string => JSON.stringify(filters);

const compareProviderEvents = (left: AuditProviderEvent, right: AuditProviderEvent): number => {
  const timestampDifference =
    Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt);
  if (timestampDifference !== 0) return timestampDifference;
  const originDifference =
    (ORIGIN_ORDER.get(left.event.origin) ?? 99) - (ORIGIN_ORDER.get(right.event.origin) ?? 99);
  if (originDifference !== 0) return originDifference;
  const leftNumeric = /^\d+$/u.test(left.position) ? BigInt(left.position) : null;
  const rightNumeric = /^\d+$/u.test(right.position) ? BigInt(right.position) : null;
  if (leftNumeric !== null && rightNumeric !== null && leftNumeric !== rightNumeric) {
    return leftNumeric > rightNumeric ? -1 : 1;
  }
  const positionDifference = right.position.localeCompare(left.position);
  return positionDifference === 0
    ? left.event.eventId.localeCompare(right.event.eventId)
    : positionDifference;
};

export type FederatedAuditService = Readonly<{
  query(actor: AuditActor, command: AuditQueryCommand): Promise<AuditPageDto>;
  getDetail(actor: AuditActor, eventId: string): Promise<AuditEventDetailDto>;
  timeline(actor: AuditActor, command: AuditTimelineCommand): Promise<AuditPageDto>;
  getIncidentDetail(actor: AuditActor, incidentId: string): Promise<IncidentDetailDto>;
}>;

export const createUnavailableAuditProvider = (
  origin: AuditOriginDto,
  reason: AuditProviderUnavailableReason = 'not_configured',
): AuditProvider => ({
  origin,
  list: () => Promise.resolve({ available: false, reason }),
  getDetail: () => Promise.resolve({ available: false, reason }),
});

export const createFederatedAuditService = (
  options: Readonly<{
    providers: readonly AuditProvider[];
    now?: () => Date;
  }>,
): FederatedAuditService => {
  const now = options.now ?? (() => new Date());
  const providerByOrigin = new Map(
    options.providers.map((provider) => [provider.origin, provider]),
  );
  const providers = ORIGINS.map(
    (origin) => providerByOrigin.get(origin) ?? createUnavailableAuditProvider(origin),
  );
  const cursors = new Map<string, CursorRecord>();
  const requestsByActor = new Map<string, number[]>();

  const assertRateLimit = (actorKey: string): void => {
    const currentTime = now().getTime();
    const recent = (requestsByActor.get(actorKey) ?? []).filter(
      (timestamp) => currentTime - timestamp < RATE_WINDOW_MS,
    );
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      throw new FederatedAuditError('rate_limited');
    }
    recent.push(currentTime);
    requestsByActor.set(actorKey, recent);
  };

  const removeExpiredCursors = (): void => {
    const currentTime = now().getTime();
    for (const [id, cursor] of cursors) {
      if (cursor.expiresAt <= currentTime) cursors.delete(id);
    }
    while (cursors.size >= MAX_CURSOR_RECORDS) {
      const oldest = cursors.keys().next().value;
      if (oldest === undefined) break;
      cursors.delete(oldest);
    }
  };

  const query = async (actor: AuditActor, command: AuditQueryCommand): Promise<AuditPageDto> => {
    assertRateLimit(actor.actorKey);
    removeExpiredCursors();
    const digest = filtersDigest(command.filters);
    const saved = command.cursor === null ? undefined : cursors.get(command.cursor);
    if (
      command.cursor !== null &&
      (saved?.actorKey !== actor.actorKey ||
        saved.filtersDigest !== digest ||
        saved.expiresAt <= now().getTime())
    ) {
      throw new FederatedAuditError('cursor_invalid');
    }
    if (command.cursor !== null) cursors.delete(command.cursor);

    const cutoff = saved?.cutoff ?? now().toISOString();
    const positions = new Map(saved?.positions ?? []);
    const providerResults = await Promise.all(
      providers.map(async (provider) => {
        try {
          const result = await provider.list({
            filters: command.filters,
            cutoff,
            afterPosition: positions.get(provider.origin) ?? null,
            limit: command.limit,
          });
          return { provider, result } as const;
        } catch {
          return {
            provider,
            result: { available: false, reason: 'invalid_response' } as const,
          };
        }
      }),
    );

    const available = providerResults.filter(
      (
        item,
      ): item is typeof item & { result: Extract<AuditProviderPageResult, { available: true }> } =>
        item.result.available,
    );
    const unavailableOrigins = providerResults
      .filter(
        (
          item,
        ): item is typeof item & {
          result: Extract<AuditProviderPageResult, { available: false }>;
        } => !item.result.available,
      )
      .map(({ provider, result }) => ({ origin: provider.origin, reason: result.reason }));
    const merged = [...available.flatMap(({ result }) => result.items)].sort(compareProviderEvents);
    const selected = merged.slice(0, command.limit);
    for (const item of selected) positions.set(item.event.origin, item.position);

    const hasUnconsumed = merged.length > selected.length;
    const hasMore = hasUnconsumed || available.some(({ result }) => result.hasMore);
    let nextCursor: string | null = null;
    if (hasMore) {
      nextCursor = randomUUID();
      cursors.set(nextCursor, {
        actorKey: actor.actorKey,
        filtersDigest: digest,
        cutoff,
        positions,
        expiresAt: now().getTime() + CURSOR_TTL_MS,
      });
    }

    const availableOrigins = new Set(available.map(({ provider }) => provider.origin));
    const completeness =
      unavailableOrigins.length === 0
        ? 'complete'
        : availableOrigins.size === 1 && availableOrigins.has('desktop')
          ? 'local_only'
          : 'partial';
    return {
      items: selected.map(({ event }) => event),
      nextCursor,
      queryCutoff: cutoff,
      completeness,
      unavailableOrigins,
    };
  };

  return {
    query,
    async getDetail(actor, eventId) {
      assertRateLimit(actor.actorKey);
      const results = await Promise.all(
        providers.map(async (provider) => {
          try {
            return await provider.getDetail(eventId);
          } catch {
            return { available: false, reason: 'invalid_response' } as const;
          }
        }),
      );
      const detail = results.find(
        (result): result is Extract<AuditProviderDetailResult, { available: true }> =>
          result.available && result.detail !== null,
      );
      if (detail?.detail === null || detail === undefined) {
        throw new FederatedAuditError('event_not_found');
      }
      return detail.detail;
    },
    timeline(actor, command) {
      return query(actor, {
        filters: {
          projectId: null,
          lawId: null,
          module: null,
          level: null,
          category: null,
          eventCode: null,
          correlationId: command.correlationId,
          incidentId: null,
          fromAt: null,
          toAt: null,
          searchText: '',
        },
        cursor: command.cursor,
        limit: command.limit,
      });
    },
    async getIncidentDetail(actor, incidentId) {
      const page = await query(actor, {
        filters: {
          projectId: null,
          lawId: null,
          module: null,
          level: null,
          category: null,
          eventCode: null,
          correlationId: null,
          incidentId,
          fromAt: null,
          toAt: null,
          searchText: '',
        },
        cursor: null,
        limit: DESKTOP_AUDIT_LIMITS.maxTimelineItems,
      });
      if (page.items.length === 0) {
        throw new FederatedAuditError('incident_not_found');
      }
      const resolutionState = deriveIncidentResolutionState(page.items);
      return {
        incidentId,
        resolutionState,
        events: page.items,
        availableActions: deriveIncidentAvailableActions(page.items, resolutionState),
        completeness: page.completeness,
        unavailableOrigins: page.unavailableOrigins,
      };
    },
  };
};
