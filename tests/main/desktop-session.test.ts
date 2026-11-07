import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  createDesktopJsonTransport,
  readDesktopConnectionConfig,
  type DesktopConnectionConfig,
  type DesktopJsonTransport,
} from '../../src/main/remote/connection.js';
import { createDesktopSession } from '../../src/main/session/desktop-session.js';

const userId = '11111111-1111-4111-8111-111111111111';
const config: DesktopConnectionConfig = {
  supabaseUrl: 'https://project.supabase.co',
  anonKey: 'sb_publishable_individual-public-key',
  gatewayUrl: 'https://gateway.example/functions/v1/desktop-gateway',
  repositoryRoot: '/tmp/editorial-repository',
  canonicalBranch: 'main',
};
const env = {
  LEX_EDITOR_SUPABASE_URL: config.supabaseUrl,
  LEX_EDITOR_SUPABASE_ANON_KEY: config.anonKey,
  LEX_EDITOR_GATEWAY_URL: config.gatewayUrl,
  LEX_EDITOR_REPOSITORY_ROOT: config.repositoryRoot,
};
const token = (access = 'individual-access-token') => ({
  access_token: access,
  refresh_token: 'individual-refresh-token',
  expires_in: 120,
  user: { id: userId },
});
const identity = { result: { userId, role: 'administrador_tecnico' } };
const signedOut = { sessionState: 'signed_out', userId: null, role: null };
const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

describe('individual desktop session', () => {
  let transport: ReturnType<typeof vi.fn<DesktopJsonTransport>>;
  let now: number;
  beforeEach(() => {
    now = 0;
    transport = vi
      .fn<DesktopJsonTransport>()
      .mockImplementation((url) =>
        Promise.resolve(url.pathname.endsWith('/session/identity') ? identity : token()),
      );
  });

  it('keeps tokens private and gets the role from the authenticated gateway', async () => {
    const session = createDesktopSession(config, { transport, now: () => now });
    expect(await session.getState()).toEqual(signedOut);
    const state = await session.signIn({
      email: 'editor@example.com',
      password: 'private-password',
    });
    expect(state).toEqual({ sessionState: 'authenticated', userId, role: 'administrador_tecnico' });
    expect(JSON.stringify(state)).not.toMatch(/token|password|https:/u);
    expect(session.getActor()).toMatchObject({ userId, role: 'administrador_tecnico' });
    expect(await session.getAccessToken()).toBe('individual-access-token');
    expect(transport.mock.calls[1]?.[2]).toMatchObject({
      Authorization: 'Bearer individual-access-token',
    });
  });

  it.each([
    { result: { userId, role: 'service_role' } },
    { result: { userId: '22222222-2222-4222-8222-222222222222', role: 'editor_juridico' } },
    { result: { userId, role: 'editor_juridico', token: 'secret' } },
  ])('fails closed on an untrusted identity response', async (result) => {
    transport.mockResolvedValueOnce(token()).mockResolvedValueOnce(result);
    const session = createDesktopSession(config, { transport });
    await expect(
      session.signIn({ email: 'editor@example.com', password: 'private-password' }),
    ).rejects.toThrow();
    expect(await session.getState()).toEqual(signedOut);
  });

  it('refreshes once for concurrent callers and validates the refreshed identity', async () => {
    const session = createDesktopSession(config, { transport, now: () => now });
    await session.signIn({ email: 'editor@example.com', password: 'private-password' });
    now = 100_000;
    const pending = defer<unknown>();
    transport.mockImplementationOnce(() => pending.promise);
    const first = session.getAccessToken();
    const second = session.getAccessToken();
    pending.resolve(token('refreshed-access-token'));
    expect(await Promise.all([first, second])).toEqual([
      'refreshed-access-token',
      'refreshed-access-token',
    ]);
    expect(
      transport.mock.calls.filter(
        ([url]) => url.searchParams.get('grant_type') === 'refresh_token',
      ),
    ).toHaveLength(1);
  });

  it('logout prevents an in-flight login from resurrecting a session', async () => {
    const pending = defer<unknown>();
    transport.mockImplementationOnce(() => pending.promise);
    const session = createDesktopSession(config, { transport });
    const login = session.signIn({ email: 'editor@example.com', password: 'private-password' });
    await session.signOut();
    pending.resolve(token());
    await expect(login).rejects.toThrow();
    expect(await session.getState()).toEqual(signedOut);
  });

  it('logout clears state even when remote logout fails and refresh is in flight', async () => {
    const session = createDesktopSession(config, { transport, now: () => now });
    await session.signIn({ email: 'editor@example.com', password: 'private-password' });
    now = 100_000;
    const pending = defer<unknown>();
    transport
      .mockImplementationOnce(() => pending.promise)
      .mockRejectedValueOnce(new Error('secret'));
    const refresh = session.getAccessToken();
    await session.signOut();
    pending.resolve(token('late-token'));
    await expect(refresh).rejects.toThrow();
    expect(await session.getState()).toEqual(signedOut);
  });

  it('clears failed refreshes and never returns an expired token', async () => {
    const session = createDesktopSession(config, { transport, now: () => now });
    await session.signIn({ email: 'editor@example.com', password: 'private-password' });
    now = 130_000;
    transport.mockRejectedValueOnce(new Error('secret'));
    await expect(session.getAccessToken()).rejects.toThrow();
    expect(await session.getState()).toEqual(signedOut);
    expect(session.getActor()).toBeNull();
  });

  it('validates internal capability results and requires a session', async () => {
    const session = createDesktopSession(config, { transport });
    await expect(
      session.request('/updates/getCounts', {}, z.object({ count: z.number() })),
    ).rejects.toThrow();
    await session.signIn({ email: 'editor@example.com', password: 'private-password' });
    transport.mockResolvedValueOnce({ result: { count: 2 } });
    expect(
      await session.request('/updates/getCounts', {}, z.strictObject({ count: z.number() })),
    ).toEqual({ count: 2 });
    expect(transport.mock.calls.at(-1)?.[0].href).toBe(`${config.gatewayUrl}/updates/getCounts`);
    await expect(session.request('//evil.example/path', {}, z.unknown())).rejects.toThrow();
  });

  it('maps publication to its fixed Supabase function and applies route-specific limits', async () => {
    const session = createDesktopSession(config, { transport });
    await session.signIn({ email: 'editor@example.com', password: 'private-password' });
    transport.mockResolvedValue({ result: { accepted: true } });
    const schema = z.strictObject({ accepted: z.boolean() });
    await session.request('/publisher', { action: 'getAttempt', publicationId: userId }, schema);
    expect(transport.mock.calls.at(-1)?.[0].href).toBe(
      `${config.supabaseUrl}/functions/v1/publisher`,
    );
    expect(transport.mock.calls.at(-1)?.[3]).toEqual({
      requestBytes: 16 * 1024,
      responseBytes: 64 * 1024,
    });
    await session.request('/updates/getCandidate', { updateId: userId }, schema);
    expect(transport.mock.calls.at(-1)?.[3]?.responseBytes).toBe(64 * 1024 * 1024);
    await session.request('/updates/approve', { updateId: userId }, schema);
    expect(transport.mock.calls.at(-1)?.[3]?.requestBytes).toBe(64 * 1024 * 1024);
    expect(transport.mock.calls.at(-1)?.[2]).toEqual({
      apikey: config.anonKey,
      Authorization: 'Bearer individual-access-token',
    });
  });

  it('exposes a safe unavailable session when not configured', async () => {
    const session = createDesktopSession(null, { transport });
    expect(await session.getState()).toEqual({ ...signedOut, sessionState: 'not_configured' });
    await expect(
      session.signIn({ email: 'editor@example.com', password: 'private-password' }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not extend token lifetime while waiting for identity validation', async () => {
    transport.mockResolvedValueOnce(token()).mockImplementationOnce(() => {
      now = 121_000;
      return Promise.resolve(identity);
    });
    const session = createDesktopSession(config, { transport, now: () => now });
    await expect(
      session.signIn({ email: 'editor@example.com', password: 'private-password' }),
    ).rejects.toThrow();
    expect(await session.getState()).toEqual(signedOut);
  });

  it('ignores an obsolete login without clearing a newer successful session', async () => {
    const pending = defer<unknown>();
    transport.mockImplementationOnce(() => pending.promise);
    const session = createDesktopSession(config, { transport });
    const first = session.signIn({ email: 'editor@example.com', password: 'old-password' });
    await session.signIn({ email: 'editor@example.com', password: 'new-password' });
    pending.resolve(token('obsolete-access-token'));
    await expect(first).rejects.toThrow();
    expect(await session.getAccessToken()).toBe('individual-access-token');
  });
});

describe('authenticated connection constraints', () => {
  it('parses configuration without placing administrative authority on the station', () => {
    expect(readDesktopConnectionConfig(env)).toEqual(config);
    expect(readDesktopConnectionConfig({})).toBeNull();
    const privileged = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
    for (const key of [privileged, 'sb_secret_administrative-key']) {
      expect(() =>
        readDesktopConnectionConfig({ ...env, LEX_EDITOR_SUPABASE_ANON_KEY: key }),
      ).toThrow();
    }
  });

  it.each([
    'http://gateway.example',
    'https://localhost',
    'https://127.0.0.1',
    'https://192.168.1.2',
    'https://[::1]',
    'https://metadata.google.internal',
    'https://user:password@gateway.example',
    'https://gateway.example?secret=1',
    'https://gateway.example/#secret',
  ])('rejects unsafe configured URLs: %s', (url) => {
    expect(() => readDesktopConnectionConfig({ ...env, LEX_EDITOR_GATEWAY_URL: url })).toThrow();
  });

  it('rejects private DNS, redirects, non-JSON and oversized responses', async () => {
    const send = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{}'),
    });
    const resolveHost = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const post = createDesktopJsonTransport({ resolveHost, send });
    await expect(post(new URL(config.gatewayUrl), {}, {})).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    resolveHost.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    for (const result of [
      { statusCode: 302, headers: { location: 'https://evil.example' }, body: Buffer.from('{}') },
      { statusCode: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('{}') },
      {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.alloc(2 * 1024 * 1024 + 1),
      },
    ]) {
      send.mockResolvedValueOnce(result);
      await expect(post(new URL(config.gatewayUrl), {}, {})).rejects.toThrow();
    }
  });

  it('times out DNS before it can send credentials to a late resolution', async () => {
    vi.useFakeTimers();
    try {
      const pending = defer<readonly { address: string; family: 4 }[]>();
      const send = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{}'),
      });
      const post = createDesktopJsonTransport({ resolveHost: () => pending.promise, send });
      const result = post(
        new URL(config.gatewayUrl),
        {},
        { Authorization: 'Bearer private-session' },
      );
      const rejection = expect(result).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
      pending.resolve([{ address: '8.8.8.8', family: 4 }]);
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces the selected request and response budgets before accepting JSON', async () => {
    const send = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(' '.repeat(1025)),
    });
    const post = createDesktopJsonTransport({
      resolveHost: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
      send,
    });
    await expect(
      post(
        new URL(config.gatewayUrl),
        { value: 'too-large' },
        {},
        { requestBytes: 4, responseBytes: 1024 },
      ),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(send).not.toHaveBeenCalled();
    await expect(
      post(new URL(config.gatewayUrl), {}, {}, { requestBytes: 1024, responseBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'NETWORK_TOO_LARGE' });
    expect(send.mock.calls[0]?.[0]).toMatchObject({ maxBytes: 1024 });
  });
});
