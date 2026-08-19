import {
  AuditEventDetailDtoSchema,
  AuditEventListItemDtoSchema,
  type AuditEventDetailDataDto,
  type AuditEventListItemDto,
  type AuditOriginDto,
} from '../../shared/ipc/audit.js';
import { matchesAuditFilters } from './audit-filter.js';
import type {
  AuditProvider,
  AuditProviderDetailResult,
  AuditProviderEvent,
  AuditProviderPageResult,
  AuditProviderUnavailableReason,
} from './federated-audit-service.js';
import {
  decodeRemoteAuditEventId,
  encodeRemoteAuditEventId,
  type RemoteAuditTable,
} from './remote-audit-event-id.js';

export interface AuditSqlClient {
  query<T extends Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
}

export type GetAuditActorUserId = () => string | null | Promise<string | null>;

const SQL_PAGE_SIZE = 200;
const MAX_SCAN_ROUND_TRIPS = 50;
const POSITION_PLACEHOLDER = 'x';

const sqlErrorCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
};

export const mapSqlError = (error: unknown): AuditProviderUnavailableReason => {
  const code = sqlErrorCode(error);
  if (code === '42501') return 'access_denied';
  if (code === '22023') return 'invalid_response';
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/iu.test(message)) return 'timeout';
  if (/(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|offline)/iu.test(message)) return 'offline';
  return 'invalid_response';
};

const toSequence = (value: unknown): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/u.test(value)) return BigInt(value);
  throw new TypeError('invalid remote audit sequence');
};

const toTimestamp = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid remote audit timestamp');
  return date.toISOString();
};

const toStableCode = (value: unknown): string | null =>
  typeof value === 'string' ? value.toLowerCase() : null;

const sequenceParam = (value: bigint | null): string | null =>
  value === null ? null : value.toString();

type SingleTableProviderOptions = Readonly<{
  origin: AuditOriginDto;
  table: RemoteAuditTable;
  sql: AuditSqlClient;
  getActorUserId: GetAuditActorUserId;
  listSql: string;
  getSql: string;
  toListEvent(row: Record<string, unknown>): AuditEventListItemDto;
  toDetail(row: Record<string, unknown>): AuditEventDetailDataDto;
}>;

const createSingleTableAuditProvider = (options: SingleTableProviderOptions): AuditProvider => ({
  origin: options.origin,
  async list({ filters, cutoff, afterPosition, limit }): Promise<AuditProviderPageResult> {
    const actorUserId = await options.getActorUserId();
    if (actorUserId === null) return { available: false, reason: 'not_configured' };
    try {
      const items: AuditProviderEvent[] = [];
      let before = afterPosition === null ? null : toSequence(afterPosition);
      for (let round = 0; round < MAX_SCAN_ROUND_TRIPS && items.length < limit; round += 1) {
        const rows = await options.sql.query(options.listSql, [
          actorUserId,
          sequenceParam(before),
          cutoff,
          SQL_PAGE_SIZE,
        ]);
        if (rows.length === 0) return { available: true, items, hasMore: false };
        for (const row of rows) {
          const event = options.toListEvent(row);
          before = toSequence(row['event_sequence']);
          if (matchesAuditFilters(event, filters, cutoff)) {
            items.push({ event, position: before.toString() });
            if (items.length >= limit) break;
          }
        }
        if (items.length >= limit) return { available: true, items, hasMore: true };
        if (rows.length < SQL_PAGE_SIZE) return { available: true, items, hasMore: false };
      }
      return { available: true, items, hasMore: true };
    } catch (error) {
      return { available: false, reason: mapSqlError(error) };
    }
  },
  async getDetail(eventId): Promise<AuditProviderDetailResult> {
    const decoded = decodeRemoteAuditEventId(eventId);
    if (decoded?.table !== options.table) return { available: true, detail: null };
    const actorUserId = await options.getActorUserId();
    if (actorUserId === null) return { available: false, reason: 'not_configured' };
    try {
      const rows = await options.sql.query(options.getSql, [
        actorUserId,
        decoded.sequence.toString(),
      ]);
      const row = rows[0];
      if (row === undefined) return { available: true, detail: null };
      return {
        available: true,
        detail: AuditEventDetailDtoSchema.parse({
          event: options.toListEvent(row),
          detail: options.toDetail(row),
        }),
      };
    } catch (error) {
      return { available: false, reason: mapSqlError(error) };
    }
  },
});

const LIST_PUBLICATION_SQL = 'select * from private.list_publication_audit_events($1, $2, $3, $4)';
const GET_PUBLICATION_SQL = 'select * from private.get_publication_audit_event($1, $2)';

const toPublicationListEvent = (row: Record<string, unknown>): AuditEventListItemDto =>
  AuditEventListItemDtoSchema.parse({
    eventId: encodeRemoteAuditEventId('publication', toSequence(row['event_sequence'])),
    occurredAt: toTimestamp(row['occurred_at']),
    level: row['event_level'],
    module: row['event_module'],
    origin: row['event_origin'],
    category: 'publication',
    eventCode: row['event_code'],
    message: row['display_message'],
    correlationId: row['correlation_id'],
    actorRole: row['actor_role'],
    lawId: row['law_id'],
    projectId: null,
    runId: null,
    incidentId: null,
    hasEvidence: false,
  });

export const createPublisherAuditProvider = (
  options: Readonly<{ sql: AuditSqlClient; getActorUserId: GetAuditActorUserId }>,
): AuditProvider =>
  createSingleTableAuditProvider({
    origin: 'publisher',
    table: 'publication',
    sql: options.sql,
    getActorUserId: options.getActorUserId,
    listSql: LIST_PUBLICATION_SQL,
    getSql: GET_PUBLICATION_SQL,
    toListEvent: toPublicationListEvent,
    toDetail: (row) => ({
      kind: 'publication',
      publicationId: row['correlation_id'] as string,
      manifestDigest: (row['manifest_digest'] as string | null) ?? null,
      gitCommitSha: (row['git_commit_sha'] as string | null) ?? null,
      failureCode: toStableCode(row['failure_code']),
    }),
  });

const LIST_LEGISLATIVE_UPDATE_SQL =
  'select * from private.list_legislative_update_audit_events($1, $2, $3, $4)';
const GET_LEGISLATIVE_UPDATE_SQL =
  'select * from private.get_legislative_update_audit_event($1, $2)';

const toLegislativeUpdateListEvent = (row: Record<string, unknown>): AuditEventListItemDto =>
  AuditEventListItemDtoSchema.parse({
    eventId: encodeRemoteAuditEventId('legislative_update', toSequence(row['event_sequence'])),
    occurredAt: toTimestamp(row['occurred_at']),
    level: row['event_level'],
    module: row['event_module'],
    origin: row['event_origin'],
    category: 'legislative_update',
    eventCode: row['event_code'],
    message: row['display_message'],
    correlationId: row['correlation_id'],
    actorRole: row['actor_role'],
    lawId: row['law_id'],
    projectId: null,
    runId: null,
    incidentId: null,
    hasEvidence: false,
  });

export const createUpdateWorkerAuditProvider = (
  options: Readonly<{ sql: AuditSqlClient; getActorUserId: GetAuditActorUserId }>,
): AuditProvider =>
  createSingleTableAuditProvider({
    origin: 'update_worker',
    table: 'legislative_update',
    sql: options.sql,
    getActorUserId: options.getActorUserId,
    listSql: LIST_LEGISLATIVE_UPDATE_SQL,
    getSql: GET_LEGISLATIVE_UPDATE_SQL,
    toListEvent: toLegislativeUpdateListEvent,
    toDetail: (row) => ({
      kind: 'legislative_update',
      updateId: row['correlation_id'] as string,
      baseNormativeSha256: (row['base_normative_sha256'] as string | null) ?? null,
      candidateNormativeSha256: (row['candidate_normative_sha256'] as string | null) ?? null,
      detailCode: toStableCode(row['detail_code']),
    }),
  });

const LIST_SOURCE_CATALOG_SQL =
  'select * from private.list_source_catalog_audit_events($1, $2, $3, $4)';
const GET_SOURCE_CATALOG_SQL = 'select * from private.get_source_catalog_audit_event($1, $2)';
const LIST_SOURCE_CHECK_SQL =
  'select * from private.list_source_check_audit_events($1, $2, $3, $4)';
const GET_SOURCE_CHECK_SQL = 'select * from private.get_source_check_audit_event($1, $2)';

const toSourceCatalogListEvent = (
  table: Extract<RemoteAuditTable, 'source_catalog' | 'source_check'>,
  row: Record<string, unknown>,
): AuditEventListItemDto =>
  AuditEventListItemDtoSchema.parse({
    eventId: encodeRemoteAuditEventId(table, toSequence(row['event_sequence'])),
    occurredAt: toTimestamp(row['occurred_at']),
    level: row['event_level'],
    module: row['event_module'],
    origin: row['event_origin'],
    category: 'source_catalog',
    eventCode: row['event_code'],
    message: row['display_message'],
    correlationId: row['correlation_id'],
    actorRole: row['actor_role'],
    lawId: row['law_id'],
    projectId: null,
    runId: null,
    incidentId: null,
    hasEvidence: false,
  });

const decodeCompositePosition = (
  position: string | null,
): Readonly<{ catalogBefore: bigint | null; checkBefore: bigint | null }> => {
  if (position === null) return { catalogBefore: null, checkBefore: null };
  const [catalogPart, checkPart] = position.split(':');
  return {
    catalogBefore:
      catalogPart === undefined || catalogPart === POSITION_PLACEHOLDER
        ? null
        : BigInt(catalogPart),
    checkBefore:
      checkPart === undefined || checkPart === POSITION_PLACEHOLDER ? null : BigInt(checkPart),
  };
};

const encodeCompositePosition = (
  catalogBefore: bigint | null,
  checkBefore: bigint | null,
): string =>
  `${catalogBefore?.toString() ?? POSITION_PLACEHOLDER}:${checkBefore?.toString() ?? POSITION_PLACEHOLDER}`;

export const createSourceCatalogAuditProvider = (
  options: Readonly<{ sql: AuditSqlClient; getActorUserId: GetAuditActorUserId }>,
): AuditProvider => ({
  origin: 'source_catalog',
  async list({ filters, cutoff, afterPosition, limit }): Promise<AuditProviderPageResult> {
    const actorUserId = await options.getActorUserId();
    if (actorUserId === null) return { available: false, reason: 'not_configured' };
    try {
      const items: AuditProviderEvent[] = [];
      let { catalogBefore, checkBefore } = decodeCompositePosition(afterPosition);
      let catalogExhausted = false;
      let checkExhausted = false;
      for (
        let round = 0;
        round < MAX_SCAN_ROUND_TRIPS &&
        items.length < limit &&
        !(catalogExhausted && checkExhausted);
        round += 1
      ) {
        const [catalogRows, checkRows] = await Promise.all([
          catalogExhausted
            ? Promise.resolve([] as readonly Record<string, unknown>[])
            : options.sql.query(LIST_SOURCE_CATALOG_SQL, [
                actorUserId,
                sequenceParam(catalogBefore),
                cutoff,
                SQL_PAGE_SIZE,
              ]),
          checkExhausted
            ? Promise.resolve([] as readonly Record<string, unknown>[])
            : options.sql.query(LIST_SOURCE_CHECK_SQL, [
                actorUserId,
                sequenceParam(checkBefore),
                cutoff,
                SQL_PAGE_SIZE,
              ]),
        ]);
        if (catalogRows.length < SQL_PAGE_SIZE) catalogExhausted = true;
        if (checkRows.length < SQL_PAGE_SIZE) checkExhausted = true;

        const candidates = [
          ...catalogRows.map((row) => ({
            table: 'source_catalog' as const,
            sequence: toSequence(row['event_sequence']),
            event: toSourceCatalogListEvent('source_catalog', row),
          })),
          ...checkRows.map((row) => ({
            table: 'source_check' as const,
            sequence: toSequence(row['event_sequence']),
            event: toSourceCatalogListEvent('source_check', row),
          })),
        ].sort((left, right) => {
          if (left.event.occurredAt !== right.event.occurredAt) {
            return right.event.occurredAt.localeCompare(left.event.occurredAt);
          }
          if (left.sequence !== right.sequence) return left.sequence > right.sequence ? -1 : 1;
          return left.table.localeCompare(right.table);
        });

        for (const candidate of candidates) {
          if (candidate.table === 'source_catalog') catalogBefore = candidate.sequence;
          else checkBefore = candidate.sequence;
          if (matchesAuditFilters(candidate.event, filters, cutoff)) {
            items.push({
              event: candidate.event,
              position: encodeCompositePosition(catalogBefore, checkBefore),
            });
            if (items.length >= limit) break;
          }
        }
      }
      const hasMore = items.length >= limit || !(catalogExhausted && checkExhausted);
      return { available: true, items, hasMore };
    } catch (error) {
      return { available: false, reason: mapSqlError(error) };
    }
  },
  async getDetail(eventId): Promise<AuditProviderDetailResult> {
    const decoded = decodeRemoteAuditEventId(eventId);
    if (
      decoded === null ||
      (decoded.table !== 'source_catalog' && decoded.table !== 'source_check')
    ) {
      return { available: true, detail: null };
    }
    const actorUserId = await options.getActorUserId();
    if (actorUserId === null) return { available: false, reason: 'not_configured' };
    try {
      const rows = await options.sql.query(
        decoded.table === 'source_catalog' ? GET_SOURCE_CATALOG_SQL : GET_SOURCE_CHECK_SQL,
        [actorUserId, decoded.sequence.toString()],
      );
      const row = rows[0];
      if (row === undefined) return { available: true, detail: null };
      const detail: AuditEventDetailDataDto =
        decoded.table === 'source_catalog'
          ? {
              kind: 'source_catalog',
              entityType: row['source_catalog_entity_type'] as 'provider' | 'binding',
              entityId: row['correlation_id'] as string,
              providerRevisionId: (row['provider_revision_id'] as string | null) ?? null,
              bindingRevisionId: (row['binding_revision_id'] as string | null) ?? null,
              detailCode: toStableCode(row['detail_code']),
            }
          : {
              kind: 'source_catalog',
              entityType: 'source_check',
              entityId: row['correlation_id'] as string,
              providerRevisionId: null,
              bindingRevisionId: (row['binding_revision_id'] as string | null) ?? null,
              detailCode: toStableCode(row['detail_code']),
            };
      return {
        available: true,
        detail: AuditEventDetailDtoSchema.parse({
          event: toSourceCatalogListEvent(decoded.table, row),
          detail,
        }),
      };
    } catch (error) {
      return { available: false, reason: mapSqlError(error) };
    }
  },
});
