import { createHash } from 'node:crypto';

import {
  decodificarHtmlPlanalto,
  extrairLinhasConjunto,
  juntarContinuacoes,
  reconhecer,
  type SourceSnapshot,
} from '@lex-editor/legal-domain';

import {
  installedSourceAdapterRegistry,
  planaltoDetectionParametersSchema,
  type LawSourceBindingRevision,
  type ProviderRevision,
} from '../index.js';
import { defuddleSnapshot, SourceExtractionError } from './defuddle.js';
import {
  fetchConfiguredPlanaltoSourceSet,
  type FetchedPlanaltoArtifact,
  type PlanaltoNetworkPorts,
} from './planalto-source.js';

export type IngestedPlanaltoArtifact = Readonly<{
  fetched: FetchedPlanaltoArtifact;
  snapshot: SourceSnapshot;
  extractedContent: string;
}>;

export type IngestedPlanaltoSourceSet = Readonly<{
  providerRevisionId: string;
  bindingRevisionId: string;
  artifacts: readonly IngestedPlanaltoArtifact[];
}>;

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

export const ingestConfiguredPlanaltoSourceSet = async (
  provider: ProviderRevision,
  binding: LawSourceBindingRevision,
  ports?: PlanaltoNetworkPorts,
): Promise<IngestedPlanaltoSourceSet> => {
  installedSourceAdapterRegistry.validateBindingRevision(provider, binding);
  const parameters = planaltoDetectionParametersSchema.parse(provider.detectionParameters);
  const fetched =
    ports === undefined
      ? await fetchConfiguredPlanaltoSourceSet(provider, binding)
      : await fetchConfiguredPlanaltoSourceSet(provider, binding, ports);
  const originals = fetched.map((artifact) => decodificarHtmlPlanalto(artifact.bytes));
  const cleaned = await Promise.all(
    fetched.map((artifact, index) => defuddleSnapshot(originals[index] ?? '', artifact.finalUrl)),
  );
  const linesBySource = extrairLinhasConjunto(
    cleaned.map(({ cleanedHtml }) => cleanedHtml),
    { reconhecer },
  );
  const artifacts = fetched.map((artifact, index): IngestedPlanaltoArtifact => {
    const original = originals[index] ?? '';
    // `SourceSnapshot.conteudo` é a representação textual preservada pelo
    // domínio; seu digest precisa ser recalculável sobre esses mesmos bytes
    // UTF-8 no worker de detecção, inclusive quando a origem veio em
    // windows-1252.
    const artifactSha256 = sha256(original);
    const lines = linesBySource[index] ?? [];
    const firstLegalLine = lines.findIndex(
      (line) => reconhecer(line.replace(/^~~|~~$/gu, '').trim()) !== undefined,
    );
    if (parameters.requireLegalHeader && firstLegalLine < 0) throw new SourceExtractionError();
    const selectedLines = firstLegalLine < 0 ? lines : lines.slice(firstLegalLine);
    const extractedContent = juntarContinuacoes(
      selectedLines,
      (line) => reconhecer(line) !== undefined,
    ).join('\n');
    if (extractedContent.trim().length === 0) throw new SourceExtractionError();
    return {
      fetched: artifact,
      snapshot: {
        sha256: artifactSha256,
        conteudo: original,
        referencia: {
          sourceType: 'planalto_html',
          sourceRole: artifact.sourceRole,
          sourceVariant: artifact.sourceVariant,
          sourceUrl: artifact.finalUrl,
          sourceArtifactSha256: artifactSha256,
          fragmentSha256: artifactSha256,
        },
      },
      extractedContent,
    };
  });
  return {
    providerRevisionId: provider.providerRevisionId,
    bindingRevisionId: binding.bindingRevisionId,
    artifacts,
  };
};
