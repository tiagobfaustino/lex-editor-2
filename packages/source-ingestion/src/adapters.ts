import { z } from 'zod';

import {
  lawSourceBindingRevisionSchema,
  providerRevisionSchema,
  type LawSourceBindingRevision,
  type ProviderRevision,
} from './contracts.js';

export const sourceAdapterIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

export const planaltoDetectionParametersSchema = z.strictObject({
  requireLegalHeader: z.boolean(),
});

export type PlanaltoDetectionParameters = z.infer<typeof planaltoDetectionParametersSchema>;

export const sourceAdapterCapabilitiesSchema = z.strictObject({
  adapterId: sourceAdapterIdSchema,
  contractVersion: z.int().positive(),
  displayName: z.string().trim().min(3).max(120),
  supportedSourceTypes: z.array(z.enum(['planalto_html', 'lexml_xml'])).min(1),
  allowedSchemes: z.array(z.enum(['http', 'https'])).min(1),
  allowedHosts: z.array(z.string().min(1).max(253)).min(1),
  allowsCustomPort: z.boolean(),
  maximumArtifacts: z.int().min(1).max(10),
  supportedSourceRoles: z
    .array(z.enum(['primary_current', 'historical_auxiliary', 'cross_check']))
    .min(1),
  supportedSourceVariants: z.array(z.enum(['compiled', 'annotated', 'other'])).min(1),
  detectionFields: z.array(
    z.strictObject({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(120),
      valueKind: z.literal('boolean'),
      defaultValue: z.boolean(),
      required: z.boolean(),
    }),
  ),
});

export type SourceAdapterCapabilities = z.infer<typeof sourceAdapterCapabilitiesSchema>;

export class SourceAdapterConfigurationError extends Error {
  constructor(
    readonly code:
      | 'ADAPTER_NOT_INSTALLED'
      | 'ADAPTER_VERSION_UNSUPPORTED'
      | 'ADAPTER_SOURCE_TYPE_UNSUPPORTED'
      | 'ADAPTER_PARAMETERS_INVALID'
      | 'ADAPTER_ORIGIN_NOT_ALLOWED'
      | 'ADAPTER_ARTIFACT_NOT_ALLOWED'
      | 'ADAPTER_BINDING_MISMATCH',
  ) {
    super(code);
    this.name = 'SourceAdapterConfigurationError';
  }
}

export interface SourceAdapterDescriptor {
  readonly adapterId: string;
  readonly contractVersion: number;
  readonly supportedSourceTypes: readonly ProviderRevision['sourceType'][];
  readonly capabilities: SourceAdapterCapabilities;
  parseDetectionParameters(input: unknown): Readonly<Record<string, string | boolean | number>>;
  validateProviderRevision(revision: ProviderRevision): void;
  validateBindingRevision(provider: ProviderRevision, binding: LawSourceBindingRevision): void;
}

const PLANALTO_HOSTS = new Set(['planalto.gov.br', 'www.planalto.gov.br']);

const effectivePort = (url: URL): number =>
  url.port.length > 0 ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

const pathMatchesPrefix = (pathname: string, prefix: string): boolean =>
  prefix === '/' ||
  pathname === prefix ||
  pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

const parseAllowedArtifactUrl = (sourceUrl: string, provider: ProviderRevision): URL => {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new SourceAdapterConfigurationError('ADAPTER_ARTIFACT_NOT_ALLOWED');
  }
  const providerPort = provider.origin.port ?? (provider.origin.scheme === 'https' ? 443 : 80);
  if (
    url.protocol !== `${provider.origin.scheme}:` ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.hostname !== provider.origin.host ||
    effectivePort(url) !== providerPort ||
    !pathMatchesPrefix(url.pathname, provider.origin.pathPrefix) ||
    !PLANALTO_HOSTS.has(url.hostname)
  ) {
    throw new SourceAdapterConfigurationError('ADAPTER_ARTIFACT_NOT_ALLOWED');
  }
  return url;
};

export const planaltoAdapterDescriptor = Object.freeze({
  adapterId: 'planalto.html',
  contractVersion: 1,
  supportedSourceTypes: ['planalto_html'] as const,
  capabilities: sourceAdapterCapabilitiesSchema.parse({
    adapterId: 'planalto.html',
    contractVersion: 1,
    displayName: 'HTML oficial do Planalto',
    supportedSourceTypes: ['planalto_html'],
    allowedSchemes: ['https'],
    allowedHosts: ['planalto.gov.br', 'www.planalto.gov.br'],
    allowsCustomPort: false,
    maximumArtifacts: 2,
    supportedSourceRoles: ['primary_current', 'historical_auxiliary', 'cross_check'],
    supportedSourceVariants: ['compiled', 'annotated', 'other'],
    detectionFields: [
      {
        key: 'requireLegalHeader',
        label: 'Exigir cabeçalho jurídico reconhecível',
        valueKind: 'boolean',
        defaultValue: true,
        required: true,
      },
    ],
  }),
  parseDetectionParameters(input) {
    const parsed = planaltoDetectionParametersSchema.safeParse(input);
    if (!parsed.success) {
      throw new SourceAdapterConfigurationError('ADAPTER_PARAMETERS_INVALID');
    }
    return parsed.data;
  },
  validateProviderRevision(rawRevision) {
    const revision = providerRevisionSchema.parse(rawRevision);
    if (revision.adapterId !== this.adapterId) {
      throw new SourceAdapterConfigurationError('ADAPTER_NOT_INSTALLED');
    }
    if (revision.adapterContractVersion !== this.contractVersion) {
      throw new SourceAdapterConfigurationError('ADAPTER_VERSION_UNSUPPORTED');
    }
    if (!this.supportedSourceTypes.includes(revision.sourceType)) {
      throw new SourceAdapterConfigurationError('ADAPTER_SOURCE_TYPE_UNSUPPORTED');
    }
    this.parseDetectionParameters(revision.detectionParameters);
    if (
      revision.origin.scheme !== 'https' ||
      revision.origin.port !== null ||
      !PLANALTO_HOSTS.has(revision.origin.host)
    ) {
      throw new SourceAdapterConfigurationError('ADAPTER_ORIGIN_NOT_ALLOWED');
    }
  },
  validateBindingRevision(rawProvider, rawBinding) {
    const provider = providerRevisionSchema.parse(rawProvider);
    const binding = lawSourceBindingRevisionSchema.parse(rawBinding);
    this.validateProviderRevision(provider);
    if (binding.providerRevisionId !== provider.providerRevisionId) {
      throw new SourceAdapterConfigurationError('ADAPTER_BINDING_MISMATCH');
    }
    if (binding.artifacts.length > 2) {
      throw new SourceAdapterConfigurationError('ADAPTER_ARTIFACT_NOT_ALLOWED');
    }
    for (const artifact of binding.artifacts) parseAllowedArtifactUrl(artifact.sourceUrl, provider);
  },
} satisfies SourceAdapterDescriptor);

export interface SourceAdapterRegistry {
  listCapabilities(): readonly SourceAdapterCapabilities[];
  get(adapterId: string, contractVersion: number): SourceAdapterDescriptor;
  validateProviderRevision(revision: ProviderRevision): SourceAdapterDescriptor;
  validateBindingRevision(
    provider: ProviderRevision,
    binding: LawSourceBindingRevision,
  ): SourceAdapterDescriptor;
}

export const createSourceAdapterRegistry = (
  descriptors: readonly SourceAdapterDescriptor[],
): SourceAdapterRegistry => {
  const installed = new Map<string, SourceAdapterDescriptor>();
  for (const descriptor of descriptors) {
    const adapterId = sourceAdapterIdSchema.parse(descriptor.adapterId);
    const contractVersion = z.int().positive().parse(descriptor.contractVersion);
    const key = `${adapterId}\u0000${String(contractVersion)}`;
    if (installed.has(key)) throw new Error('DUPLICATE_SOURCE_ADAPTER');
    installed.set(key, descriptor);
  }

  const get = (adapterId: string, contractVersion: number): SourceAdapterDescriptor => {
    const parsedId = sourceAdapterIdSchema.parse(adapterId);
    const parsedVersion = z.int().positive().parse(contractVersion);
    const exact = installed.get(`${parsedId}\u0000${String(parsedVersion)}`);
    if (exact !== undefined) return exact;
    const hasAdapter = descriptors.some((descriptor) => descriptor.adapterId === parsedId);
    throw new SourceAdapterConfigurationError(
      hasAdapter ? 'ADAPTER_VERSION_UNSUPPORTED' : 'ADAPTER_NOT_INSTALLED',
    );
  };

  return Object.freeze({
    listCapabilities() {
      return descriptors.map((descriptor) => descriptor.capabilities);
    },
    get,
    validateProviderRevision(rawRevision) {
      const revision = providerRevisionSchema.parse(rawRevision);
      const descriptor = get(revision.adapterId, revision.adapterContractVersion);
      descriptor.validateProviderRevision(revision);
      return descriptor;
    },
    validateBindingRevision(rawProvider, rawBinding) {
      const provider = providerRevisionSchema.parse(rawProvider);
      const binding = lawSourceBindingRevisionSchema.parse(rawBinding);
      const descriptor = get(provider.adapterId, provider.adapterContractVersion);
      descriptor.validateBindingRevision(provider, binding);
      return descriptor;
    },
  } satisfies SourceAdapterRegistry);
};

export const installedSourceAdapterRegistry = createSourceAdapterRegistry([
  planaltoAdapterDescriptor,
]);
