import { createHash } from 'node:crypto';

import {
  decodificarHtmlPlanalto,
  extrairLinhas,
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
  const artifacts = await Promise.all(
    fetched.map(async (artifact): Promise<IngestedPlanaltoArtifact> => {
      const original = decodificarHtmlPlanalto(artifact.bytes);
      // `SourceSnapshot.conteudo` é a representação textual preservada pelo
      // domínio; seu digest precisa ser recalculável sobre esses mesmos bytes
      // UTF-8 no worker de detecção, inclusive quando a origem veio em
      // windows-1252.
      const artifactSha256 = sha256(original);
      const defuddled = await defuddleSnapshot(original, artifact.finalUrl);
      const lines = extrairLinhas(defuddled.cleanedHtml, { reconhecer });
      const firstLegalLine = lines.findIndex((line) => reconhecer(line) !== undefined);
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
    }),
  );
  return {
    providerRevisionId: provider.providerRevisionId,
    bindingRevisionId: binding.bindingRevisionId,
    artifacts,
  };
};
