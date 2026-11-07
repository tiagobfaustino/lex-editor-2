import { z } from 'zod';
import {
  gatewayRequestLimit,
  gatewayResponseLimit,
} from '../../../services/desktop-gateway/src/contracts.js';

import {
  SessionRoleSchema,
  SessionSignInCommandSchema,
  type SessionSignInCommand,
  type SessionStateDto,
  type SessionRole,
} from '../../shared/ipc/session.js';
import type { DesktopSessionIpcCapabilities } from '../ipc/register.js';
import { DesktopIpcError } from '../ipc/validated-handler.js';
import {
  createDesktopJsonTransport,
  DesktopRemoteError,
  validateDesktopConnectionConfig,
  type DesktopConnectionConfig,
  type DesktopJsonTransport,
} from '../remote/connection.js';

const tokenSchema = z.object({
  access_token: z.string().min(1).max(8_192),
  refresh_token: z.string().min(1).max(8_192),
  expires_in: z.number().int().positive().max(86_400),
  user: z.object({ id: z.uuid() }),
});
const identitySchema = z.strictObject({ userId: z.uuid(), role: SessionRoleSchema });
const identityResponseSchema = z.strictObject({ result: identitySchema });
const gatewayPaths = new Set([
  '/publisher',
  '/session/identity',
  ...[
    'list',
    'createProviderRevision',
    'createBindingRevision',
    'dryRun',
    'activate',
    'pause',
    'archive',
    'restore',
    'requestCheck',
    'resolveActive',
  ].map((name) => `/sources/${name}`),
  '/audit/list',
  '/audit/get',
  ...['list', 'getDetail', 'getCounts', 'getCandidate', 'approve', 'reject', 'reprocess'].map(
    (name) => `/updates/${name}`,
  ),
  '/publication/context',
  '/publication/history',
  '/publication/historyEvidence',
]);

type VolatileSession = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  role: SessionRole;
}>;
export type DesktopSessionActor = Readonly<{ userId: string; actorKey: string; role: SessionRole }>;

export const createDesktopSession = (
  inputConfig: DesktopConnectionConfig | null,
  ports: Readonly<{ transport?: DesktopJsonTransport; now?: () => number }> = {},
) => {
  const config = inputConfig === null ? null : validateDesktopConnectionConfig(inputConfig);
  const transport = ports.transport ?? createDesktopJsonTransport();
  const now = ports.now ?? Date.now;
  let current: VolatileSession | null = null;
  let generation = 0;
  let refreshing: Readonly<{ generation: number; promise: Promise<string> }> | null = null;
  const emptyState = (): SessionStateDto => ({
    sessionState: config === null ? 'not_configured' : 'signed_out',
    userId: null,
    role: null,
  });
  const snapshot = (): SessionStateDto =>
    current === null
      ? emptyState()
      : {
          sessionState: 'authenticated',
          userId: current.userId,
          role: current.role,
        };
  const clear = () => {
    generation += 1;
    current = null;
    refreshing = null;
  };

  const authenticate = async (
    grant: 'password' | 'refresh_token',
    payload: unknown,
    attempt: number,
  ): Promise<string> => {
    if (config === null) throw new DesktopIpcError('NOT_ALLOWED');
    const url = new URL(`${config.supabaseUrl.replace(/\/$/u, '')}/auth/v1/token`);
    url.searchParams.set('grant_type', grant);
    const tokenResult = tokenSchema.safeParse(
      await transport(url, payload, { apikey: config.anonKey }),
    );
    if (!tokenResult.success || generation !== attempt) throw new DesktopIpcError('NOT_ALLOWED');
    const token = tokenResult.data;
    const expiresAt = now() + token.expires_in * 1_000;
    const result = identityResponseSchema.safeParse(
      await transport(
        new URL(`${config.gatewayUrl.replace(/\/$/u, '')}/session/identity`),
        {},
        { Authorization: `Bearer ${token.access_token}` },
      ),
    );
    if (
      !result.success ||
      result.data.result.userId !== token.user.id ||
      generation !== attempt ||
      now() >= expiresAt
    ) {
      throw new DesktopIpcError('NOT_ALLOWED');
    }
    current = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      userId: result.data.result.userId,
      role: result.data.result.role,
    };
    return current.accessToken;
  };

  const getAccessToken = async (): Promise<string> => {
    if (current === null) throw new DesktopIpcError('NOT_ALLOWED');
    if (current.expiresAt > now() + 30_000) return current.accessToken;
    if (refreshing?.generation === generation) return refreshing.promise;
    const attempt = generation;
    const refreshToken = current.refreshToken;
    const promise = authenticate('refresh_token', { refresh_token: refreshToken }, attempt)
      .catch((error: unknown) => {
        if (generation === attempt) clear();
        throw error instanceof DesktopIpcError ? error : new DesktopIpcError('FAILED');
      })
      .finally(() => {
        if (refreshing?.generation === attempt) refreshing = null;
      });
    refreshing = { generation: attempt, promise };
    return promise;
  };

  const getState = async (): Promise<SessionStateDto> => {
    if (current !== null) {
      try {
        await getAccessToken();
      } catch {
        /* State is cleared by failed refresh. */
      }
    }
    return snapshot();
  };

  const signIn = async (input: SessionSignInCommand): Promise<SessionStateDto> => {
    const parsed = SessionSignInCommandSchema.safeParse(input);
    if (!parsed.success) throw new DesktopIpcError('INVALID_INPUT');
    if (config === null) throw new DesktopIpcError('NOT_ALLOWED');
    clear();
    const attempt = generation;
    try {
      await authenticate('password', parsed.data, attempt);
      return snapshot();
    } catch (error) {
      if (generation === attempt) clear();
      throw error instanceof DesktopIpcError ? error : new DesktopIpcError('FAILED');
    }
  };

  const signOut = async (): Promise<SessionStateDto> => {
    const token = current?.accessToken;
    clear();
    if (config !== null && token !== undefined) {
      try {
        await transport(
          new URL(`${config.supabaseUrl.replace(/\/$/u, '')}/auth/v1/logout`),
          {},
          {
            apikey: config.anonKey,
            Authorization: `Bearer ${token}`,
          },
        );
      } catch {
        /* Volatile credentials remain cleared even when logout is unavailable. */
      }
    }
    return emptyState();
  };

  const getActor = (): DesktopSessionActor | null =>
    current === null || current.expiresAt <= now()
      ? null
      : {
          userId: current.userId,
          role: current.role,
          actorKey: `user:${current.userId}`,
        };

  const request = async <T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T> => {
    if (config === null || !gatewayPaths.has(path)) throw new DesktopIpcError('NOT_ALLOWED');
    const attempt = generation;
    const token = await getAccessToken();
    if (attempt !== generation) throw new DesktopIpcError('NOT_ALLOWED');
    try {
      const result = z.strictObject({ result: schema }).safeParse(
        await transport(
          new URL(
            path === '/publisher'
              ? `${new URL(config.supabaseUrl).origin}/functions/v1/publisher`
              : `${config.gatewayUrl.replace(/\/$/u, '')}${path}`,
          ),
          payload,
          { apikey: config.anonKey, Authorization: `Bearer ${token}` },
          path === '/publisher'
            ? { requestBytes: 16 * 1024, responseBytes: 64 * 1024 }
            : {
                requestBytes: gatewayRequestLimit(path),
                responseBytes: gatewayResponseLimit(path),
              },
        ),
      );
      if (attempt !== generation) throw new DesktopIpcError('NOT_ALLOWED');
      if (!result.success) throw new DesktopIpcError('FAILED');
      return result.data.result;
    } catch (error) {
      if (error instanceof DesktopRemoteError && error.statusCode === 401 && generation === attempt)
        clear();
      throw error instanceof DesktopIpcError ? error : new DesktopIpcError('FAILED');
    }
  };

  const ipcCapabilities: DesktopSessionIpcCapabilities = {
    getState: { authorize: () => true, handle: getState },
    signIn: { authorize: () => config !== null, handle: signIn },
    signOut: { authorize: () => true, handle: signOut },
  };
  return { getAccessToken, getActor, getState, signIn, signOut, request, ipcCapabilities };
};

export type DesktopSession = ReturnType<typeof createDesktopSession>;
