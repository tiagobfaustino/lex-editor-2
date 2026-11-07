import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { z } from 'zod';

import { gatewayRequestLimit } from './contracts.js';
import { createDesktopGateway, type GatewayAuthenticator } from './service.js';

const secureUrl = z.url().refine((raw) => {
  const url = new URL(raw);
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
});
const databaseUrl = z.string().min(20).max(4096);
const environmentSchema = z.strictObject({
  SUPABASE_URL: secureUrl,
  SUPABASE_ANON_KEY: z.string().min(20).max(4096),
  GATEWAY_CATALOG_DB_URL: databaseUrl,
  GATEWAY_IMPORTER_DB_URL: databaseUrl,
  GATEWAY_UPDATE_EDITOR_DB_URL: databaseUrl,
  GATEWAY_AUDIT_READER_DB_URL: databaseUrl,
  GATEWAY_PUBLICATION_READER_DB_URL: databaseUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
});

export const createSupabaseGatewayAuthenticator = (options: {
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
}): GatewayAuthenticator => ({
  async authenticate(accessToken) {
    const response = await (options.fetch ?? fetch)(
      `${options.url.replace(/\/$/u, '')}/auth/v1/user`,
      {
        headers: { apikey: options.anonKey, authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 64 * 1024) return null;
    try {
      const parsed = z
        .object({ id: z.uuid() })
        .safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
      return parsed.success ? { userId: parsed.data.id } : null;
    } catch {
      return null;
    }
  },
});

export const startDesktopGateway = (environment: NodeJS.ProcessEnv = process.env) => {
  const config = environmentSchema.parse(
    Object.fromEntries(Object.keys(environmentSchema.shape).map((key) => [key, environment[key]])),
  );
  const pools = [
    config.GATEWAY_CATALOG_DB_URL,
    config.GATEWAY_IMPORTER_DB_URL,
    config.GATEWAY_UPDATE_EDITOR_DB_URL,
    config.GATEWAY_AUDIT_READER_DB_URL,
    config.GATEWAY_PUBLICATION_READER_DB_URL,
  ].map((url) =>
    postgres(url, {
      prepare: false,
      max: 2,
      connect_timeout: 10,
      idle_timeout: 20,
      connection: { statement_timeout: 15_000 },
    }),
  );
  const ports = pools.map((sql) => ({
    async query<T extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ): Promise<readonly T[]> {
      return (await sql.unsafe(text, [...parameters] as never[])) as unknown as readonly T[];
    },
  }));
  const [catalog, importer, updateEditor, auditReader, publicationReader] = ports;
  if (
    catalog === undefined ||
    importer === undefined ||
    updateEditor === undefined ||
    auditReader === undefined ||
    publicationReader === undefined
  )
    throw new Error('Gateway database configuration is unavailable.');
  const gateway = createDesktopGateway({
    sql: { catalog, importer, updateEditor, auditReader, publicationReader },
    authenticator: createSupabaseGatewayAuthenticator({
      url: config.SUPABASE_URL,
      anonKey: config.SUPABASE_ANON_KEY,
    }),
  });
  const server = createServer(
    { requestTimeout: 20_000, headersTimeout: 10_000, maxHeaderSize: 20 * 1024 },
    (incoming, outgoing) => {
      void (async () => {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of incoming) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          length += bytes.length;
          if (
            length >
            gatewayRequestLimit(new URL(incoming.url ?? '/', 'http://gateway.internal').pathname)
          ) {
            outgoing.writeHead(413, {
              'content-type': 'application/json',
              'cache-control': 'no-store',
            });
            outgoing.end('{"error":"request_too_large"}');
            return;
          }
          chunks.push(bytes);
        }
        const method = incoming.method ?? 'GET';
        const headers = new Headers();
        const authorization = incoming.headers.authorization;
        if (authorization !== undefined) headers.set('authorization', authorization);
        const result = await gateway.fetch(
          new Request(`http://gateway.internal${incoming.url ?? '/'}`, {
            method,
            headers,
            ...(method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
          }),
        );
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        outgoing.end(Buffer.from(await result.arrayBuffer()));
      })().catch(() => {
        if (!outgoing.headersSent)
          outgoing.writeHead(503, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          });
        outgoing.end('{"error":"gateway_unavailable"}');
      });
    },
  );
  server.listen(config.PORT, '127.0.0.1');
  return {
    server,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      );
      await Promise.all(pools.map((sql) => sql.end({ timeout: 5 })));
    },
  };
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    startDesktopGateway();
  } catch {
    process.stderr.write('Desktop gateway configuration is invalid.\n');
    process.exitCode = 1;
  }
}
