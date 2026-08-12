import {
  identifiedCompleta,
  identifiedMinima,
  percorrer,
  projectContent,
  type DeviceStatus,
  type IdentifiedNormaAST,
  type ProblemaValidacao,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

const clone = <T>(value: T): T => structuredClone(value);

const nodes = (ast: IdentifiedNormaAST): Record<string, unknown>[] => {
  const result: Record<string, unknown>[] = [];
  percorrer(
    ast,
    ({ no }) => result.push(no),
    () => undefined,
  );
  return result;
};

const projectOrThrow = (
  ast: unknown,
  profile: 'complete_with_history' | 'current_only',
): IdentifiedNormaAST => {
  const result = projectContent(ast, profile);
  if (!result.ok) {
    throw new Error(`Projeção falhou: ${JSON.stringify(result.problemas)}`);
  }
  return result.valor.ast;
};

const firstProblem = (result: ReturnType<typeof projectContent>): ProblemaValidacao => {
  if (result.ok) throw new Error('Esperava falha de projeção.');
  const problem = result.problemas[0];
  if (problem === undefined) throw new Error('A projeção falhou sem diagnóstico.');
  return problem;
};

describe('projeção complete_with_history', () => {
  it('é o padrão, preserva história, estados e a única identidade canônica', () => {
    const original = clone(identifiedCompleta);
    const result = projectContent(original);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.valor.profile).toBe('complete_with_history');
    expect(result.valor.ast).toEqual(original);
    expect(result.valor.ast).not.toBe(original);

    const amended = nodes(result.valor.ast).find((node) => node['deviceStatus'] === 'amended');
    const histories = amended?.['redacoesAnteriores'];
    expect(amended?.['blockId']).toBe('ldem-art-1');
    expect(histories).toEqual([
      {
        texto: 'Art. 1º Redação originária.',
        nota: '(Redação dada pela Lei nº 8.888, de 2026)',
      },
    ]);
    expect(JSON.stringify(histories)).not.toContain('blockId');

    const revoked = nodes(result.valor.ast).find((node) => node['deviceStatus'] === 'revoked');
    expect(revoked?.['blockId']).toBe('ldem-anx-i-art-1');
    expect(original).toEqual(identifiedCompleta);
  });

  it('permite estado desconhecido porque a saída completa não descarta evidência', () => {
    const ast = clone(identifiedMinima);
    const article = ast.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.deviceStatus = 'unknown';

    const result = projectContent(ast, 'complete_with_history');
    expect(result.ok).toBe(true);
    expect(result.ok ? result.valor.ast.children[0]?.deviceStatus : undefined).toBe('unknown');
  });
});

describe('projeção current_only', () => {
  it('remove histórico e dispositivos sem eficácia, poda divisões vazias e recalcula derivados', () => {
    const original = clone(identifiedCompleta);
    const before = clone(original);
    const projected = projectOrThrow(original, 'current_only');
    const projectedNodes = nodes(projected);
    const projectedBlockIds = new Set(
      projectedNodes
        .map((node) => node['blockId'])
        .filter((blockId): blockId is string => typeof blockId === 'string'),
    );
    const originalBlockIds = new Set(
      nodes(original)
        .map((node) => node['blockId'])
        .filter((blockId): blockId is string => typeof blockId === 'string'),
    );

    expect(projected.totalArtigos).toBe(1);
    expect(JSON.stringify(projected)).not.toContain('redacoesAnteriores');
    expect(projectedNodes.some((node) => node['deviceStatus'] === 'revoked')).toBe(false);
    expect(projectedNodes.some((node) => node['tipo'] === 'ato_transitorio')).toBe(false);
    expect(projectedBlockIds.has('ldem-anx-i-art-1')).toBe(false);
    expect(projectedBlockIds.has('ldem-art-1')).toBe(true);
    expect(projectedBlockIds.has('ldem-anx-i-tab-1')).toBe(true);
    expect([...projectedBlockIds].every((blockId) => originalBlockIds.has(blockId))).toBe(true);
    expect(original).toEqual(before);
  });

  it.each<DeviceStatus>(['active', 'included', 'amended', 'renumbered'])(
    'mantém dispositivo %s e seu Block ID',
    (status) => {
      const ast = clone(identifiedMinima);
      const article = ast.children[0];
      if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
      article.deviceStatus = status;
      article.redacoesAnteriores = [{ texto: 'Redação superada.' }];

      const projected = projectOrThrow(ast, 'current_only');
      expect(projected.children[0]).toMatchObject({
        deviceStatus: status,
        blockId: 'ldem-art-1',
      });
      expect(projected.children[0]).not.toHaveProperty('redacoesAnteriores');
    },
  );

  it.each<DeviceStatus>(['revoked', 'vetoed', 'suspended'])(
    'omite dispositivo %s e mantém a identidade reservada somente na AST original',
    (status) => {
      const ast = clone(identifiedMinima);
      const article = ast.children[0];
      if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
      article.deviceStatus = status;
      if (status === 'revoked') article.preservarTextoRevogado = true;

      const projected = projectOrThrow(ast, 'current_only');
      expect(projected.children).toEqual([]);
      expect(projected.totalArtigos).toBe(0);
      expect(article.blockId).toBe('ldem-art-1');
    },
  );

  it('bloqueia unknown antes mesmo de podar a subárvore e localiza a âncora', () => {
    const ast = clone(identifiedCompleta);
    const annex = ast.children.find((node) => node.tipo === 'anexo');
    if (annex?.tipo !== 'anexo') throw new Error('Fixture sem anexo.');
    annex.deviceStatus = 'revoked';
    annex.preservarTextoRevogado = true;
    const article = annex.children.find((node) => node.tipo === 'artigo');
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo no anexo.');
    article.deviceStatus = 'unknown';
    delete article.preservarTextoRevogado;
    delete article.notaStatus;

    const before = clone(ast);
    const result = projectContent(ast, 'current_only');
    const problem = firstProblem(result);

    expect(problem).toMatchObject({
      codigo: 'estado_desconhecido_bloqueia_vigente',
      noId: 'no-anexo-1-art-1',
      blockId: 'ldem-anx-i-art-1',
    });
    expect(problem.caminho.at(-1)).toBe('deviceStatus');
    expect(ast).toEqual(before);
  });

  it('é determinística e recusa perfil ou entrada fora do contrato runtime', () => {
    expect(projectContent(identifiedCompleta, 'current_only')).toEqual(
      projectContent(identifiedCompleta, 'current_only'),
    );
    expect(firstProblem(projectContent(identifiedMinima, 'resumo')).caminho).toEqual(['profile']);
    expect(firstProblem(projectContent({ tipo: 'lei' }, 'current_only')).codigo).toBe(
      'schema_invalido',
    );
  });
});
