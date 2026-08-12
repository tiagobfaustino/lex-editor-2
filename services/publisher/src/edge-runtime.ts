import postgres from 'postgres';
import { z } from 'zod';

import { publicationUuidSchema } from '../../../src/shared/publication/manifest.js';
import { createPublicationApprovalAuthority, PublicationApprovalError } from './approval.js';
import { createPublisherDatabase, PublisherDatabaseError } from './database.js';
import { PublisherGitError } from './git-repository.js';
import { createPublisherGitHubRepository } from './github-repository.js';
import {
  createPublisherService,
  PublisherAuthenticationError,
  type PublisherAuthenticator,
} from './service.js';
import { PublisherValidationError } from './validation.js';
import { PublisherWorkflowError } from './workflow.js';

const environmentSchema = z.strictObject({
  SUPABASE_URL: z.url().max(500),
  SUPABASE_ANON_KEY: z.string().min(20).max(4_096),
  SUPABASE_DB_URL: z.string().min(20).max(4_096),
  PUBLISHER_GITHUB_OWNER: z.string().min(1).max(39),
  PUBLISHER_GITHUB_REPOSITORY: z.string().min(1).max(100),
  PUBLISHER_GITHUB_TOKEN: z.string().min(20).max(4_096),
});

const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('approve'),
    publicationId: publicationUuidSchema,
    manifestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
  z.strictObject({
    action: z.literal('publish'),
    publicationId: publicationUuidSchema,
    candidateSha: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u),
  }),
  z.strictObject({
    action: z.literal('getAttempt'),
    publicationId: publicationUuidSchema,
  }),
]);

const MAX_REQUEST_BYTES = 16 * 1024;

type RuntimeEnvironment = z.infer<typeof environmentSchema>;

type DenoEnvironment = Readonly<{
  env: Readonly<{ get(name: string): string | undefined }>;
}>;

const readEnvironment = (): RuntimeEnvironment => {
  const deno = (globalThis as typeof globalThis & { Deno?: DenoEnvironment }).Deno;
  if (deno === undefined) throw new Error('Deno runtime unavailable.');
  return environmentSchema.parse({
    SUPABASE_URL: deno.env.get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: deno.env.get('SUPABASE_ANON_KEY'),
    SUPABASE_DB_URL: deno.env.get('SUPABASE_DB_URL'),
    PUBLISHER_GITHUB_OWNER: deno.env.get('PUBLISHER_GITHUB_OWNER'),
    PUBLISHER_GITHUB_REPOSITORY: deno.env.get('PUBLISHER_GITHUB_REPOSITORY'),
    PUBLISHER_GITHUB_TOKEN: deno.env.get('PUBLISHER_GITHUB_TOKEN'),
  });
};

const jsonResponse = (status: number, body: unknown): Response =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const bearerToken = (request: Request): string => {
  const authorization = request.headers.get('authorization');
  const match = /^Bearer ([^\s]+)$/u.exec(authorization ?? '');
  if (match?.[1] === undefined) throw new PublisherAuthenticationError();
  return match[1];
};

const readRequest = async (request: Request): Promise<z.infer<typeof requestSchema>> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_REQUEST_BYTES) {
    throw new PublisherValidationError('invalid_candidate', 'A solicitação excede o limite.');
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_REQUEST_BYTES) {
    throw new PublisherValidationError('invalid_candidate', 'A solicitação excede o limite.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new PublisherValidationError('invalid_candidate', 'A solicitação é inválida.');
  }
  return requestSchema.parse(parsed);
};

const createAuthenticator = (environment: RuntimeEnvironment): PublisherAuthenticator => ({
  async authenticate(accessToken) {
    const response = await fetch(`${environment.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: environment.SUPABASE_ANON_KEY,
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed = z
      .object({ id: publicationUuidSchema })
      .safeParse(await response.json().catch(() => null));
    return parsed.success ? { userId: parsed.data.id } : null;
  },
});

const publicError = (error: unknown): Response => {
  if (error instanceof PublisherAuthenticationError) {
    return jsonResponse(401, { error: 'authentication_required' });
  }
  if (error instanceof PublicationApprovalError) {
    const status = error.code === 'identity_not_authorized' ? 403 : 409;
    return jsonResponse(status, { error: error.code });
  }
  if (error instanceof PublisherValidationError) {
    const status =
      error.code === 'canonical_base_changed' || error.code === 'sequence_conflict' ? 409 : 422;
    return jsonResponse(status, { error: error.code });
  }
  if (error instanceof PublisherWorkflowError) {
    return jsonResponse(error.code === 'sync_failed' ? 503 : 409, { error: error.code });
  }
  if (error instanceof PublisherGitError || error instanceof PublisherDatabaseError) {
    return jsonResponse(503, { error: 'publisher_unavailable' });
  }
  if (error instanceof z.ZodError) {
    return jsonResponse(422, { error: 'invalid_request' });
  }
  return jsonResponse(500, { error: 'internal_error' });
};

let service: ReturnType<typeof createPublisherService> | undefined;

const createService = (): ReturnType<typeof createPublisherService> => {
  const environment = readEnvironment();
  const sql = postgres(environment.SUPABASE_DB_URL, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  const git = createPublisherGitHubRepository({
    owner: environment.PUBLISHER_GITHUB_OWNER,
    repository: environment.PUBLISHER_GITHUB_REPOSITORY,
    token: environment.PUBLISHER_GITHUB_TOKEN,
  });
  const database = createPublisherDatabase({
    git,
    sql: {
      async query<T extends Record<string, unknown>>(
        text: string,
        parameters: readonly unknown[] = [],
      ) {
        try {
          return (await sql.unsafe(text, [...parameters] as never[])) as unknown as readonly T[];
        } catch {
          throw new PublisherDatabaseError();
        }
      },
    },
  });
  const approvals = createPublicationApprovalAuthority({
    identities: database.identities,
    approvals: database.approvals,
  });
  return createPublisherService({
    authenticator: createAuthenticator(environment),
    approvals,
    git,
    baselines: database.baselines,
    attempts: database.attempts,
    transaction: database.transaction,
  });
};

export const handlePublisherRequest = async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }
  try {
    const token = bearerToken(request);
    const input = await readRequest(request);
    service ??= createService();
    if (input.action === 'approve') {
      const result = await service.approve(token, {
        publicationId: input.publicationId,
        manifestDigest: input.manifestDigest,
      });
      return jsonResponse(200, { result });
    }
    if (input.action === 'publish') {
      const result = await service.publish(token, {
        publicationId: input.publicationId,
        candidateSha: input.candidateSha,
      });
      return jsonResponse(200, { result });
    }
    const result = await service.getAttempt(token, input.publicationId);
    return jsonResponse(200, { result });
  } catch (error) {
    return publicError(error);
  }
};

export default Object.freeze({ fetch: handlePublisherRequest });
