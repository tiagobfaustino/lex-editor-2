import { Defuddle } from 'defuddle/node';

export class SourceExtractionError extends Error {
  constructor() {
    super('SOURCE_UNRECOGNIZED');
    this.name = 'SourceExtractionError';
  }
}

export type DefuddledDocument = Readonly<{
  cleanedHtml: string;
  cleanedMarkdown: string;
}>;

const denyNetwork: typeof globalThis.fetch = () => Promise.reject(new SourceExtractionError());

/**
 * Executa o Defuddle somente sobre o snapshot já capturado. O fallback de rede
 * da biblioteca fica desabilitado e recebe ainda um fetch que sempre nega.
 */
export const defuddleSnapshot = async (
  html: string,
  sourceUrl: string,
): Promise<DefuddledDocument> => {
  const result = await Defuddle(html, sourceUrl, {
    markdown: false,
    separateMarkdown: true,
    useAsync: false,
    fetch: denyNetwork,
    language: 'pt-BR',
    // Páginas jurídicas antigas não seguem a estrutura de artigos jornalísticos.
    // Remoção heurística agressiva pode apagar dispositivos válidos.
    removeLowScoring: false,
    removeExactSelectors: false,
    removePartialSelectors: false,
    removeHiddenElements: false,
    removeImages: true,
  });
  const cleanedHtml = result.content.trim();
  const cleanedMarkdown = result.contentMarkdown?.trim() ?? '';

  if (cleanedHtml.length === 0 || cleanedMarkdown.length === 0) {
    throw new SourceExtractionError();
  }

  return { cleanedHtml, cleanedMarkdown };
};
