import { lookup } from 'node:dns/promises';
import { request as requestHttp } from 'node:http';
import type { RequestOptions } from 'node:http';
import { request as requestHttps } from 'node:https';
import { BlockList, isIP } from 'node:net';

import type { SourceRole, SourceVariant } from '@lex-editor/legal-domain';

export const PLANALTO_ALLOWED_HOSTS = Object.freeze(
  new Set(['planalto.gov.br', 'www.planalto.gov.br']),
);

export const PLANALTO_NETWORK_LIMITS = Object.freeze({
  maxArtifactBytes: 20 * 1024 * 1024,
  maxRedirects: 5,
  timeoutMs: 15_000,
  maxArtifacts: 2,
} as const);

export type PlanaltoNetworkErrorCode =
  | 'NETWORK_NOT_ALLOWED'
  | 'NETWORK_DNS'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_HTTP'
  | 'NETWORK_CONTENT_TYPE'
  | 'NETWORK_TOO_LARGE'
  | 'NETWORK_CERTIFICATE'
  | 'NETWORK_FAILED';

const planaltoNetworkErrorCodes: ReadonlySet<string> = new Set<PlanaltoNetworkErrorCode>([
  'NETWORK_NOT_ALLOWED',
  'NETWORK_DNS',
  'NETWORK_TIMEOUT',
  'NETWORK_HTTP',
  'NETWORK_CONTENT_TYPE',
  'NETWORK_TOO_LARGE',
  'NETWORK_CERTIFICATE',
  'NETWORK_FAILED',
]);

export class PlanaltoNetworkError extends Error {
  readonly code: PlanaltoNetworkErrorCode;
  readonly httpStatus?: number;

  constructor(code: PlanaltoNetworkErrorCode, options?: Readonly<{ httpStatus?: number }>) {
    super(code);
    this.name = 'PlanaltoNetworkError';
    this.code = code;
    if (options?.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }
}

export const isPlanaltoNetworkError = (error: unknown): error is PlanaltoNetworkError => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Readonly<{ name?: unknown; code?: unknown }>;
  return (
    candidate.name === 'PlanaltoNetworkError' &&
    typeof candidate.code === 'string' &&
    planaltoNetworkErrorCodes.has(candidate.code)
  );
};

export type ResolvedAddress = Readonly<{
  address: string;
  family: 4 | 6;
}>;

type TransportRequest = Readonly<{
  url: URL;
  addresses: readonly ResolvedAddress[];
  timeoutMs: number;
  maxBytes: number;
}>;

type TransportResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Buffer;
}>;

export type PlanaltoNetworkPorts = Readonly<{
  resolveHost(hostname: string): Promise<readonly ResolvedAddress[]>;
  request(input: TransportRequest): Promise<TransportResponse>;
}>;

export type FetchedPlanaltoArtifact = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  bytes: Buffer;
  sourceRole: SourceRole;
  sourceVariant: SourceVariant;
}>;

const blockedAddresses = new BlockList();

for (const [network, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
] as const) {
  blockedAddresses.addSubnet(network, prefix, family);
}

export const isPublicIpAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 6 && /^::ffff:/iu.test(address)) return false;
  return (
    (family === 4 && !blockedAddresses.check(address, 'ipv4')) ||
    (family === 6 && !blockedAddresses.check(address, 'ipv6'))
  );
};

const validateUrl = (input: URL): URL => {
  const url = new URL(input.href);
  const expectedPort = url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : null;

  if (
    expectedPort === null ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !PLANALTO_ALLOWED_HOSTS.has(url.hostname.toLocaleLowerCase('en-US')) ||
    (url.port.length > 0 && url.port !== expectedPort)
  ) {
    throw new PlanaltoNetworkError('NETWORK_NOT_ALLOWED');
  }

  url.hash = '';
  return url;
};

const resolveAndValidate = async (
  url: URL,
  resolveHost: PlanaltoNetworkPorts['resolveHost'],
): Promise<readonly ResolvedAddress[]> => {
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new PlanaltoNetworkError('NETWORK_DNS');
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => isIP(address) !== family || !isPublicIpAddress(address))
  ) {
    throw new PlanaltoNetworkError('NETWORK_NOT_ALLOWED');
  }

  return addresses;
};

const requestWithNode = ({
  url,
  addresses,
  timeoutMs,
  maxBytes,
}: TransportRequest): Promise<TransportResponse> =>
  new Promise((resolve, reject) => {
    const selected = addresses[0];
    if (selected === undefined) {
      reject(new PlanaltoNetworkError('NETWORK_DNS'));
      return;
    }

    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'text/html, application/xhtml+xml;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'LexEditor/0.1',
      },
      agent: false,
      family: selected.family,
      lookup: (_hostname, _options, callback) => {
        callback(null, selected.address, selected.family);
      },
    };
    const request = (url.protocol === 'https:' ? requestHttps : requestHttp)(
      options,
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const redirect = statusCode >= 300 && statusCode < 400;
        if (redirect) {
          response.resume();
          resolve({ statusCode, headers: response.headers, body: Buffer.alloc(0) });
          return;
        }

        const declaredLength = Number(response.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.destroy(new PlanaltoNetworkError('NETWORK_TOO_LARGE'));
          return;
        }

        let received = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += bytes.byteLength;
          if (received > maxBytes) {
            response.destroy(new PlanaltoNetworkError('NETWORK_TOO_LARGE'));
            return;
          }
          chunks.push(bytes);
        });
        response.once('end', () => {
          resolve({ statusCode, headers: response.headers, body: Buffer.concat(chunks) });
        });
        response.once('error', reject);
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new PlanaltoNetworkError('NETWORK_TIMEOUT'));
    });
    const deadline = setTimeout(() => {
      request.destroy(new PlanaltoNetworkError('NETWORK_TIMEOUT'));
    }, timeoutMs);
    deadline.unref();
    request.once('close', () => {
      clearTimeout(deadline);
    });
    request.once('error', (error) => {
      if (error instanceof PlanaltoNetworkError) {
        reject(error);
        return;
      }
      const code = (error as NodeJS.ErrnoException).code ?? '';
      reject(
        /^(?:CERT_|ERR_TLS_CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)/u.test(code)
          ? new PlanaltoNetworkError('NETWORK_CERTIFICATE')
          : new PlanaltoNetworkError('NETWORK_FAILED'),
      );
    });
    request.end();
  });

const defaultPorts: PlanaltoNetworkPorts = {
  resolveHost: async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.flatMap(({ address, family }) =>
      family === 4 || family === 6 ? [{ address, family }] : [],
    );
  },
  request: requestWithNode,
};

const redirectTarget = (
  base: URL,
  location: string | readonly string[] | undefined,
): URL | undefined => {
  const value = typeof location === 'string' ? location : location?.[0];
  return value === undefined ? undefined : new URL(value, base);
};

const fetchOne = async (
  requestedUrl: URL,
  ports: PlanaltoNetworkPorts,
): Promise<Readonly<{ requestedUrl: string; finalUrl: string; bytes: Buffer }>> => {
  let current = validateUrl(requestedUrl);

  for (let redirects = 0; redirects <= PLANALTO_NETWORK_LIMITS.maxRedirects; redirects += 1) {
    const addresses = await resolveAndValidate(current, ports.resolveHost);
    const response = await ports.request({
      url: current,
      addresses,
      timeoutMs: PLANALTO_NETWORK_LIMITS.timeoutMs,
      maxBytes: PLANALTO_NETWORK_LIMITS.maxArtifactBytes,
    });

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const next = redirectTarget(current, response.headers['location']);
      if (next === undefined || redirects === PLANALTO_NETWORK_LIMITS.maxRedirects) {
        throw new PlanaltoNetworkError('NETWORK_HTTP', { httpStatus: response.statusCode });
      }
      current = validateUrl(next);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new PlanaltoNetworkError('NETWORK_HTTP', { httpStatus: response.statusCode });
    }

    const encoding = response.headers['content-encoding'];
    if (encoding !== undefined && encoding !== 'identity') {
      throw new PlanaltoNetworkError('NETWORK_CONTENT_TYPE');
    }
    const rawContentType = response.headers['content-type'];
    const contentType = (
      typeof rawContentType === 'string' ? rawContentType : (rawContentType?.[0] ?? '')
    )
      .split(';', 1)[0]
      ?.trim()
      .toLocaleLowerCase('en-US');
    if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
      throw new PlanaltoNetworkError('NETWORK_CONTENT_TYPE');
    }
    if (response.body.byteLength > PLANALTO_NETWORK_LIMITS.maxArtifactBytes) {
      throw new PlanaltoNetworkError('NETWORK_TOO_LARGE');
    }

    return {
      requestedUrl: requestedUrl.href,
      finalUrl: current.href,
      bytes: response.body,
    };
  }

  throw new PlanaltoNetworkError('NETWORK_HTTP');
};

const isCompiledUrl = (url: URL): boolean => /compilad[oa](?=\.html?$)/iu.test(url.pathname);

const relatedUrl = (url: URL): URL | undefined => {
  if (!/\.html?$/iu.test(url.pathname)) return undefined;
  const related = new URL(url.href);
  related.search = '';
  related.hash = '';
  related.pathname = isCompiledUrl(related)
    ? related.pathname.replace(/compilad[oa](?=\.html?$)/iu, '')
    : related.pathname.replace(/(?=\.html?$)/iu, 'compilado');
  return related.href === url.href ? undefined : related;
};

const optionalSourceIsAbsent = (error: unknown): boolean =>
  error instanceof PlanaltoNetworkError &&
  error.code === 'NETWORK_HTTP' &&
  (error.httpStatus === 404 || error.httpStatus === 410);

export const fetchPlanaltoSourceSet = async (
  rawUrl: string,
  ports: PlanaltoNetworkPorts = defaultPorts,
): Promise<readonly FetchedPlanaltoArtifact[]> => {
  const requested = validateUrl(new URL(rawUrl));
  const first = await fetchOne(requested, ports);
  const firstUrl = new URL(first.finalUrl);
  const firstCompiled = isCompiledUrl(firstUrl);
  const counterpart = relatedUrl(firstUrl);
  let second: Awaited<ReturnType<typeof fetchOne>> | undefined;

  if (counterpart !== undefined) {
    try {
      second = await fetchOne(counterpart, ports);
    } catch (error) {
      if (!optionalSourceIsAbsent(error)) throw error;
    }
  }

  if (firstCompiled || second === undefined) {
    return [
      {
        ...first,
        sourceRole: 'primary_current',
        sourceVariant: firstCompiled ? 'compiled' : 'annotated',
      },
      ...(second === undefined
        ? []
        : [
            {
              ...second,
              sourceRole: 'historical_auxiliary' as const,
              sourceVariant: 'annotated' as const,
            },
          ]),
    ];
  }

  return [
    { ...second, sourceRole: 'primary_current', sourceVariant: 'compiled' },
    { ...first, sourceRole: 'historical_auxiliary', sourceVariant: 'annotated' },
  ];
};
