import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createLegalNormCatalog,
  createVincuLexPackage,
  detectLegalReferences,
  normalizeEditorialReferenceText,
  processar,
  projectLegalReferenceSqlEdges,
  resolveLegalReferences,
  type IdentifiedNormaAST,
  type LegalNormCatalog,
  type LegalReferenceIndex,
  type MetadadosDaNorma,
} from '@lex-editor/legal-domain';
import { describe, expect, it, vi } from 'vitest';

const FIXTURES = join(process.cwd(), 'fixtures', 'legal');
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const sha256File = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

interface FixtureManifest extends MetadadosDaNorma {
  readonly sourceType: 'planalto_html';
  readonly sourceRole: 'primary_current';
  readonly sourceVariant: 'annotated' | 'compiled';
  readonly snapshotSha256: Readonly<Record<string, string>>;
}

const manifest = (law: 'nllc' | 'cf1988'): FixtureManifest =>
  JSON.parse(readFileSync(join(FIXTURES, law, 'manifesto.json'), 'utf8')) as FixtureManifest;

const processFixture = (law: 'nllc' | 'cf1988'): IdentifiedNormaAST => {
  const metadata = manifest(law);
  const content = readFileSync(join(FIXTURES, law, 'entrada.txt'), 'utf8');
  const artifactHash = sha256(content);
  const result = processar({
    conteudo: content,
    referenciaBase: {
      sourceType: metadata.sourceType,
      sourceRole: metadata.sourceRole,
      sourceVariant: metadata.sourceVariant,
      sourceUrl: metadata.fonte,
      sourceArtifactSha256: artifactHash,
      fragmentSha256: artifactHash,
    },
    hashDaLinha: sha256,
    metadados: metadata,
  });
  if (!result.relatorio.ok || result.arvore === undefined) {
    throw new Error(JSON.stringify(result.relatorio.problemas));
  }
  return result.arvore;
};

const catalogOrThrow = (
  nllc: IdentifiedNormaAST,
  constitution: IdentifiedNormaAST,
): Readonly<LegalNormCatalog> => {
  const result = createLegalNormCatalog(
    [
      { ast: nllc, aliases: ['Lei nº 14.133/2021', 'NLLC'] },
      { ast: constitution, aliases: ['Constituição Federal', 'CF', 'CF/88'] },
    ],
    { sha256 },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.problemas));
  return result.valor;
};

const resolveOrThrow = (
  ast: IdentifiedNormaAST,
  catalog: Readonly<LegalNormCatalog>,
): Readonly<LegalReferenceIndex> => {
  const detected = detectLegalReferences(ast, { sha256 });
  if (!detected.ok) throw new Error(JSON.stringify(detected.problemas));
  const resolved = resolveLegalReferences(
    { sourceAst: ast, index: detected.valor, catalog },
    { sha256 },
  );
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.problemas));
  return resolved.valor;
};

describe('referências reais da Lei nº 14.133/2021', () => {
  it('versiona a fonte completa e confere a integridade de todos os artefatos derivados', () => {
    const metadata = manifest('nllc');
    for (const [file, expectedHash] of Object.entries(metadata.snapshotSha256)) {
      expect(sha256File(join(FIXTURES, 'nllc', file)), file).toBe(expectedHash);
    }

    const complete = readFileSync(join(FIXTURES, 'nllc', 'entrada-completa.txt'), 'utf8');
    expect(complete).toMatch(/^Art\. 1º/u);
    expect(complete).toContain('Art. 194. Esta Lei entra em vigor');
    expect(complete.match(/^~?~?Art\.\s*\d/gmu)?.length).toBe(211);
  });

  it('resolve os exemplos oficiais do § 4º e do § 5º para os Block IDs semânticos', () => {
    const nllc = processFixture('nllc');
    const constitution = processFixture('cf1988');
    const index = resolveOrThrow(nllc, catalogOrThrow(nllc, constitution));

    expect(
      index.references.find(
        ({ sourceBlockId, span }) => sourceBlockId === 'nllc-art-1-par-4' && span.text === '§ 3º',
      ),
    ).toMatchObject({
      state: 'resolved',
      target: { blockId: 'nllc-art-1-par-3' },
    });
    expect(
      index.references.find(
        ({ sourceBlockId, span }) =>
          sourceBlockId === 'nllc-art-1-par-5' && span.text === 'caput do art. 37',
      ),
    ).toMatchObject({
      state: 'resolved',
      target: {
        law: { tipoNorma: 'constituição', numero: '1988', ano: 1988 },
        blockId: 'cf1988-art-37',
      },
    });
  });

  it('ignora tags, realces, wikilinks e IDs pessoais ao comparar com a fonte oficial', () => {
    const official = readFileSync(join(FIXTURES, 'nllc', 'entrada.txt'), 'utf8')
      .split('\n')
      .filter((line) => /^§ [45]º/u.test(line))
      .map(normalizeEditorialReferenceText);
    const personal = readFileSync(join(FIXTURES, 'nllc', 'markdown-pessoal-artigo-1.md'), 'utf8')
      .split('\n')
      .filter((line) => /^\s*\* § [45]º/u.test(line))
      .map(normalizeEditorialReferenceText);

    expect(personal).toEqual(official);
    expect(personal.join('\n')).not.toMatch(/NavegaLei|\[\[|\^472c1ce|<mark>|\*\*/u);
  });

  it.each(['complete_with_history', 'current_only'] as const)(
    'mantém exportação e arestas canônicas determinísticas, sem rede, no perfil %s',
    (profile) => {
      const forbiddenFetch = vi.fn(() => {
        throw new Error('A suíte offline tentou acessar a rede.');
      });
      vi.stubGlobal('fetch', forbiddenFetch);
      try {
        const nllc = processFixture('nllc');
        const constitution = processFixture('cf1988');
        const catalog = catalogOrThrow(nllc, constitution);
        const nllcIndex = resolveOrThrow(nllc, catalog);
        const constitutionIndex = resolveOrThrow(constitution, catalog);
        const createPackage = () =>
          createVincuLexPackage(
            {
              catalog,
              documents: [
                { ast: nllc, referenceIndex: nllcIndex },
                { ast: constitution, referenceIndex: constitutionIndex },
              ],
              profile,
            },
            { sha256 },
          );
        const first = createPackage();
        const second = createPackage();
        expect(first.ok).toBe(true);
        expect(second).toEqual(first);
        if (!first.ok) return;

        const markdown = first.valor.files.find(({ canonicalKey }) =>
          canonicalKey.startsWith('lei ordinária:'),
        )?.markdown;
        expect(markdown).toContain('[[#^nllc-art-1-par-3|§ 3º]] deste artigo');
        expect(markdown).toContain(
          '[[VincuLex/constituicao-da-republica-federativa-do-brasil-de-1988/cf1988#^cf1988-art-37|caput do art. 37]]',
        );

        const sql = projectLegalReferenceSqlEdges(nllcIndex);
        expect(sql.ok).toBe(true);
        if (sql.ok) {
          expect(sql.valor).toContainEqual(
            expect.objectContaining({
              source_block_id: 'nllc-art-1-par-5',
              target_block_id: 'cf1988-art-37',
              state: 'resolved',
            }),
          );
        }
        expect(forbiddenFetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
    15_000,
  );
});
