import postgres from 'postgres';
import { z } from 'zod';

import {
  LegislativeUpdateReprocessAuthenticationError,
  createLegislativeUpdateReprocessService,
  legislativeUpdateReprocessDecisionSchema,
} from './reprocess-request-service.js';

const environmentSchema = z.strictObject({
  SUPABASE_URL: z.url().max(500),
  SUPABASE_ANON_KEY: z.string().min(20).max(4_096),
  SUPABASE_DB_URL: z.string().min(20).max(4_096),
});
const requestSchema = z.strictObject({ updateId: z.uuid(), requestId: z.uuid().optional() });
const MAX_REQUEST_BYTES = 1_024;

class LegislativeUpdateReprocessRequestError extends Error {}

type DenoEnvironment = Readonly<{ env: Readonly<{ get(name: string): string | undefined }> }>;

const environment = () => {
  const deno = (globalThis as typeof globalThis & { Deno?: DenoEnvironment }).Deno;
  if (deno === undefined) throw new Error('Deno runtime unavailable.');
  return environmentSchema.parse({
    SUPABASE_URL: deno.env.get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: deno.env.get('SUPABASE_ANON_KEY'),
    SUPABASE_DB_URL: deno.env.get('SUPABASE_DB_URL'),
  });
};

const response = (status: number, body: unknown): Response =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const bearerToken = (request: Request): string => {
  const token = /^Bearer ([^\s]+)$/u.exec(request.headers.get('authorization') ?? '')?.[1];
  if (token === undefined) throw new LegislativeUpdateReprocessAuthenticationError();
  return token;
};

const input = async (request: Request): Promise<z.infer<typeof requestSchema>> => {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_REQUEST_BYTES)) {
    throw new LegislativeUpdateReprocessRequestError();
  }
  const reader = request.body?.getReader();
  if (reader === undefined) throw new LegislativeUpdateReprocessRequestError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) throw new LegislativeUpdateReprocessRequestError();
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new LegislativeUpdateReprocessRequestError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new LegislativeUpdateReprocessRequestError();
  }
  const result = requestSchema.safeParse(parsed);
  if (!result.success) throw new LegislativeUpdateReprocessRequestError();
  return result.data;
};

let service: ReturnType<typeof createLegislativeUpdateReprocessService> | undefined;

const createService = (): ReturnType<typeof createLegislativeUpdateReprocessService> => {
  const config = environment();
  const sql = postgres(config.SUPABASE_DB_URL, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  return createLegislativeUpdateReprocessService({
    authenticator: {
      async authenticate(accessToken) {
        const auth = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: config.SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        const parsed = z.object({ id: z.uuid() }).safeParse(await auth.json().catch(() => null));
        return auth.ok && parsed.success ? { userId: parsed.data.id } : null;
      },
    },
    requester: {
      async request(updateId, actorUserId, requestId) {
        const rows = await sql.unsafe(
          requestId === undefined
            ? 'select private.request_legislative_update_reprocess($1::uuid, $2::uuid) as value'
            : 'select private.request_legislative_update_reprocess($1::uuid, $2::uuid, $3::uuid) as value',
          requestId === undefined ? [updateId, actorUserId] : [updateId, actorUserId, requestId],
        );
        return legislativeUpdateReprocessDecisionSchema.parse(rows[0]?.['value']);
      },
    },
  });
};

export const handleLegislativeUpdateReprocessRequest = async (
  request: Request,
): Promise<Response> => {
  if (request.method !== 'POST') return response(405, { error: 'method_not_allowed' });
  try {
    const token = bearerToken(request);
    const payload = await input(request);
    service ??= createService();
    return response(200, {
      result: await service.request(token, payload.updateId, payload.requestId),
    });
  } catch (error) {
    if (error instanceof LegislativeUpdateReprocessAuthenticationError) {
      return response(401, { error: 'authentication_required' });
    }
    if (error instanceof LegislativeUpdateReprocessRequestError) {
      return response(422, { error: 'invalid_request' });
    }
    return response(503, { error: 'update_reprocess_unavailable' });
  }
};

export default Object.freeze({ fetch: handleLegislativeUpdateReprocessRequest });
