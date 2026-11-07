import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createAuthenticatedDesktopAdapters,
  type AuthenticatedDesktopRemote,
} from '../../src/main/remote/capabilities.js';
import { DesktopIpcError } from '../../src/main/ipc/validated-handler.js';
import { AuditQueryFiltersSchema } from '../../src/shared/ipc/audit.js';
import type { SessionStateDto } from '../../src/shared/ipc/session.js';

const userId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const setup = () => {
  let state: SessionStateDto = {
    sessionState: 'authenticated',
    userId,
    role: 'administrador_tecnico',
  };
  const calls: { path: string; payload: unknown }[] = [];
  const responses: Record<string, unknown> = {};
  let failure: Error | undefined;
  const remote: AuthenticatedDesktopRemote = {
    getState: () => Promise.resolve(state),
    getAccessToken: () => Promise.resolve('individual-token'),
    request<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
      calls.push({ path, payload });
      if (failure !== undefined) return Promise.reject(failure);
      return Promise.resolve(schema.parse(responses[path]));
    },
  };
  return {
    remote,
    calls,
    responses,
    setState(value: SessionStateDto) {
      state = value;
    },
    fail(error: Error) {
      failure = error;
    },
  };
};

describe('authenticated desktop adapters', () => {
  it('uses named catalogue routes without forwarding tokens or actor authority in payloads', async () => {
    const test = setup();
    test.responses['/sources/list'] = { items: [], nextCursor: null };
    const adapters = createAuthenticatedDesktopAdapters(test.remote);
    expect(
      await adapters.sourceCatalogService.listCatalog('individual-token', {
        cursor: null,
        limit: 25,
      }),
    ).toEqual({ items: [], nextCursor: null });
    expect(test.calls).toEqual([{ path: '/sources/list', payload: { cursor: null, limit: 25 } }]);
    await expect(
      adapters.sourceCatalogService.listCatalog('forged-token', { cursor: null, limit: 25 }),
    ).rejects.toThrow();
    expect(test.calls).toHaveLength(1);
  });

  it('keeps failed or unavailable publication evidence unknown', async () => {
    const test = setup();
    const adapters = createAuthenticatedDesktopAdapters(test.remote);
    const identity = { tipoNorma: 'lei ordinária' as const, numero: '9099', ano: 1995 };
    test.responses['/publication/historyEvidence'] = {
      availability: 'available',
      authorityRevision: 'published-1',
      publishedVersionIds: [eventId],
    };
    expect(await adapters.publicationHistoryAuthority.inspect(identity)).toMatchObject({
      availability: 'available',
    });
    expect(test.calls[0]).toEqual({ path: '/publication/historyEvidence', payload: identity });
    test.fail(new DesktopIpcError('NETWORK_FAILED'));
    expect(await adapters.publicationHistoryAuthority.inspect(identity)).toEqual({
      availability: 'unavailable',
      reason: 'offline',
    });
    test.setState({ sessionState: 'not_configured', userId: null, role: null });
    expect(await adapters.publicationHistoryAuthority.inspect(identity)).toEqual({
      availability: 'unavailable',
      reason: 'not_configured',
    });
  });

  it('keeps remote audit unavailable with accurate failure reasons', async () => {
    const test = setup();
    const [provider] = createAuthenticatedDesktopAdapters(test.remote).auditProviders;
    if (provider === undefined) throw new Error('Missing provider');
    const query = {
      filters: {
        lawId: null,
        projectId: null,
        module: null,
        level: null,
        category: null,
        eventCode: null,
        correlationId: null,
        incidentId: null,
        fromAt: null,
        toAt: null,
        searchText: '',
      },
      cutoff: '2026-10-08T00:00:00.000Z',
      afterPosition: null,
      limit: 10,
    };
    test.responses['/audit/list'] = { available: true, items: [], hasMore: false };
    expect(await provider.list(query)).toEqual({ available: true, items: [], hasMore: false });
    test.fail(new DesktopIpcError('NETWORK_TIMEOUT'));
    expect(await provider.list(query)).toEqual({ available: false, reason: 'timeout' });
    test.setState({ sessionState: 'authenticated', userId, role: 'editor_juridico' });
    expect(await provider.list(query)).toEqual({ available: false, reason: 'access_denied' });
  });

  it('delegates only explicit update approval to the supplied preparation callback', async () => {
    const test = setup();
    const decision = {
      updateId: eventId,
      updateReviewStatus: 'approved' as const,
      publicationId: userId,
      retryCount: 0,
      reprocessRequested: false,
    };
    let approvalInput: unknown;
    const adapters = createAuthenticatedDesktopAdapters(test.remote, {
      approveUpdate: (input) => {
        approvalInput = input;
        return Promise.resolve(decision);
      },
    });
    expect(
      await adapters.updateOperations.approve({ updateId: eventId, acknowledged: true }),
    ).toEqual(decision);
    expect(approvalInput).toEqual({ updateId: eventId, acknowledged: true });
    expect(test.calls).toEqual([]);
    await expect(
      createAuthenticatedDesktopAdapters(test.remote).updateOperations.approve({
        updateId: eventId,
        acknowledged: true,
      }),
    ).rejects.toThrow();
  });

  it('rejects a remote audit page from the wrong authority or outside its cutoff', async () => {
    const test = setup();
    const provider = createAuthenticatedDesktopAdapters(test.remote).auditProviders[0];
    if (provider === undefined) throw new Error('Missing provider');
    const query = {
      filters: AuditQueryFiltersSchema.parse({
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
      }),
      cutoff: '2026-10-08T00:00:00.000Z',
      afterPosition: null,
      limit: 10,
    };
    const event = {
      eventId,
      occurredAt: '2026-10-07T00:00:00.000Z',
      level: 'info',
      module: 'publication',
      origin: 'update_worker',
      category: 'publication',
      eventCode: 'publication_published',
      message: 'Publicação concluída.',
      correlationId: userId,
      actorRole: 'editor_juridico',
      lawId: null,
      projectId: null,
      runId: null,
      incidentId: null,
      hasEvidence: false,
    };
    test.responses['/audit/list'] = {
      available: true,
      items: [{ event, position: '1' }],
      hasMore: false,
    };
    expect(await provider.list(query)).toEqual({ available: false, reason: 'invalid_response' });
    test.responses['/audit/list'] = {
      available: true,
      items: [
        {
          event: { ...event, origin: 'publisher', occurredAt: '2026-10-09T00:00:00.000Z' },
          position: '1',
        },
      ],
      hasMore: false,
    };
    expect(await provider.list(query)).toEqual({ available: false, reason: 'invalid_response' });
  });

  it('rejects a mutation response that is bound to a different update', async () => {
    const test = setup();
    test.responses['/updates/reject'] = {
      updateId: userId,
      updateReviewStatus: 'rejected',
      publicationId: null,
      retryCount: 0,
      reprocessRequested: false,
    };
    await expect(
      createAuthenticatedDesktopAdapters(test.remote).updateOperations.reject({
        updateId: eventId,
        reason: 'Não corresponde ao texto oficial.',
      }),
    ).rejects.toThrow();
  });
});
