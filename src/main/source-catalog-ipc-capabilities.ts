import { createHash } from 'node:crypto';
import { installedSourceAdapterRegistry } from '@lex-editor/source-ingestion';

import type { SourceCatalogService } from '../../services/source-catalog/src/index.js';
import {
  ActivatedSourceBindingDtoSchema,
  ChangedSourceBindingActivationDtoSchema,
  CreatedLawSourceBindingRevisionDtoSchema,
  CreatedSourceProviderRevisionDtoSchema,
  SourceCatalogPageDtoSchema,
  SourceDryRunDtoSchema,
  RequestedSourceCheckDtoSchema,
} from '../shared/ipc/sources.js';
import type { DesktopSourceCatalogIpcCapabilities } from './ipc/register.js';

type MaybePromise<Value> = Value | Promise<Value>;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right, 'en-US'),
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
};

const configDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export const createDesktopSourceCatalogIpcCapabilities = (options: {
  service: SourceCatalogService;
  getAccessToken(): MaybePromise<string | null>;
}): DesktopSourceCatalogIpcCapabilities => {
  const hasSession = async (): Promise<boolean> => (await options.getAccessToken()) !== null;
  const accessToken = async (): Promise<string> => {
    const token = await options.getAccessToken();
    if (token === null) throw new Error('Source catalog session is unavailable.');
    return token;
  };

  return {
    listCatalog: {
      authorize: hasSession,
      handle: async (input) => {
        const page = await options.service.listCatalog(await accessToken(), input);
        return SourceCatalogPageDtoSchema.parse({
          ...page,
          adapterCapabilities: installedSourceAdapterRegistry.listCapabilities(),
        });
      },
    },
    createProviderRevision: {
      authorize: hasSession,
      handle: async (input) => {
        const { providerId, expectedLockVersion, ...configuration } = input;
        const result = await options.service.createProviderRevision(await accessToken(), {
          ...(providerId === undefined ? {} : { providerId }),
          expectedLockVersion,
          ...configuration,
          configDigest: configDigest(configuration),
        });
        return CreatedSourceProviderRevisionDtoSchema.parse({
          providerId: result.provider.providerId,
          providerRevisionId: result.revision.providerRevisionId,
          revisionNumber: result.revision.revisionNumber,
          providerLockVersion: result.provider.lockVersion,
        });
      },
    },
    createBindingRevision: {
      authorize: hasSession,
      handle: async (input) => {
        const { bindingId, expectedLockVersion, ...configuration } = input;
        const result = await options.service.createBindingRevision(await accessToken(), {
          ...(bindingId === undefined ? {} : { bindingId }),
          expectedLockVersion,
          ...configuration,
          configDigest: configDigest(configuration),
        });
        return CreatedLawSourceBindingRevisionDtoSchema.parse({
          bindingId: result.binding.bindingId,
          bindingRevisionId: result.revision.bindingRevisionId,
          revisionNumber: result.revision.revisionNumber,
          bindingLockVersion: result.binding.lockVersion,
        });
      },
    },
    dryRunBinding: {
      authorize: hasSession,
      handle: async (input) => {
        const result = await options.service.dryRunBindingRevision(await accessToken(), input);
        return SourceDryRunDtoSchema.parse({
          testEvidenceId: result.testEvidenceId,
          providerRevisionId: result.providerRevisionId,
          bindingRevisionId: result.bindingRevisionId,
          sourceTestOutcome: result.sourceTestOutcome,
          completedStage: result.completedStage,
          evidenceDigest: result.evidenceDigest,
          errorCode: result.errorCode,
          testedAt: result.testedAt,
        });
      },
    },
    activateBinding: {
      authorize: hasSession,
      handle: async (input) => {
        const result = await options.service.activateBindingRevision(await accessToken(), input);
        return ActivatedSourceBindingDtoSchema.parse({
          providerId: result.provider.providerId,
          providerRevisionId: result.provider.activeProviderRevisionId,
          providerLockVersion: result.provider.lockVersion,
          bindingId: result.binding.bindingId,
          bindingRevisionId: result.binding.activeBindingRevisionId,
          bindingLockVersion: result.binding.lockVersion,
          sourceActivationState: result.binding.sourceActivationState,
        });
      },
    },
    pauseBinding: {
      authorize: hasSession,
      handle: async (input) => {
        const result = await options.service.pauseBinding(await accessToken(), input);
        return ChangedSourceBindingActivationDtoSchema.parse({
          bindingId: result.bindingId,
          bindingRevisionId: result.activeBindingRevisionId,
          bindingLockVersion: result.lockVersion,
          sourceActivationState: result.sourceActivationState,
        });
      },
    },
    archiveBinding: {
      authorize: hasSession,
      handle: async (input) => {
        const result = await options.service.archiveBinding(await accessToken(), input);
        return ChangedSourceBindingActivationDtoSchema.parse({
          bindingId: result.bindingId,
          bindingRevisionId: result.activeBindingRevisionId,
          bindingLockVersion: result.lockVersion,
          sourceActivationState: result.sourceActivationState,
        });
      },
    },
    restoreBinding: {
      authorize: hasSession,
      handle: async (input) => {
        const result = await options.service.restoreBindingRevision(await accessToken(), input);
        return ActivatedSourceBindingDtoSchema.parse({
          providerId: result.provider.providerId,
          providerRevisionId: result.provider.activeProviderRevisionId,
          providerLockVersion: result.provider.lockVersion,
          bindingId: result.binding.bindingId,
          bindingRevisionId: result.binding.activeBindingRevisionId,
          bindingLockVersion: result.binding.lockVersion,
          sourceActivationState: result.binding.sourceActivationState,
        });
      },
    },
    requestSourceCheck: {
      authorize: hasSession,
      handle: async (input) => {
        const result = await options.service.requestSourceCheck(await accessToken(), input);
        return RequestedSourceCheckDtoSchema.parse({
          sourceCheckJobId: result.sourceCheckJobId,
          bindingId: result.bindingId,
          bindingRevisionId: result.bindingRevisionId,
          sourceCheckJobState: result.sourceCheckJobState,
          requestedAt: result.requestedAt,
          deduplicated: result.deduplicated,
        });
      },
    },
  };
};
