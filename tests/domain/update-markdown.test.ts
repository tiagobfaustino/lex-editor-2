import { describe, expect, it } from 'vitest';

import {
  deriveStructuredChanges,
  generateUpdateMarkdown,
  identifiedMinima,
  updateEntrySchema,
  type UpdateEntry,
} from '../../packages/legal-domain/src/index.js';

const changes: UpdateEntry['changes'] = {
  included: [{ blockId: 'lcp-art-3', description: 'Art. 3 incluído.' }],
  amended: [{ blockId: 'lcp-art-2', description: 'Art. 2 alterado.' }],
  revoked: [{ blockId: 'lcp-art-4', description: 'Art. 4 revogado.' }],
  renumbered: [{ from: 'lcp-art-5', to: 'lcp-art-5-a', description: 'Art. 5 renumerado.' }],
};

const entry = (kind: UpdateEntry['kind']): UpdateEntry => ({
  publicationDate: '2026-08-10',
  version: kind === 'initial' ? '1.0.0' : '1.2.0',
  publicationNumber: kind === 'initial' ? 1 : 2,
  kind,
  sourceSummary: 'Texto consolidado conferido na fonte oficial.',
  changes,
  ...(kind === 'legislative_update' ? { changingLaw: 'Lei nº 15.000/2026' } : {}),
  ...(kind === 'rollback'
    ? {
        restoredVersion: '1.0.0',
        rollbackJustification: 'Restauração necessária após divergência normativa confirmada.',
      }
    : {}),
});

describe('UPDATE.md', () => {
  it.each([
    ['initial', 'Publicação inicial'],
    ['legislative_update', 'Atualização legislativa'],
    ['editorial_correction', 'Correção editorial'],
    ['rollback', 'Rollback'],
  ] as const)('gera uma entrada determinística para %s', (kind, label) => {
    const markdown = generateUpdateMarkdown([entry(kind)]);
    expect(markdown).toContain(`# Atualizações\n\n## Publicação`);
    expect(markdown).toContain(`- **Tipo:** ${label}`);
    expect(markdown).toContain('- **Atribuição pública:** Equipe editorial Vinculex');
    expect(markdown).toContain('`lcp-art-5` → `lcp-art-5-a`');
    expect(markdown).not.toContain('CHANGELOG.md');
  });

  it('ordena publicações e mudanças sem depender da ordem de entrada', () => {
    const initial = entry('initial');
    const correction = {
      ...entry('editorial_correction'),
      changes: {
        ...changes,
        included: [...changes.included].reverse(),
      },
    };
    const first = generateUpdateMarkdown([initial, correction]);
    const second = generateUpdateMarkdown([correction, initial]);
    expect(first).toBe(second);
    expect(first.indexOf('Publicação 2')).toBeLessThan(first.indexOf('Publicação 1'));
  });

  it('rejeita rollback incompleto e publicação inicial fora do contrato', () => {
    const incompleteRollback: unknown = {
      ...entry('rollback'),
      restoredVersion: undefined,
      rollbackJustification: undefined,
    };
    expect(() => updateEntrySchema.parse(incompleteRollback)).toThrow();
    expect(() => generateUpdateMarkdown([{ ...entry('initial'), version: '1.0.1' }])).toThrow();
  });

  it('deriva inclusão, alteração, revogação e renumeração por Block ID', () => {
    const before = structuredClone(identifiedMinima);
    const amendedAst = structuredClone(identifiedMinima);
    const article = amendedAst.children[0];
    const oldArticle = before.children[0];
    if (article?.tipo !== 'artigo' || oldArticle?.tipo !== 'artigo')
      throw new Error('Fixture inválida');
    article.caput = 'Texto normativo alterado.';
    expect(deriveStructuredChanges(before, amendedAst).amended).toEqual([
      { blockId: article.blockId, description: `Art. ${article.numero} alterado.` },
    ]);

    const revokedAst = structuredClone(before);
    const revokedArticle = revokedAst.children[0];
    if (revokedArticle?.tipo !== 'artigo') throw new Error('Fixture inválida');
    revokedArticle.deviceStatus = 'revoked';
    revokedArticle.preservarTextoRevogado = true;
    expect(deriveStructuredChanges(before, revokedAst).revoked).toEqual([
      {
        blockId: revokedArticle.blockId,
        description: `Art. ${revokedArticle.numero} revogado.`,
      },
    ]);

    const renumberedAst = structuredClone(before);
    const renumberedArticle = renumberedAst.children[0];
    if (renumberedArticle?.tipo !== 'artigo') throw new Error('Fixture inválida');
    renumberedArticle.renumeradoPara = `${renumberedArticle.blockId}-a`;
    expect(deriveStructuredChanges(before, renumberedAst).renumbered).toEqual([
      {
        from: renumberedArticle.blockId,
        to: `${renumberedArticle.blockId}-a`,
        description: `Art. ${renumberedArticle.numero} renumerado.`,
      },
    ]);

    const initial = deriveStructuredChanges(null, amendedAst);
    expect(initial.included.length).toBeGreaterThan(0);
    expect(initial.included.map((item) => item.blockId)).toEqual(
      [...initial.included.map((item) => item.blockId)].sort(),
    );
  });
});
