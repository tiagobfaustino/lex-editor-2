const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export type RendererLocation =
  | Readonly<{
      kind: 'development';
      url: string;
      trustedOrigin: string;
    }>
  | Readonly<{
      kind: 'production';
      url: string;
    }>;

type ResolveRendererLocationInput = Readonly<{
  developmentUrl?: string;
  productionUrl: string;
}>;

export const resolveRendererLocation = ({
  developmentUrl,
  productionUrl,
}: ResolveRendererLocationInput): RendererLocation => {
  if (!developmentUrl) {
    const parsedProductionUrl = new URL(productionUrl);

    if (parsedProductionUrl.protocol !== 'file:') {
      throw new Error('A interface de produção deve usar uma URL file local.');
    }

    return Object.freeze({
      kind: 'production',
      url: parsedProductionUrl.href,
    });
  }

  const parsedDevelopmentUrl = new URL(developmentUrl);

  if (
    parsedDevelopmentUrl.protocol !== 'http:' ||
    !loopbackHosts.has(parsedDevelopmentUrl.hostname) ||
    parsedDevelopmentUrl.username ||
    parsedDevelopmentUrl.password
  ) {
    throw new Error('A interface de desenvolvimento deve usar HTTP em loopback.');
  }

  return Object.freeze({
    kind: 'development',
    url: parsedDevelopmentUrl.href,
    trustedOrigin: parsedDevelopmentUrl.origin,
  });
};

export const isTrustedRendererUrl = (location: RendererLocation, candidateUrl: string): boolean => {
  try {
    const parsedCandidate = new URL(candidateUrl);

    if (location.kind === 'development') {
      return parsedCandidate.origin === location.trustedOrigin;
    }

    return parsedCandidate.href === location.url;
  } catch {
    return false;
  }
};
