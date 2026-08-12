import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  formatar,
  identifiedMinima,
  validarMarkdownCanonico,
  type IdentifiedNormaAST,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

const FIXTURES = join(process.cwd(), 'fixtures/legal/projections');
const completeGolden = readFileSync(join(FIXTURES, 'complete_with_history.md'), 'utf8');
const currentGolden = readFileSync(join(FIXTURES, 'current_only.md'), 'utf8');
const clone = <T>(value: T): T => structuredClone(value);

const projectionFixture = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  const current = ast.children[0];
  if (current?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');

  current.deviceStatus = 'amended';
  current.redacoesAnteriores = [
    {
      texto: 'Art. 1. Redação originária da demonstração.',
      nota: '(Redação dada pela Lei nº 9.999, de 2027)',
    },
  ];
  const revoked: typeof current = {
    ...clone(current),
    id: 'no-art-2',
    ordem: 1,
    blockId: 'ldem-art-2',
    deviceStatus: 'revoked',
    preservarTextoRevogado: true,
    notaStatus: '(Revogado pela Lei nº 9.999, de 2027)',
    numero: '2',
    caput: 'Dispositivo integralmente revogado.',
    children: [],
  };
  delete revoked.redacoesAnteriores;
  ast.children.push(revoked);
  ast.totalArtigos = 2;
  return ast;
};

const formatOrThrow = (
  ast: IdentifiedNormaAST,
  profile?: 'complete_with_history' | 'current_only',
): string => {
  const result = profile === undefined ? formatar(ast) : formatar(ast, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.problemas));
  return result.valor;
};

describe('Formatter com perfis da ADR-012', () => {
  it('mantém o perfil completo como padrão retrocompatível e igual ao golden', () => {
    const ast = projectionFixture();
    const before = clone(ast);

    expect(formatOrThrow(ast)).toBe(completeGolden);
    expect(formatOrThrow(ast, 'complete_with_history')).toBe(completeGolden);
    expect(completeGolden).not.toContain('projection_profile:');
    expect(completeGolden).toContain(
      '- ~~Art. 1. Redação originária da demonstração.~~ *(Redação dada pela Lei nº 9.999, de 2027)*',
    );
    expect(completeGolden).toContain('^ldem-art-2');
    expect(validarMarkdownCanonico(completeGolden, ast)).toEqual([]);
    expect(ast).toEqual(before);
  });

  it('gera o golden vigente identificado sem histórico ou dispositivo revogado', () => {
    const ast = projectionFixture();
    const before = clone(ast);
    const markdown = formatOrThrow(ast, 'current_only');

    expect(markdown).toBe(currentGolden);
    expect(markdown).toContain('projection_profile: "current_only"');
    expect(markdown).toContain('^ldem-art-1');
    expect(markdown).not.toContain('Redação originária');
    expect(markdown).not.toContain('^ldem-art-2');
    expect(markdown).not.toContain('~~');
    expect(validarMarkdownCanonico(markdown, ast, 'current_only')).toEqual([]);
    expect(ast).toEqual(before);
  });

  it('produz bytes determinísticos nos dois perfis', () => {
    const ast = projectionFixture();

    expect(formatar(ast, 'complete_with_history')).toEqual(formatar(ast, 'complete_with_history'));
    expect(formatar(ast, 'current_only')).toEqual(formatar(ast, 'current_only'));
  });

  it('bloqueia estado desconhecido e perfil runtime inválido', () => {
    const ast = clone(identifiedMinima);
    const article = ast.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.deviceStatus = 'unknown';

    const unknown = formatar(ast, 'current_only');
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? [] : unknown.problemas).toContainEqual(
      expect.objectContaining({
        codigo: 'estado_desconhecido_bloqueia_vigente',
        blockId: 'ldem-art-1',
      }),
    );

    const invalid = formatar(identifiedMinima, 'compacto');
    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? [] : invalid.problemas[0]?.caminho).toEqual(['profile']);
  });

  it('rejeita rótulo ausente ou incompatível com o perfil validado', () => {
    const ast = projectionFixture();
    const unlabeledCurrent = currentGolden.replace('projection_profile: "current_only"\n', '');
    const mislabeledComplete = completeGolden.replace(
      'legal_status: "vigente"\n',
      'legal_status: "vigente"\nprojection_profile: "current_only"\n',
    );

    expect(
      validarMarkdownCanonico(unlabeledCurrent, ast, 'current_only').map(
        (problem) => problem.codigo,
      ),
    ).toContain('schema_invalido');
    expect(
      validarMarkdownCanonico(mislabeledComplete, ast, 'complete_with_history').map(
        (problem) => problem.codigo,
      ),
    ).toContain('schema_invalido');
  });
});
