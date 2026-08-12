import { createHash } from 'node:crypto';

import {
  createLegalNormCatalog,
  createVincuLexPackage,
  detectLegalReferences,
  formatar,
  identifiedMinima,
  projectLegalReferenceSqlEdges,
  resolveLegalReferences,
  validarMarkdownCanonico,
  type IdentifiedNormaAST,
  type LegalNormCatalog,
  type LegalReferenceIndex,
  type VincuLexLayout,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

const nllcFixture = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Lei nº 14.133, de 1º de abril de 2021';
  ast.sigla = 'NLLC';
  ast.tipoNorma = 'lei ordinária';
  ast.numero = '14.133';
  ast.ano = 2021;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
  article.blockId = 'nllc-art-1';
  const common = {
    sourceRef: article.sourceRef,
    parseEvidence: article.parseEvidence,
    children: [] as [],
  };
  article.children = [
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-3',
      ordem: 0,
      blockId: 'nllc-art-1-par-3',
      numero: '3',
      texto: 'Nas licitações serão observadas as condições legais.',
      deviceStatus: 'active',
    },
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-4',
      ordem: 1,
      blockId: 'nllc-art-1-par-4',
      numero: '4',
      texto: 'A documentação de que trata o § 3º deste artigo será apresentada.',
      deviceStatus: 'active',
    },
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-5',
      ordem: 2,
      blockId: 'nllc-art-1-par-5',
      numero: '5',
      texto: 'Aplicam-se os princípios previstos no caput do art. 37 da Constituição Federal.',
      deviceStatus: 'active',
    },
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-6',
      ordem: 3,
      blockId: 'nllc-art-1-par-6',
      numero: '6',
      texto: 'Aplicava-se também o caput do art. 37 da Constituição Federal.',
      deviceStatus: 'revoked',
      preservarTextoRevogado: true,
      notaStatus: '(Revogado)',
    },
  ];
  return ast;
};

const constitutionFixture = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Constituição Federal';
  ast.sigla = 'CF88';
  ast.tipoNorma = 'constituição';
  ast.numero = '1988';
  ast.ano = 1988;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
  article.numero = '37';
  article.blockId = 'cf1988-art-37';
  article.caput = 'A administração pública obedecerá aos princípios constitucionais.';
  return ast;
};

const catalogOrThrow = (laws: readonly IdentifiedNormaAST[]): Readonly<LegalNormCatalog> => {
  const result = createLegalNormCatalog(
    laws.map((ast) => ({
      ast,
      aliases: ast.sigla === 'CF88' ? ['Constituição Federal', 'CF', 'CF/88'] : [],
    })),
    { sha256 },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.problemas));
  return result.valor;
};

const indexOrThrow = (
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

const packageFixture = (profile: 'complete_with_history' | 'current_only') => {
  const nllc = nllcFixture();
  const constitution = constitutionFixture();
  const catalog = catalogOrThrow([nllc, constitution]);
  const nllcIndex = indexOrThrow(nllc, catalog);
  const constitutionIndex = indexOrThrow(constitution, catalog);
  const pkg = createVincuLexPackage(
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
  if (!pkg.ok) throw new Error(JSON.stringify(pkg.problemas));
  return { nllc, constitution, catalog, nllcIndex, package: pkg.valor };
};

describe('Formatter e pacote VincuLex', () => {
  it.each(['complete_with_history', 'current_only'] as const)(
    'materializa aliases e links seguros de forma determinística em %s',
    (profile) => {
      const fixture = packageFixture(profile);
      const file = fixture.package.files.find(({ canonicalKey }) =>
        canonicalKey.startsWith('lei ordinária:'),
      );
      if (file === undefined) throw new Error('Arquivo NLLC ausente.');

      expect(file.markdown).toContain('aliases: [');
      expect(file.markdown).toContain('[[#^nllc-art-1-par-3|§ 3º]] deste artigo');
      expect(file.markdown).toContain(
        '[[VincuLex/constituicao-federal/cf88#^cf1988-art-37|caput do art. 37]] da Constituição Federal',
      );
      expect(file.markdown).not.toContain('.md#^');
      expect(file.markdown).not.toContain('/home/');
      expect(fixture.package).toEqual(packageFixture(profile).package);

      const layout: VincuLexLayout = fixture.package.layout;
      const problems = validarMarkdownCanonico(file.markdown, fixture.nllc, profile, {
        referenceIndex: fixture.nllcIndex,
        layout,
        sha256,
      });
      expect(problems).toEqual([]);
      if (profile === 'current_only') {
        expect(file.markdown).not.toContain('nllc-art-1-par-6');
        expect(file.markdown).not.toContain('Aplicava-se também');
      } else {
        expect(file.markdown).toContain('nllc-art-1-par-6');
      }
    },
  );

  it('bloqueia span divergente e alvo resolvido que não integra o pacote', () => {
    const fixture = packageFixture('complete_with_history');
    const changed = clone(fixture.nllcIndex);
    const first = changed.references[0];
    if (first === undefined) throw new Error('Índice vazio.');
    first.span.text = `${first.span.text.slice(0, -1)}x`;

    const spanResult = formatar(fixture.nllc, 'complete_with_history', {
      referenceIndex: changed,
      layout: fixture.package.layout,
      sha256,
    });
    expect(spanResult.ok).toBe(false);
    if (!spanResult.ok)
      expect(spanResult.problemas[0]?.codigo).toBe('referencia_juridica_invalida');

    const withoutTarget = createVincuLexPackage(
      {
        catalog: fixture.catalog,
        documents: [{ ast: fixture.nllc, referenceIndex: fixture.nllcIndex }],
        profile: 'complete_with_history',
      },
      { sha256 },
    );
    expect(withoutTarget.ok).toBe(false);
    if (!withoutTarget.ok) {
      expect(withoutTarget.problemas[0]?.codigo).toBe('referencia_juridica_invalida');
    }
  });

  it('projeta arestas SQL por chaves e Block IDs canônicos, sem paths', () => {
    const fixture = packageFixture('complete_with_history');
    const projection = projectLegalReferenceSqlEdges(fixture.nllcIndex);
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;

    const resolved = projection.valor.find(
      ({ target_block_id }) => target_block_id === 'cf1988-art-37',
    );
    expect(resolved).toMatchObject({
      source_law_key: 'lei ordinária:14133:2021',
      source_block_id: 'nllc-art-1-par-5',
      state: 'resolved',
      target_law_key: 'constituição:1988:1988',
      target_block_id: 'cf1988-art-37',
    });
    expect(JSON.stringify(projection.valor)).not.toMatch(
      /VincuLex|wikiPath|relativePath|\/home\//u,
    );
  });
});
