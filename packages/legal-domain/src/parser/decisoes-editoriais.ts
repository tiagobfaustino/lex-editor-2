// Aplicação auditável de revisões humanas (ADR-011).

import { criarProblema, falha, type ResultadoValidacao, sucesso } from '../ast/errors.js';
import type { ParsedNormaAST } from '../ast/nodes.js';
import { percorrer, validarParsedNormaAst } from '../ast/validate.js';

type No = Record<string, unknown>;

export interface DecisaoEditorial {
  readonly versao: 1;
  readonly acao: 'confirmar_ancoragem';
  readonly sourceArtifactSha256: string;
  readonly fragmentSha256: string;
  readonly rawStartLine: number;
  readonly justificativa: string;
}

const copiar = (valor: unknown): unknown => {
  if (Array.isArray(valor)) return valor.map(copiar);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, copiar(item)]));
  }
  return valor;
};

const corresponde = (no: No, decisao: DecisaoEditorial): boolean => {
  const ref = no['sourceRef'];
  return (
    typeof ref === 'object' &&
    ref !== null &&
    (ref as No)['sourceArtifactSha256'] === decisao.sourceArtifactSha256 &&
    (ref as No)['fragmentSha256'] === decisao.fragmentSha256 &&
    (ref as No)['rawStartLine'] === decisao.rawStartLine
  );
};

export const aplicarDecisoesEditoriais = (
  arvore: ParsedNormaAST,
  decisoes: readonly unknown[],
): ResultadoValidacao<ParsedNormaAST> => {
  const copia = copiar(arvore) as ParsedNormaAST;
  const nos: No[] = [];
  percorrer(
    copia,
    ({ no }) => nos.push(no),
    () => undefined,
  );

  for (const [indice, bruta] of decisoes.entries()) {
    const decisao = bruta as Partial<DecisaoEditorial>;
    if (
      typeof bruta !== 'object' ||
      bruta === null ||
      decisao.versao !== 1 ||
      decisao.acao !== 'confirmar_ancoragem' ||
      typeof decisao.sourceArtifactSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(decisao.sourceArtifactSha256) ||
      typeof decisao.fragmentSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(decisao.fragmentSha256) ||
      typeof decisao.rawStartLine !== 'number' ||
      !Number.isInteger(decisao.rawStartLine) ||
      decisao.rawStartLine < 1 ||
      typeof decisao.justificativa !== 'string' ||
      decisao.justificativa.trim().length === 0
    ) {
      return falha([
        criarProblema(
          'decisao_editorial_invalida',
          ['decisoes', indice],
          'A decisão editorial não satisfaz o contrato versionado da ADR-011.',
        ),
      ]);
    }

    const decisaoValida = decisao as DecisaoEditorial;
    const alvos = nos.filter((no) => corresponde(no, decisaoValida));
    if (alvos.length !== 1) {
      return falha([
        criarProblema(
          'decisao_editorial_invalida',
          ['decisoes', indice],
          `A decisão precisa corresponder a exatamente um fragmento; encontrou ${String(alvos.length)}.`,
        ),
      ]);
    }

    const alvo = alvos.at(0);
    if (alvo === undefined) {
      return falha([
        criarProblema('decisao_editorial_invalida', ['decisoes', indice], 'Alvo ausente.'),
      ]);
    }
    const evidencia = alvo['parseEvidence'] as No;
    if (evidencia['confidence'] !== 'low' || evidencia['requiresHumanReview'] !== true) {
      return falha([
        criarProblema(
          'decisao_editorial_invalida',
          ['decisoes', indice],
          'A decisão só pode confirmar uma interpretação ainda marcada como baixa confiança.',
        ),
      ]);
    }

    const motivos = Array.isArray(evidencia['reasons']) ? (evidencia['reasons'] as string[]) : [];
    alvo['parseEvidence'] = {
      confidence: 'medium',
      reasons: [...new Set([...motivos, 'editorial_override'])],
      requiresHumanReview: false,
      editorialNote: decisaoValida.justificativa.trim(),
    };
  }

  const validada = validarParsedNormaAst(copia);
  return validada.ok ? sucesso(validada.valor) : validada;
};
