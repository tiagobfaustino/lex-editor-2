import { describe, expect, it } from 'vitest';

import {
  createFederatedAuditService,
  FederatedAuditError,
  type AuditActor,
  type AuditProvider,
} from '../../src/main/audit/federated-audit-service.js';
import type {
  AuditEventListItemDto,
  AuditOriginDto,
  AuditQueryFilters,
} from '../../src/shared/ipc/audit.js';

const ACTOR: AuditActor = { actorKey: 'actor-1', actorRole: 'administrador_tecnico' };
const OTHER_ACTOR: AuditActor = { actorKey: 'actor-2', actorRole: 'administrador_tecnico' };
const CURSOR_TTL_MS = 5 * 60 * 1_000;

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

const baseEvent: AuditEventListItemDto = {
  eventId: '11111111-1111-4111-8111-111111111111',
  occurredAt: '2026-08-15T12:00:00.000Z',
  level: 'info',
  module: 'publication',
  origin: 'desktop',
  category: 'publication',
  eventCode: 'publication_published',
  message: 'Publicação confirmada.',
  correlationId: '22222222-2222-4222-8222-222222222222',
  actorRole: 'administrador_tecnico',
  lawId: null,
  projectId: null,
  runId: null,
  incidentId: null,
  hasEvidence: false,
};

const buildEvent = (overrides: Partial<AuditEventListItemDto>): AuditEventListItemDto => ({
  ...baseEvent,
  ...overrides,
});

const makeProvider = (
  origin: AuditOriginDto,
  handlers: Partial<Pick<AuditProvider, 'list' | 'getDetail'>> = {},
): AuditProvider => ({
  origin,
  list: handlers.list ?? (() => Promise.resolve({ available: true, items: [], hasMore: false })),
  getDetail: handlers.getDetail ?? (() => Promise.resolve({ available: true, detail: null })),
});

describe('createFederatedAuditService: mesclagem e desempate', () => {
  it('mescla eventos de múltiplos provedores por ordem cronológica decrescente', async () => {
    const desktopEvent = buildEvent({
      eventId: '33333333-3333-4333-8333-333333333333',
      origin: 'desktop',
      occurredAt: '2026-08-15T12:00:02.000Z',
    });
    const publisherEventEarlier = buildEvent({
      eventId: '44444444-4444-4444-8444-444444444444',
      origin: 'publisher',
      occurredAt: '2026-08-15T12:00:01.000Z',
    });
    const publisherEventLatest = buildEvent({
      eventId: '55555555-5555-4555-8555-555555555555',
      origin: 'publisher',
      occurredAt: '2026-08-15T12:00:03.000Z',
    });
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: desktopEvent, position: '1' }],
          hasMore: false,
        }),
    });
    const publisher = makeProvider('publisher', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [
            { event: publisherEventLatest, position: '2' },
            { event: publisherEventEarlier, position: '1' },
          ],
          hasMore: false,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop, publisher] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.items.map((item) => item.eventId)).toStrictEqual([
      publisherEventLatest.eventId,
      desktopEvent.eventId,
      publisherEventEarlier.eventId,
    ]);
  });

  it('desempata relógios idênticos pela ordem de origem (desktop antes de publisher)', async () => {
    const desktopEvent = buildEvent({
      eventId: '33333333-3333-4333-8333-333333333333',
      origin: 'desktop',
      occurredAt: '2026-08-15T12:00:00.000Z',
    });
    const publisherEvent = buildEvent({
      eventId: '44444444-4444-4444-8444-444444444444',
      origin: 'publisher',
      occurredAt: '2026-08-15T12:00:00.000Z',
    });
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: desktopEvent, position: '1' }],
          hasMore: false,
        }),
    });
    const publisher = makeProvider('publisher', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: publisherEvent, position: '1' }],
          hasMore: false,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop, publisher] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.items.map((item) => item.eventId)).toStrictEqual([
      desktopEvent.eventId,
      publisherEvent.eventId,
    ]);
  });

  it('desempata relógio e origem idênticos pela posição numérica decrescente', async () => {
    const lowerPosition = buildEvent({ eventId: '33333333-3333-4333-8333-333333333333' });
    const higherPosition = buildEvent({ eventId: '44444444-4444-4444-8444-444444444444' });
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [
            { event: lowerPosition, position: '3' },
            { event: higherPosition, position: '5' },
          ],
          hasMore: false,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.items.map((item) => item.eventId)).toStrictEqual([
      higherPosition.eventId,
      lowerPosition.eventId,
    ]);
  });

  it('desempata relógio, origem e posição idênticos pelo eventId', async () => {
    const first = buildEvent({ eventId: '11111111-1111-4111-8111-111111111111' });
    const second = buildEvent({ eventId: '99999999-9999-4999-8999-999999999999' });
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [
            { event: second, position: '1' },
            { event: first, position: '1' },
          ],
          hasMore: false,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.items.map((item) => item.eventId)).toStrictEqual([first.eventId, second.eventId]);
  });
});

describe('createFederatedAuditService: disponibilidade e completude', () => {
  it('marca completeness como complete quando todas as origens respondem', async () => {
    const providers = (['desktop', 'publisher', 'update_worker', 'source_catalog'] as const).map(
      (origin) => makeProvider(origin),
    );
    const service = createFederatedAuditService({ providers });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.completeness).toBe('complete');
    expect(page.unavailableOrigins).toStrictEqual([]);
  });

  it('marca completeness como local_only quando só o desktop responde', async () => {
    const desktop = makeProvider('desktop');
    const service = createFederatedAuditService({ providers: [desktop] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.completeness).toBe('local_only');
    expect(page.unavailableOrigins).toHaveLength(3);
  });

  it('marca completeness como partial quando o desktop e outra origem respondem', async () => {
    const desktop = makeProvider('desktop');
    const publisher = makeProvider('publisher');
    const service = createFederatedAuditService({ providers: [desktop, publisher] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.completeness).toBe('partial');
  });

  it('marca completeness como partial quando o desktop está indisponível mas outra origem responde', async () => {
    const publisher = makeProvider('publisher');
    const service = createFederatedAuditService({ providers: [publisher] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.completeness).toBe('partial');
  });

  it('reporta a razão de indisponibilidade sem interromper as demais origens', async () => {
    const desktopEvent = buildEvent({ eventId: '33333333-3333-4333-8333-333333333333' });
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: desktopEvent, position: '1' }],
          hasMore: false,
        }),
    });
    const publisher = makeProvider('publisher', {
      list: () => Promise.resolve({ available: false, reason: 'offline' }),
    });
    const service = createFederatedAuditService({ providers: [desktop, publisher] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.unavailableOrigins).toContainEqual({ origin: 'publisher', reason: 'offline' });
  });

  it('trata exceções não capturadas de um provedor como invalid_response', async () => {
    const desktop = makeProvider('desktop');
    const publisher = makeProvider('publisher', {
      list: () => Promise.reject(new Error('falha inesperada')),
    });
    const service = createFederatedAuditService({ providers: [desktop, publisher] });
    const page = await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 10 });
    expect(page.unavailableOrigins).toContainEqual({
      origin: 'publisher',
      reason: 'invalid_response',
    });
  });
});

describe('createFederatedAuditService: cursores', () => {
  it('pagina corretamente através de duas chamadas com o mesmo cursor', async () => {
    const items = [
      buildEvent({
        eventId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-08-15T12:00:03.000Z',
      }),
      buildEvent({
        eventId: '22222222-2222-4222-8222-222222222222',
        occurredAt: '2026-08-15T12:00:02.000Z',
      }),
      buildEvent({
        eventId: '33333333-3333-4333-8333-333333333333',
        occurredAt: '2026-08-15T12:00:01.000Z',
      }),
    ];
    const desktop = makeProvider('desktop', {
      list: ({ afterPosition, limit }) => {
        const start = afterPosition === null ? 0 : Number(afterPosition);
        const page = items.slice(start, start + limit);
        return Promise.resolve({
          available: true,
          items: page.map((event, index) => ({ event, position: String(start + index + 1) })),
          hasMore: start + page.length < items.length,
        });
      },
    });
    const service = createFederatedAuditService({ providers: [desktop] });

    const firstPage = await service.query(ACTOR, {
      filters: EMPTY_FILTERS,
      cursor: null,
      limit: 2,
    });
    expect(firstPage.items.map((item) => item.eventId)).toStrictEqual([
      items[0]?.eventId,
      items[1]?.eventId,
    ]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await service.query(ACTOR, {
      filters: EMPTY_FILTERS,
      cursor: firstPage.nextCursor,
      limit: 2,
    });
    expect(secondPage.items.map((item) => item.eventId)).toStrictEqual([items[2]?.eventId]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('rejeita um cursor usado por um ator diferente daquele que o emitiu', async () => {
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: buildEvent({}), position: '1' }],
          hasMore: true,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop] });
    const firstPage = await service.query(ACTOR, {
      filters: EMPTY_FILTERS,
      cursor: null,
      limit: 1,
    });
    await expect(
      service.query(OTHER_ACTOR, {
        filters: EMPTY_FILTERS,
        cursor: firstPage.nextCursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'cursor_invalid' });
  });

  it('rejeita um cursor reaproveitado com filtros diferentes dos originais', async () => {
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: buildEvent({}), position: '1' }],
          hasMore: true,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop] });
    const firstPage = await service.query(ACTOR, {
      filters: EMPTY_FILTERS,
      cursor: null,
      limit: 1,
    });
    await expect(
      service.query(ACTOR, {
        filters: { ...EMPTY_FILTERS, searchText: 'outro filtro' },
        cursor: firstPage.nextCursor,
        limit: 1,
      }),
    ).rejects.toThrow(FederatedAuditError);
  });

  it('rejeita um cursor já consumido', async () => {
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: buildEvent({}), position: '1' }],
          hasMore: true,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop] });
    const firstPage = await service.query(ACTOR, {
      filters: EMPTY_FILTERS,
      cursor: null,
      limit: 1,
    });
    await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: firstPage.nextCursor, limit: 1 });
    await expect(
      service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: firstPage.nextCursor, limit: 1 }),
    ).rejects.toMatchObject({ code: 'cursor_invalid' });
  });

  it('rejeita um cursor expirado após o tempo de vida configurado', async () => {
    let currentTime = new Date('2026-08-15T12:00:00.000Z');
    const desktop = makeProvider('desktop', {
      list: () =>
        Promise.resolve({
          available: true,
          items: [{ event: buildEvent({}), position: '1' }],
          hasMore: true,
        }),
    });
    const service = createFederatedAuditService({ providers: [desktop], now: () => currentTime });
    const firstPage = await service.query(ACTOR, {
      filters: EMPTY_FILTERS,
      cursor: null,
      limit: 1,
    });
    currentTime = new Date(currentTime.getTime() + CURSOR_TTL_MS + 1);
    await expect(
      service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: firstPage.nextCursor, limit: 1 }),
    ).rejects.toMatchObject({ code: 'cursor_invalid' });
  });
});

describe('createFederatedAuditService: limite de taxa', () => {
  it('lança rate_limited após exceder o número de consultas permitidas na janela', async () => {
    const desktop = makeProvider('desktop');
    const service = createFederatedAuditService({ providers: [desktop] });
    for (let index = 0; index < 60; index += 1) {
      await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 1 });
    }
    await expect(
      service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 1 }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('não compartilha o limite de taxa entre atores diferentes', async () => {
    const desktop = makeProvider('desktop');
    const service = createFederatedAuditService({ providers: [desktop] });
    for (let index = 0; index < 60; index += 1) {
      await service.query(ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 1 });
    }
    await expect(
      service.query(OTHER_ACTOR, { filters: EMPTY_FILTERS, cursor: null, limit: 1 }),
    ).resolves.toBeDefined();
  });
});

describe('createFederatedAuditService: detalhe e linha do tempo', () => {
  it('retorna o detalhe do primeiro provedor que o encontrar', async () => {
    const detail = {
      event: buildEvent({}),
      detail: {
        kind: 'publication' as const,
        publicationId: '66666666-6666-4666-8666-666666666666',
        manifestDigest: null,
        gitCommitSha: null,
        failureCode: null,
      },
    };
    const desktop = makeProvider('desktop', {
      getDetail: () => Promise.resolve({ available: true, detail: null }),
    });
    const publisher = makeProvider('publisher', {
      getDetail: () => Promise.resolve({ available: true, detail }),
    });
    const service = createFederatedAuditService({ providers: [desktop, publisher] });
    const result = await service.getDetail(ACTOR, baseEvent.eventId);
    expect(result).toStrictEqual(detail);
  });

  it('lança event_not_found quando nenhum provedor encontra o evento', async () => {
    const desktop = makeProvider('desktop');
    const service = createFederatedAuditService({ providers: [desktop] });
    await expect(service.getDetail(ACTOR, baseEvent.eventId)).rejects.toMatchObject({
      code: 'event_not_found',
    });
  });

  it('delega para query aplicando o filtro de correlação da linha do tempo', async () => {
    let capturedFilters: AuditQueryFilters | null = null;
    const desktop = makeProvider('desktop', {
      list: ({ filters }) => {
        capturedFilters = filters;
        return Promise.resolve({ available: true, items: [], hasMore: false });
      },
    });
    const service = createFederatedAuditService({ providers: [desktop] });
    const correlationId = '77777777-7777-4777-8777-777777777777';
    await service.timeline(ACTOR, { correlationId, cursor: null, limit: 50 });
    expect(capturedFilters).toStrictEqual({ ...EMPTY_FILTERS, correlationId });
  });
});
