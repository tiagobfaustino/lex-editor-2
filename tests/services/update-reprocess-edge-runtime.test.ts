import { ReadableStream } from 'node:stream/web';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => {
  const unsafe =
    vi.fn<(query: string, parameters: string[]) => Promise<readonly Record<string, unknown>[]>>();
  return { unsafe, postgres: vi.fn(() => ({ unsafe })) };
});
vi.mock('postgres', () => ({ default: database.postgres }));

const updateId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const decision = {
  updateId,
  updateReviewStatus: 'error',
  publicationId: null,
  retryCount: 1,
  reprocessRequested: true,
};

const request = (body: string = JSON.stringify({ updateId })) =>
  new Request('https://functions.example/update-reprocess', {
    method: 'POST',
    headers: { authorization: 'Bearer individual-session' },
    body,
  });

const handler = async () =>
  (await import('../../services/update-worker/src/reprocess-request-edge-runtime.js'))
    .handleLegislativeUpdateReprocessRequest;

beforeEach(() => {
  vi.resetModules();
  database.postgres.mockClear();
  database.unsafe.mockReset().mockResolvedValue([{ value: decision }]);
  const environment: Record<string, string> = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_ANON_KEY: 'public-key-for-authentication',
    SUPABASE_DB_URL: 'postgres://private-authority',
  };
  vi.stubGlobal('Deno', { env: { get: (name: string) => environment[name] } });
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ id: actorUserId }))),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('reprocess Edge request boundary', () => {
  it('reuses one database pool and derives the actor from the individual session', async () => {
    const handle = await handler();
    const first = await handle(request());
    const second = await handle(request());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ result: decision });
    expect(database.postgres).toHaveBeenCalledTimes(1);
    expect(database.unsafe).toHaveBeenCalledWith(
      'select private.request_legislative_update_reprocess($1::uuid, $2::uuid) as value',
      [updateId, actorUserId],
    );
  });

  it('forwards an explicit retry identity to the three-argument capability', async () => {
    const result = await (await handler())(request(JSON.stringify({ updateId, requestId })));
    expect(result.status).toBe(200);
    expect(database.unsafe).toHaveBeenCalledWith(
      'select private.request_legislative_update_reprocess($1::uuid, $2::uuid, $3::uuid) as value',
      [updateId, actorUserId, requestId],
    );
  });

  it('rejects unauthenticated input before creating privileged infrastructure', async () => {
    const input = request();
    input.headers.delete('authorization');
    const result = await (await handler())(input);
    expect(result.status).toBe(401);
    expect(database.postgres).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '{',
    JSON.stringify({ updateId, actorUserId }),
    JSON.stringify({ updateId, requestId: 'invalid' }),
  ])('rejects malformed or expanded input before creating a pool: %s', async (body) => {
    const result = await (await handler())(request(body));
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ error: 'invalid_request' });
    expect(database.postgres).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared body without reading it', async () => {
    const input = request();
    input.headers.set('content-length', '1025');
    const result = await (await handler())(input);
    expect(result.status).toBe(422);
    expect(input.bodyUsed).toBe(false);
    expect(database.postgres).not.toHaveBeenCalled();
  });

  it('cancels an oversized streamed body before reading the remainder', async () => {
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new Uint8Array(600));
    });
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const input = new Request('https://functions.example/update-reprocess', {
      method: 'POST',
      headers: { authorization: 'Bearer individual-session' },
      body,
      ...{ duplex: 'half' },
    });
    const result = await (await handler())(input);
    expect(result.status).toBe(422);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(database.postgres).not.toHaveBeenCalled();
  });

  it('does not call the requester when session validation fails', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}, { status: 401 }));
    const result = await (await handler())(request());
    expect(result.status).toBe(401);
    expect(database.unsafe).not.toHaveBeenCalled();
  });

  it('redacts database failures and invalid upstream responses as unavailable', async () => {
    const handle = await handler();
    database.unsafe.mockRejectedValueOnce(new Error('postgres://private-authority secret'));
    const failed = await handle(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'update_reprocess_unavailable' });
    database.unsafe.mockResolvedValueOnce([{ value: { secret: 'private' } }]);
    const invalid = await handle(request());
    expect(invalid.status).toBe(503);
    expect(await invalid.json()).toEqual({ error: 'update_reprocess_unavailable' });
  });
});
