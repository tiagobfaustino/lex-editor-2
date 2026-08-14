import { createHash } from 'node:crypto';

import {
  SourceAdapterConfigurationError,
  sourceCatalogDigestSchema,
  type LawSourceBindingRevision,
  type ProviderRevision,
} from '../index.js';
import { SourceExtractionError } from './defuddle.js';
import { ingestConfiguredPlanaltoSourceSet } from './ingest.js';
import { isPlanaltoNetworkError, type PlanaltoNetworkPorts } from './planalto-source.js';

export type SourceDryRunExecution = Readonly<{
  sourceTestOutcome: 'success' | 'failure';
  completedStage: 'policy' | 'network' | 'detection' | 'adapter';
  evidenceDigest: string;
  errorCode: string | null;
}>;

export interface SourceDryRunRunner {
  run(
    provider: ProviderRevision,
    binding: LawSourceBindingRevision,
  ): Promise<SourceDryRunExecution>;
}

const digestEvidence = (parts: readonly string[]): string =>
  sourceCatalogDigestSchema.parse(createHash('sha256').update(parts.join('\u0000')).digest('hex'));

export const createNodeSourceDryRunRunner = (ports?: PlanaltoNetworkPorts): SourceDryRunRunner => ({
  async run(provider, binding) {
    try {
      const result =
        ports === undefined
          ? await ingestConfiguredPlanaltoSourceSet(provider, binding)
          : await ingestConfiguredPlanaltoSourceSet(provider, binding, ports);
      return {
        sourceTestOutcome: 'success',
        completedStage: 'adapter',
        evidenceDigest: digestEvidence([
          provider.providerRevisionId,
          binding.bindingRevisionId,
          provider.configDigest,
          binding.configDigest,
          ...result.artifacts.map(({ snapshot }) => snapshot.sha256),
        ]),
        errorCode: null,
      };
    } catch (error) {
      const classified = isPlanaltoNetworkError(error)
        ? { completedStage: 'network' as const, errorCode: error.code }
        : error instanceof SourceAdapterConfigurationError
          ? { completedStage: 'policy' as const, errorCode: error.code }
          : error instanceof SourceExtractionError
            ? { completedStage: 'detection' as const, errorCode: 'SOURCE_UNRECOGNIZED' }
            : { completedStage: 'adapter' as const, errorCode: 'ADAPTER_FAILED' };
      return {
        sourceTestOutcome: 'failure',
        ...classified,
        evidenceDigest: digestEvidence([
          provider.providerRevisionId,
          binding.bindingRevisionId,
          provider.configDigest,
          binding.configDigest,
          classified.completedStage,
          classified.errorCode,
        ]),
      };
    }
  },
});
