import { describe, expect, it, vi } from 'vitest';

import {
  createPublisherAuditProvider,
  createSourceCatalogAuditProvider,
  createUpdateWorkerAuditProvider,
  mapSqlError,
  type AuditSqlClient,
} from '../../src/main/audit/remote-audit-provider.js';
import { encodeRemoteAuditEventId } from '../../src/main/audit/remote-audit-event-id.js';
import type { AuditQueryFilters } from '../../src/shared/ipc/audit.js';

type FakeRow = Record<string, unknown>;

const ACTOR_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const LAW_ID = '55555555-5555-4555-8555-555555555555';
const CUTOFF = '2100-01-01T00:00:00.000Z';

const EMPTY_FILTERS: AuditQueryFilters = {
  projectId: null,
  lawId: null,
  module: null,
  level: null,
  category: null,
  eventCode: null,
  correlationId: null,
  incidentId: null,
  fromAt: null,
  toAt: null,
  searchText: '',
};

const sqlError = (code: string, message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code });

class FakeAuditSqlClient implements AuditSqlClient {
  public calls: { text: string; parameters: readonly unknown[] }[] = [];
  private failNext: (Error & { code?: string }) | null = null;

  constructor(
    private readonly tables: Readonly<{
      publication: readonly FakeRow[];
      legislativeUpdate: readonly FakeRow[];
      sourceCatalog: readonly FakeRow[];
      sourceCheck: readonly FakeRow[];
    }>,
    private readonly authorizedActorId: string = ACTOR_ID,
  ) {}

  failNextCall(error: Error & { code?: string }): void {
    this.failNext = error;
  }

  async query<T extends Record<string, unknown>>(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    await Promise.resolve();
    this.calls.push({ text, parameters });
    if (this.failNext !== null) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const [actorUserId] = parameters;
    if (actorUserId !== this.authorizedActorId) {
      throw sqlError('42501', 'active administrator required');
    }

    if (text.includes('list_publication_audit_events')) {
      return this.paginate(this.tables.publication, parameters) as unknown as readonly T[];
    }
    if (text.includes('get_publication_audit_event')) {
      return this.getBySequence(this.tables.publication, parameters) as unknown as readonly T[];
    }
    if (text.includes('list_legislative_update_audit_events')) {
      return this.paginate(this.tables.legislativeUpdate, parameters) as unknown as readonly T[];
    }
    if (text.includes('get_legislative_update_audit_event')) {
      return this.getBySequence(
        this.tables.legislativeUpdate,
        parameters,
      ) as unknown as readonly T[];
    }
    if (text.includes('list_source_catalog_audit_events')) {
      return this.paginate(this.tables.sourceCatalog, parameters) as unknown as readonly T[];
    }
    if (text.includes('get_source_catalog_audit_event')) {
      return this.getBySequence(this.tables.sourceCatalog, parameters) as unknown as readonly T[];
    }
    if (text.includes('list_source_check_audit_events')) {
      return this.paginate(this.tables.sourceCheck, parameters) as unknown as readonly T[];
    }
    if (text.includes('get_source_check_audit_event')) {
      return this.getBySequence(this.tables.sourceCheck, parameters) as unknown as readonly T[];
    }
    throw new Error(`unexpected query: ${text}`);
  }

  private paginate(rows: readonly FakeRow[], parameters: readonly unknown[]): readonly FakeRow[] {
    const [, beforeParameter, cutoffParameter, limitParameter] = parameters;
    const before = beforeParameter === null ? null : BigInt(beforeParameter as string);
    const cutoff = cutoffParameter as string;
    const limit = limitParameter as number;
    return rows
      .filter((row) => {
        const sequence = row['event_sequence'] as bigint;
        const occurredAt = row['occurred_at'] as string;
        return (before === null || sequence < before) && occurredAt <= cutoff;
      })
      .sort((left, right) => {
        const leftSequence = left['event_sequence'] as bigint;
        const rightSequence = right['event_sequence'] as bigint;
        return leftSequence > rightSequence ? -1 : 1;
      })
      .slice(0, limit);
  }

  private getBySequence(
    rows: readonly FakeRow[],
    parameters: readonly unknown[],
  ): readonly FakeRow[] {
    const sequence = BigInt(parameters[1] as string);
    return rows.filter((row) => row['event_sequence'] === sequence);
  }
}

const publicationRow = (sequence: number, overrides: FakeRow = {}): FakeRow => ({
  event_sequence: BigInt(sequence),
  occurred_at: `2026-08-15T12:${String(Math.floor(sequence / 60)).padStart(2, '0')}:${String(
    sequence % 60,
  ).padStart(2, '0')}.000Z`,
  event_level: 'info',
  event_module: 'publication',
  event_origin: 'publisher',
  event_code: 'publication_published',
  display_message: 'Publicação confirmada.',
  actor_role: 'publisher_service',
  law_id: LAW_ID,
  correlation_id: '88888888-8888-4888-8888-888888888888',
  manifest_digest: 'a'.repeat(64),
  git_commit_sha: 'b'.repeat(40),
  failure_code: null,
  ...overrides,
});

const legislativeUpdateRow = (sequence: number, overrides: FakeRow = {}): FakeRow => ({
  event_sequence: BigInt(sequence),
  occurred_at: `2026-08-16T12:00:${String(sequence).padStart(2, '0')}.000Z`,
  event_level: 'info',
  event_module: 'legislative_update',
  event_origin: 'update_worker',
  event_code: 'legislative_update_created',
  display_message: 'Atualização legislativa criada.',
  actor_role: 'update_worker',
  law_id: LAW_ID,
  correlation_id: '99999999-9999-4999-8999-999999999999',
  base_normative_sha256: 'c'.repeat(64),
  candidate_normative_sha256: 'd'.repeat(64),
  detail_code: null,
  ...overrides,
});

const sourceCatalogRow = (sequence: number, overrides: FakeRow = {}): FakeRow => ({
  event_sequence: BigInt(sequence),
  occurred_at: `2026-08-17T12:00:${String(sequence).padStart(2, '0')}.000Z`,
  event_level: 'info',
  event_module: 'source_catalog',
  event_origin: 'source_catalog',
  event_code: 'source_catalog_provider_revision_created',
  display_message: 'Revisão de provedor criada.',
  actor_role: 'source_catalog_admin',
  law_id: LAW_ID,
  correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  source_catalog_entity_type: 'provider',
  provider_revision_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  binding_revision_id: null,
  detail_code: null,
  ...overrides,
});

const sourceCheckRow = (sequence: number, overrides: FakeRow = {}): FakeRow => ({
  event_sequence: BigInt(sequence),
  occurred_at: `2026-08-17T12:30:${String(sequence).padStart(2, '0')}.000Z`,
  event_level: 'info',
  event_module: 'source_catalog',
  event_origin: 'source_catalog',
  event_code: 'source_check_completed',
  display_message: 'Verificação de fonte concluída.',
  actor_role: 'source_catalog_worker',
  law_id: LAW_ID,
  correlation_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  binding_revision_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  detail_code: null,
  ...overrides,
});

describe('mapSqlError', () => {
  it('mapeia SQLSTATE 42501 para access_denied', () => {
    expect(mapSqlError(sqlError('42501', 'nope'))).toBe('access_denied');
  });

  it('mapeia SQLSTATE 22023 para invalid_response', () => {
    expect(mapSqlError(sqlError('22023', 'nope'))).toBe('invalid_response');
  });

  it('reconhece mensagens de timeout', () => {
    expect(mapSqlError(new Error('statement timeout'))).toBe('timeout');
  });

  it('reconhece mensagens de indisponibilidade de rede', () => {
    expect(mapSqlError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe('offline');
  });

  it('usa invalid_response como padrão', () => {
    expect(mapSqlError(new Error('algo inesperado'))).toBe('invalid_response');
    expect(mapSqlError('not an error')).toBe('invalid_response');
  });
});

describe('createPublisherAuditProvider', () => {
  const buildSql = (rows: readonly FakeRow[]) =>
    new FakeAuditSqlClient({
      publication: rows,
      legislativeUpdate: [],
      sourceCatalog: [],
      sourceCheck: [],
    });

  it('reporta not_configured quando não há ator resolvido', async () => {
    const sql = buildSql([publicationRow(1)]);
    const provider = createPublisherAuditProvider({ sql, getActorUserId: () => null });
    const result = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: null,
      limit: 10,
    });
    expect(result).toStrictEqual({ available: false, reason: 'not_configured' });
    expect(sql.calls).toHaveLength(0);
  });

  it('mapeia linhas para o DTO de lista e pagina com cursor antes-de', async () => {
    const sql = buildSql([publicationRow(3), publicationRow(2), publicationRow(1)]);
    const provider = createPublisherAuditProvider({ sql, getActorUserId: () => ACTOR_ID });

    const firstPage = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: null,
      limit: 2,
    });
    expect(firstPage.available).toBe(true);
    if (!firstPage.available) throw new Error('unreachable');
    expect(firstPage.items.map((item) => item.event.eventCode)).toStrictEqual([
      'publication_published',
      'publication_published',
    ]);
    expect(firstPage.items[0]?.event.eventId).toBe(encodeRemoteAuditEventId('publication', 3n));
    expect(firstPage.hasMore).toBe(true);
    const cursor = firstPage.items.at(-1)?.position;
    expect(cursor).toBe('2');

    const secondPage = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: cursor ?? null,
      limit: 2,
    });
    expect(secondPage.available).toBe(true);
    if (!secondPage.available) throw new Error('unreachable');
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.event.eventId).toBe(encodeRemoteAuditEventId('publication', 1n));
    expect(secondPage.hasMore).toBe(false);
  });

  it('continua escaneando páginas até satisfazer o filtro sem perder progresso', async () => {
    const rows: FakeRow[] = [];
    for (let sequence = 250; sequence >= 51; sequence -= 1) {
      rows.push(publicationRow(sequence, { event_code: 'publication_syncing' }));
    }
    for (let sequence = 50; sequence >= 1; sequence -= 1) {
      rows.push(publicationRow(sequence, { event_code: 'publication_published' }));
    }
    const sql = buildSql(rows);
    const provider = createPublisherAuditProvider({ sql, getActorUserId: () => ACTOR_ID });

    const page = await provider.list({
      filters: { ...EMPTY_FILTERS, eventCode: 'publication_published' },
      cutoff: CUTOFF,
      afterPosition: null,
      limit: 5,
    });
    expect(page.available).toBe(true);
    if (!page.available) throw new Error('unreachable');
    expect(page.items).toHaveLength(5);
    expect(page.items.map((item) => item.event.eventId)).toStrictEqual(
      [50, 49, 48, 47, 46].map((sequence) =>
        encodeRemoteAuditEventId('publication', BigInt(sequence)),
      ),
    );
    expect(page.hasMore).toBe(true);
    expect(
      sql.calls.filter((call) => call.text.includes('list_publication_audit_events')),
    ).toHaveLength(2);
  });

  it('reporta indisponibilidade quando a consulta SQL falha', async () => {
    const sql = buildSql([publicationRow(1)]);
    sql.failNextCall(sqlError('22023', 'invalid audit page bounds'));
    const provider = createPublisherAuditProvider({ sql, getActorUserId: () => ACTOR_ID });
    const result = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: null,
      limit: 10,
    });
    expect(result).toStrictEqual({ available: false, reason: 'invalid_response' });
  });

  it('busca o detalhe redigido e normaliza o código estável para minúsculas', async () => {
    const sql = buildSql([publicationRow(1, { failure_code: 'PROMOTION_CONFLICT' })]);
    const provider = createPublisherAuditProvider({ sql, getActorUserId: () => ACTOR_ID });
    const eventId = encodeRemoteAuditEventId('publication', 1n);
    const result = await provider.getDetail(eventId);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('unreachable');
    expect(result.detail).toStrictEqual({
      event: {
        eventId,
        occurredAt: '2026-08-15T12:00:01.000Z',
        level: 'info',
        module: 'publication',
        origin: 'publisher',
        category: 'publication',
        eventCode: 'publication_published',
        message: 'Publicação confirmada.',
        correlationId: '88888888-8888-4888-8888-888888888888',
        actorRole: 'publisher_service',
        lawId: LAW_ID,
        projectId: null,
        runId: null,
        incidentId: null,
        hasEvidence: false,
      },
      detail: {
        kind: 'publication',
        publicationId: '88888888-8888-4888-8888-888888888888',
        manifestDigest: 'a'.repeat(64),
        gitCommitSha: 'b'.repeat(40),
        failureCode: 'promotion_conflict',
      },
    });
  });

  it('retorna detalhe nulo sem consultar o SQL quando o id pertence a outra tabela', async () => {
    const sql = buildSql([publicationRow(1)]);
    const getActorUserId = vi.fn(() => ACTOR_ID);
    const provider = createPublisherAuditProvider({ sql, getActorUserId });
    const result = await provider.getDetail(encodeRemoteAuditEventId('legislative_update', 1n));
    expect(result).toStrictEqual({ available: true, detail: null });
    expect(sql.calls).toHaveLength(0);
    expect(getActorUserId).not.toHaveBeenCalled();
  });

  it('retorna detalhe nulo quando a sequência não existe', async () => {
    const sql = buildSql([publicationRow(1)]);
    const provider = createPublisherAuditProvider({ sql, getActorUserId: () => ACTOR_ID });
    const result = await provider.getDetail(encodeRemoteAuditEventId('publication', 999n));
    expect(result).toStrictEqual({ available: true, detail: null });
  });
});

describe('createUpdateWorkerAuditProvider', () => {
  it('mapeia linhas de atualização legislativa e normaliza detailCode', async () => {
    const sql = new FakeAuditSqlClient({
      publication: [],
      legislativeUpdate: [legislativeUpdateRow(1, { detail_code: 'SOURCE_BINDING_INACTIVE' })],
      sourceCatalog: [],
      sourceCheck: [],
    });
    const provider = createUpdateWorkerAuditProvider({ sql, getActorUserId: () => ACTOR_ID });

    const page = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: null,
      limit: 10,
    });
    expect(page.available).toBe(true);
    if (!page.available) throw new Error('unreachable');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.event.module).toBe('legislative_update');
    expect(page.items[0]?.event.origin).toBe('update_worker');

    const detail = await provider.getDetail(encodeRemoteAuditEventId('legislative_update', 1n));
    expect(detail.available).toBe(true);
    if (!detail.available) throw new Error('unreachable');
    expect(detail.detail?.detail).toStrictEqual({
      kind: 'legislative_update',
      updateId: '99999999-9999-4999-8999-999999999999',
      baseNormativeSha256: 'c'.repeat(64),
      candidateNormativeSha256: 'd'.repeat(64),
      detailCode: 'source_binding_inactive',
    });
  });
});

describe('createSourceCatalogAuditProvider', () => {
  const buildSql = (catalog: readonly FakeRow[], check: readonly FakeRow[]) =>
    new FakeAuditSqlClient({
      publication: [],
      legislativeUpdate: [],
      sourceCatalog: catalog,
      sourceCheck: check,
    });

  it('mescla eventos de catálogo e verificação por ordem cronológica decrescente', async () => {
    const sql = buildSql(
      [
        sourceCatalogRow(1, { occurred_at: '2026-08-17T12:00:01.000Z' }),
        sourceCatalogRow(3, { occurred_at: '2026-08-17T12:00:03.000Z' }),
      ],
      [
        sourceCheckRow(1, { occurred_at: '2026-08-17T12:00:02.000Z' }),
        sourceCheckRow(2, { occurred_at: '2026-08-17T12:00:04.000Z' }),
      ],
    );
    const provider = createSourceCatalogAuditProvider({ sql, getActorUserId: () => ACTOR_ID });

    const page = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: null,
      limit: 10,
    });
    expect(page.available).toBe(true);
    if (!page.available) throw new Error('unreachable');
    expect(page.items.map((item) => item.event.eventId)).toStrictEqual([
      encodeRemoteAuditEventId('source_check', 2n),
      encodeRemoteAuditEventId('source_catalog', 3n),
      encodeRemoteAuditEventId('source_check', 1n),
      encodeRemoteAuditEventId('source_catalog', 1n),
    ]);
    expect(page.hasMore).toBe(false);
  });

  it('pagina com cursor composto sem duplicar nem pular linhas', async () => {
    const sql = buildSql(
      [
        sourceCatalogRow(1, { occurred_at: '2026-08-17T12:00:01.000Z' }),
        sourceCatalogRow(3, { occurred_at: '2026-08-17T12:00:03.000Z' }),
      ],
      [
        sourceCheckRow(1, { occurred_at: '2026-08-17T12:00:02.000Z' }),
        sourceCheckRow(2, { occurred_at: '2026-08-17T12:00:04.000Z' }),
      ],
    );
    const provider = createSourceCatalogAuditProvider({ sql, getActorUserId: () => ACTOR_ID });

    const firstPage = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: null,
      limit: 2,
    });
    expect(firstPage.available).toBe(true);
    if (!firstPage.available) throw new Error('unreachable');
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    const cursor = firstPage.items.at(-1)?.position ?? null;
    expect(cursor).toMatch(/^(?:x|\d+):(?:x|\d+)$/u);

    const secondPage = await provider.list({
      filters: EMPTY_FILTERS,
      cutoff: CUTOFF,
      afterPosition: cursor,
      limit: 5,
    });
    expect(secondPage.available).toBe(true);
    if (!secondPage.available) throw new Error('unreachable');
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.hasMore).toBe(false);

    const allEventIds = [...firstPage.items, ...secondPage.items].map((item) => item.event.eventId);
    expect(new Set(allEventIds).size).toBe(4);
    expect(allEventIds).toStrictEqual([
      encodeRemoteAuditEventId('source_check', 2n),
      encodeRemoteAuditEventId('source_catalog', 3n),
      encodeRemoteAuditEventId('source_check', 1n),
      encodeRemoteAuditEventId('source_catalog', 1n),
    ]);
  });

  it('busca o detalhe de um evento de catálogo preservando o tipo de entidade', async () => {
    const sql = buildSql([sourceCatalogRow(1, { source_catalog_entity_type: 'binding' })], []);
    const provider = createSourceCatalogAuditProvider({ sql, getActorUserId: () => ACTOR_ID });
    const detail = await provider.getDetail(encodeRemoteAuditEventId('source_catalog', 1n));
    expect(detail.available).toBe(true);
    if (!detail.available) throw new Error('unreachable');
    expect(detail.detail?.detail).toStrictEqual({
      kind: 'source_catalog',
      entityType: 'binding',
      entityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      providerRevisionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      bindingRevisionId: null,
      detailCode: null,
    });
  });

  it('busca o detalhe de um evento de verificação com tipo de entidade fixo', async () => {
    const sql = buildSql([], [sourceCheckRow(1, { detail_code: 'SOURCE_TIMEOUT' })]);
    const provider = createSourceCatalogAuditProvider({ sql, getActorUserId: () => ACTOR_ID });
    const detail = await provider.getDetail(encodeRemoteAuditEventId('source_check', 1n));
    expect(detail.available).toBe(true);
    if (!detail.available) throw new Error('unreachable');
    expect(detail.detail?.detail).toStrictEqual({
      kind: 'source_catalog',
      entityType: 'source_check',
      entityId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      providerRevisionId: null,
      bindingRevisionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      detailCode: 'source_timeout',
    });
  });

  it('retorna detalhe nulo sem consultar quando o id pertence a outra tabela remota', async () => {
    const sql = buildSql([], []);
    const provider = createSourceCatalogAuditProvider({ sql, getActorUserId: () => ACTOR_ID });
    const result = await provider.getDetail(encodeRemoteAuditEventId('publication', 1n));
    expect(result).toStrictEqual({ available: true, detail: null });
    expect(sql.calls).toHaveLength(0);
  });
});
