import { lookup } from 'node:dns/promises';
import { request as requestHttps } from 'node:https';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

import {
  isPublicIpAddress,
  type ResolvedAddress,
  type TransportResponse,
} from '../import/planalto-source.js';
import { DesktopIpcError } from '../ipc/validated-handler.js';

export const DESKTOP_HTTP_LIMITS = Object.freeze({ timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });

const publicHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/gu, '');
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      (url.port === '' || url.port === '443') &&
      (isIP(host) > 0
        ? isPublicIpAddress(host)
        : host.includes('.') && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/iu.test(host))
    );
  } catch {
    return false;
  }
};

const publicKey = (value: string): boolean => {
  if (value.startsWith('sb_secret_')) return false;
  if (value.startsWith('sb_publishable_')) return true;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(value.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    return z.object({ role: z.literal('anon') }).safeParse(payload).success;
  } catch {
    return false;
  }
};

const configSchema = z.strictObject({
  supabaseUrl: z.string().max(500).refine(publicHttpsUrl),
  anonKey: z.string().min(20).max(4_096).refine(publicKey),
  gatewayUrl: z.string().max(500).refine(publicHttpsUrl),
  repositoryRoot: z.string().min(1).max(4_096).refine(isAbsolute),
  canonicalBranch: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/u)
    .refine((value) => !value.includes('..') && !value.endsWith('/') && !value.endsWith('.lock')),
});
export type DesktopConnectionConfig = z.infer<typeof configSchema>;
export const validateDesktopConnectionConfig = (
  config: DesktopConnectionConfig,
): DesktopConnectionConfig => {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) throw new DesktopIpcError('NETWORK_NOT_ALLOWED');
  return parsed.data;
};

export const readDesktopConnectionConfig = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DesktopConnectionConfig | null => {
  const names = [
    'LEX_EDITOR_SUPABASE_URL',
    'LEX_EDITOR_SUPABASE_ANON_KEY',
    'LEX_EDITOR_GATEWAY_URL',
    'LEX_EDITOR_REPOSITORY_ROOT',
  ] as const;
  if (names.every((name) => !environment[name])) return null;
  return validateDesktopConnectionConfig({
    supabaseUrl: environment['LEX_EDITOR_SUPABASE_URL'] ?? '',
    anonKey: environment['LEX_EDITOR_SUPABASE_ANON_KEY'] ?? '',
    gatewayUrl: environment['LEX_EDITOR_GATEWAY_URL'] ?? '',
    repositoryRoot: environment['LEX_EDITOR_REPOSITORY_ROOT'] ?? '',
    canonicalBranch: environment['LEX_EDITOR_CANONICAL_BRANCH'] ?? 'main',
  });
};

export class DesktopRemoteError extends DesktopIpcError {
  constructor(readonly statusCode: number) {
    super(statusCode === 401 || statusCode === 403 ? 'NOT_ALLOWED' : 'NETWORK_HTTP');
  }
}

export type DesktopJsonTransport = (
  url: URL,
  payload: unknown,
  headers: Readonly<Record<string, string>>,
  limits?: Readonly<{ requestBytes: number; responseBytes: number }>,
) => Promise<unknown>;
export type DesktopHttpRequest = Readonly<{
  url: URL;
  addresses: readonly ResolvedAddress[];
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  maxBytes: number;
  timeoutMs: number;
  signal: AbortSignal;
}>;
export type DesktopHttpPorts = Readonly<{
  resolveHost(hostname: string): Promise<readonly ResolvedAddress[]>;
  send(input: DesktopHttpRequest): Promise<TransportResponse>;
}>;

const send: DesktopHttpPorts['send'] = (input) =>
  new Promise((resolve, reject) => {
    const address = input.addresses[0];
    if (address === undefined) {
      reject(new DesktopIpcError('NETWORK_DNS'));
      return;
    }
    const request = requestHttps(
      input.url,
      {
        method: 'POST',
        headers: input.headers,
        agent: false,
        signal: input.signal,
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [...input.addresses]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (value: unknown) => {
          if (!Buffer.isBuffer(value)) {
            request.destroy(new DesktopIpcError('NETWORK_FAILED'));
            return;
          }
          size += value.byteLength;
          if (size > input.maxBytes) {
            request.destroy(new DesktopIpcError('NETWORK_TOO_LARGE'));
            return;
          }
          chunks.push(value);
        });
        response.on('error', reject);
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on('error', (error) => {
      reject(error instanceof DesktopIpcError ? error : new DesktopIpcError('NETWORK_FAILED'));
    });
    request.end(input.body);
  });

export const createDesktopJsonTransport =
  (
    ports: DesktopHttpPorts = {
      resolveHost: async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
          address,
          family: family as 4 | 6,
        })),
      send,
    },
  ): DesktopJsonTransport =>
  async (
    url,
    payload,
    headers,
    limits = {
      requestBytes: DESKTOP_HTTP_LIMITS.maxBytes,
      responseBytes: DESKTOP_HTTP_LIMITS.maxBytes,
    },
  ) => {
    if (
      !publicHttpsUrl(`${url.origin}${url.pathname}`) ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new DesktopIpcError('NETWORK_NOT_ALLOWED');
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    if (body.byteLength > limits.requestBytes) throw new DesktopIpcError('PAYLOAD_TOO_LARGE');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      return await Promise.race([
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new DesktopIpcError('NETWORK_TIMEOUT'));
          }, DESKTOP_HTTP_LIMITS.timeoutMs);
        }),
        (async () => {
          const addresses = await ports.resolveHost(url.hostname.replace(/^\[|\]$/gu, ''));
          if (controller.signal.aborted) throw new DesktopIpcError('NETWORK_TIMEOUT');
          if (
            addresses.length === 0 ||
            addresses.some(({ address }) => !isPublicIpAddress(address))
          ) {
            throw new DesktopIpcError('NETWORK_NOT_ALLOWED');
          }
          const response = await ports.send({
            url,
            addresses,
            body,
            maxBytes: limits.responseBytes,
            timeoutMs: DESKTOP_HTTP_LIMITS.timeoutMs,
            signal: controller.signal,
            headers: {
              ...headers,
              'Content-Type': 'application/json',
              'Content-Length': String(body.byteLength),
              'Accept-Encoding': 'identity',
            },
          });
          if (response.statusCode < 200 || response.statusCode >= 300)
            throw new DesktopRemoteError(response.statusCode);
          if (response.body.byteLength > limits.responseBytes)
            throw new DesktopIpcError('NETWORK_TOO_LARGE');
          const contentType = response.headers['content-type'];
          if (
            typeof contentType !== 'string' ||
            contentType.split(';')[0]?.trim() !== 'application/json' ||
            (response.headers['content-encoding'] !== undefined &&
              response.headers['content-encoding'] !== 'identity')
          ) {
            throw new DesktopIpcError('NETWORK_CONTENT_TYPE');
          }
          try {
            return JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(response.body),
            ) as unknown;
          } catch {
            throw new DesktopIpcError('NETWORK_FAILED');
          }
        })(),
      ]);
    } catch (error) {
      throw error instanceof DesktopIpcError ? error : new DesktopIpcError('NETWORK_FAILED');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
