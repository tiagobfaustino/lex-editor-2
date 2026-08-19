import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  applyEditorialCommand,
  calculateRevisionHash,
  identifiedMinima,
  legalNormIdentityKey,
  provePublicationHistory,
  publicationHistoryEvidenceSchema,
  type EditorialCommand,
  type IdentifiedNormaAST,
  type MetadataWorkspaceContext,
  type PublicationHistoryAuthority,
  type PublicationHistoryState,
} from '@lex-editor/legal-domain';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

type MetadataChanges = Extract<
  EditorialCommand['operation'],
  { kind: 'set_law_metadata' }
>['changes'];

const evidenceFor = (
  ast: IdentifiedNormaAST,
  state: PublicationHistoryState,
  identityKey = legalNormIdentityKey(ast),
) =>
  publicationHistoryEvidenceSchema.parse({
    schemaVersion: 1,
    canonicalIdentityKey: identityKey,
    state,
    authorityRevision: state === 'unknown' ? null : 'authority-revision-42',
  });

const command = (ast: IdentifiedNormaAST, changes: MetadataChanges): EditorialCommand => ({
  schemaVersion: 1,
  commandId: '11111111-1111-4111-8111-111111111111',
  localActorId: 'editor-local-01',
  occurredAt: '2026-08-14T12:00:00.000-03:00',
  expectedRevisionHash: calculateRevisionHash(ast, sha256),
  operation: {
    kind: 'set_law_metadata',
    changes,
    reason: 'Correção conferida contra a fonte e o histórico autoritativo.',
  },
});

const referringLaw = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Lei de referência';
  ast.sigla = 'lref';
  ast.numero = '99';
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
  article.id = 'reference-article-node';
  article.blockId = 'lref-art-1';
  article.caput = 'Aplica-se o art. 1º da Lei nº 1.234/2026.';
  return ast;
};

const workspaceFor = (
  current: IdentifiedNormaAST,
  others: readonly IdentifiedNormaAST[] = [],
): MetadataWorkspaceContext => ({
  currentDocumentId: 'current-law',
  documents: [
    { documentId: 'current-law', ast: current },
    ...others.map((ast, index) => ({ documentId: `related-law-${String(index + 1)}`, ast })),
  ],
});

const allBlockIds = (ast: IdentifiedNormaAST): readonly string[] => {
  const ids: string[] = [];
  const visit = (node: Record<string, unknown>): void => {
    if (typeof node['blockId'] === 'string') ids.push(node['blockId']);
    for (const child of Array.isArray(node['children']) ? node['children'] : []) {
      visit(child as Record<string, unknown>);
    }
  };
  visit(ast as unknown as Record<string, unknown>);
  return ids;
};

describe('prova autoritativa de histórico de publicação', () => {
  it('só prova ausência quando a autoridade responde lista vazia e versionada', async () => {
    const inspect = vi.fn<PublicationHistoryAuthority['inspect']>(() =>
      Promise.resolve({
        availability: 'available',
        authorityRevision: 'db-snapshot-17',
        publishedVersionIds: [],
      }),
    );
    const evidence = await provePublicationHistory(identifiedMinima, { inspect });

    expect(inspect).toHaveBeenCalledWith({
      tipoNorma: identifiedMinima.tipoNorma,
      numero: identifiedMinima.numero,
      ano: identifiedMinima.ano,
    });
    expect(evidence).toMatchObject({
      state: 'never_published',
      authorityRevision: 'db-snapshot-17',
      canonicalIdentityKey: legalNormIdentityKey(identifiedMinima),
    });
  });

  it('distingue versão publicada e falha fechada quando a autoridade está indisponível', async () => {
    const published = await provePublicationHistory(identifiedMinima, {
      inspect: () =>
        Promise.resolve({
          availability: 'available',
          authorityRevision: 'db-snapshot-18',
          publishedVersionIds: ['22222222-2222-4222-8222-222222222222'],
        }),
    });
    const unavailable = await provePublicationHistory(identifiedMinima, {
      inspect: () => Promise.reject(new Error('offline')),
    });

    expect(published.state).toBe('published');
    expect(unavailable).toMatchObject({ state: 'unknown', authorityRevision: null });
  });

  it('recusa evidência válida pertencente a outra identidade', () => {
    const result = applyEditorialCommand(
      identifiedMinima,
      command(identifiedMinima, { numero: '2' }),
      sha256,
      {
        publicationHistoryEvidence: evidenceFor(
          identifiedMinima,
          'never_published',
          'lei ordinária:outra:2026',
        ),
        metadataWorkspace: workspaceFor(identifiedMinima),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'publication_history_required' },
    });
  });
});

describe('transação pré-publicação de identidade e derivados', () => {
  it('regenera Block IDs, catálogo, layouts, referências e Markdown como um único resultado', () => {
    const original = clone(identifiedMinima);
    const result = applyEditorialCommand(
      original,
      command(original, { sigla: 'nova', numero: '2' }),
      sha256,
      {
        publicationHistoryEvidence: evidenceFor(original, 'never_published'),
        metadataWorkspace: workspaceFor(original, [referringLaw()]),
      },
    );

    expect(result.ok).toBe(true);
    expect(original).toEqual(identifiedMinima);
    if (!result.ok || result.metadataDerivatives === undefined) {
      throw new Error('A transação de identidade deveria produzir derivados.');
    }
    expect(result.structuralChange).toBe(true);
    expect(allBlockIds(result.ast).every((id) => id.startsWith('nova-'))).toBe(true);
    expect(result.ast.idsDepreciados).toBeUndefined();
    expect(result.ast.children[0]).toMatchObject({
      tipo: 'artigo',
      caput:
        identifiedMinima.children[0]?.tipo === 'artigo' ? identifiedMinima.children[0].caput : '',
      sourceRef: identifiedMinima.children[0]?.sourceRef,
      parseEvidence: identifiedMinima.children[0]?.parseEvidence,
    });

    const derivatives = result.metadataDerivatives;
    const changedEntry = derivatives.catalog.entries.find((entry) => entry.acronym === 'nova');
    expect(changedEntry).toMatchObject({ law: { numero: '2' } });
    expect(
      derivatives.layouts.completeWithHistory.entries.find(
        (entry) => entry.canonicalKey === changedEntry?.canonicalKey,
      ),
    ).toMatchObject({ fileName: 'nova', blockIds: allBlockIds(result.ast) });
    const changedDocument = derivatives.documents.find(
      ({ documentId }) => documentId === 'current-law',
    );
    expect(changedDocument?.markdown.completeWithHistory).toContain('sigla: "nova"');
    expect(changedDocument?.markdown.currentOnly).toContain('projection_profile: "current_only"');

    const relatedDocument = derivatives.documents.find(
      ({ documentId }) => documentId === 'related-law-1',
    );
    expect(relatedDocument?.referenceIndex.references[0]).toMatchObject({
      state: 'unresolved',
      reason: 'law_not_imported',
    });
  });

  it('preserva integralmente a revisão anterior quando a nova identidade colide', () => {
    const original = clone(identifiedMinima);
    const collision = clone(identifiedMinima);
    collision.titulo = 'Lei já cadastrada sob a identidade de destino';
    collision.sigla = 'destino';
    collision.numero = '2';
    const collisionArticle = collision.children[0];
    if (collisionArticle?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    collisionArticle.blockId = 'destino-art-1';

    const result = applyEditorialCommand(original, command(original, { numero: '2' }), sha256, {
      publicationHistoryEvidence: evidenceFor(original, 'never_published'),
      metadataWorkspace: workspaceFor(original, [collision]),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'metadata_derivation_failed' },
    });
    expect(original).toEqual(identifiedMinima);
  });

  it('não aceita identidade sem o workspace necessário à promoção atômica', () => {
    const result = applyEditorialCommand(
      identifiedMinima,
      command(identifiedMinima, { sigla: 'nova' }),
      sha256,
      { publicationHistoryEvidence: evidenceFor(identifiedMinima, 'never_published') },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'metadata_workspace_required' },
    });
  });
});

describe('título e derivados sem reparsear conteúdo jurídico', () => {
  it('atualiza catálogo, aliases, layout e Markdown sem tocar nos dispositivos', () => {
    const original = clone(identifiedMinima);
    const originalChildren = clone(original.children);
    const result = applyEditorialCommand(
      original,
      command(original, { titulo: 'Novo título editorial da lei' }),
      sha256,
      { metadataWorkspace: workspaceFor(original, [referringLaw()]) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.metadataDerivatives === undefined) {
      throw new Error('A correção de título deveria produzir derivados.');
    }
    expect(result.ast.children).toEqual(originalChildren);
    expect(allBlockIds(result.ast)).toEqual(allBlockIds(original));
    const entry = result.metadataDerivatives.catalog.entries[0];
    expect(entry?.title).toBe('Novo título editorial da lei');
    expect(entry?.aliases.map(({ display }) => display)).toContain('Novo título editorial da lei');
    expect(entry?.aliases.map(({ display }) => display)).not.toContain(original.titulo);
    expect(result.metadataDerivatives.layouts.completeWithHistory.entries[0]).toMatchObject({
      directoryName: 'novo-titulo-editorial-da-lei',
    });
    const derived = result.metadataDerivatives.documents[0];
    expect(derived?.markdown.completeWithHistory).toContain(
      'title: "Novo título editorial da lei"',
    );
    expect(derived?.markdown.currentOnly).toContain('title: "Novo título editorial da lei"');
    const related = result.metadataDerivatives.documents.find(
      ({ documentId }) => documentId === 'related-law-1',
    );
    expect(
      related?.referenceIndex.references.find(({ locator }) => locator.scope === 'external_law'),
    ).toMatchObject({
      state: 'resolved',
      target: { revisionHash: result.revisionHash },
    });
  });
});
