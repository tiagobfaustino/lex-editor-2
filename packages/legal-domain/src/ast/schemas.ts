// Schemas de runtime da NormaAST, normativos conforme `DATA_MODEL.md`
// §NormaAST. Os tipos TypeScript de cada fase são inferidos daqui — o modelo
// exige explicitamente que não se mantenham dois contratos à mão.
//
// A árvore é construída uma vez por uma fábrica e instanciada duas vezes, uma
// por fase. Duplicar as ~14 famílias de nó por fase criaria justamente a
// divergência que a Feature 002 existe para impedir.

import { z } from 'zod';

import {
  astPhaseSchema,
  deviceStatusSchema,
  legalStatusSchema,
  parseConfidenceReasonSchema,
  parseConfidenceSchema,
  publicationStatusSchema,
  sourceRoleSchema,
  sourceTypeSchema,
  sourceVariantSchema,
  tipoNormaSchema,
} from './enums.js';
import type { CodigoProblema } from './errors.js';
import type {
  AnexoNode,
  ArtigoNode,
  AtoTransitorioNode,
  SlotComBlockId,
  IdentifiedNormaAST,
  ParseEvidence,
  ParsedNormaAST,
  RedacaoAnterior,
  SlotBlockIdOpcional,
  SlotSemBlockId,
  SourceReference,
  TabelaNode,
} from './nodes.js';

// --- Primitivos ------------------------------------------------------------

/**
 * Emite um problema com código estável. Usado no lugar das mensagens padrão do
 * zod sempre que o consumidor precisa distinguir o caso programaticamente.
 */
const comCodigo = (codigo: CodigoProblema, mensagem: string) => ({
  error: mensagem,
  params: { codigo },
});

/** Texto normativo que não pode ser vazio. Não normaliza: round-trip é identidade. */
const textoObrigatorio = (rotulo: string) =>
  z.string().check((ctx) => {
    if (ctx.value.trim().length === 0) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        params: { codigo: 'texto_obrigatorio' satisfies CodigoProblema },
        message: `${rotulo} não pode ser vazio.`,
      });
    }
  });

/** Identificador interno de runtime. Não é Block ID e não é persistido como tal. */
const idInternoSchema = textoObrigatorio('O id interno do nó');

/** Posição entre irmãos. A unicidade dentro do pai é regra do validador estrutural. */
const ordemSchema = z.int().nonnegative();

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Esperado SHA-256 em hexadecimal minúsculo.');

/**
 * Data civil `YYYY-MM-DD`. O regex sozinho aceitaria `2026-02-31`, por isso a
 * data é reconstruída e comparada: uma data impossível em metadado jurídico é
 * erro, não detalhe de formatação.
 */
const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Esperada data no formato YYYY-MM-DD.')
  .refine((valor) => {
    const [ano, mes, dia] = valor.split('-').map(Number) as [number, number, number];
    const data = new Date(Date.UTC(ano, mes - 1, dia));

    return (
      data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia
    );
  }, 'Data inexistente no calendário.');

/** SemVer sem prefixo, alinhado ao CHECK de `versoes_lei.versao_vinculex`. */
const semverSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, 'Esperado SemVer, ex.: 1.3.0.');

/**
 * Block ID canônico: `BLOCK_ID_SPEC.md` §2.3 exige minúsculas, apenas
 * `[a-z0-9-]` e hífen como separador único. O prefixo `^` pertence somente à
 * serialização Markdown e é rejeitado aqui por construção.
 *
 * Isto valida a forma de um ID recebido; gerar ou reconciliar Block IDs é
 * escopo da Feature 003.
 */
const blockIdSchema = z.string().check((ctx) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ctx.value)) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      params: { codigo: 'block_id_nao_canonico' satisfies CodigoProblema },
      message:
        'Block ID deve ser canônico: minúsculas, apenas [a-z0-9] separados por hífen e sem o prefixo "^".',
    });
  }
});

/** Na fase `parsed` nenhum nó carrega Block ID; o tipo inferido é `undefined`. */
const blockIdProibidoSchema = z.custom<undefined>(
  (valor) => valor === undefined,
  comCodigo('block_id_proibido', 'Block ID não existe na fase parsed.'),
);

// --- Origem e evidência ----------------------------------------------------

/**
 * Localiza o nó no snapshot imutável da fonte. Seletores e intervalos são
 * evidência de localização; a garantia de integridade é o SHA-256 (ADR-009 §5).
 */
export const sourceReferenceSchema = z.strictObject({
  sourceType: sourceTypeSchema,
  sourceRole: sourceRoleSchema,
  sourceVariant: sourceVariantSchema,
  sourceUrl: z.url().optional(),
  sourceArtifactSha256: sha256Schema,
  cssSelector: z.string().optional(),
  xpath: z.string().optional(),
  rawStartLine: z.int().nonnegative().optional(),
  rawEndLine: z.int().nonnegative().optional(),
  cleanedStartLine: z.int().nonnegative().optional(),
  cleanedEndLine: z.int().nonnegative().optional(),
  fragmentSha256: sha256Schema,
});

/**
 * Explica a confiança da interpretação estrutural. Confiança baixa sem pedido
 * de revisão humana é recusada: seria um sucesso falso, o caso que a estratégia
 * de testes manda sempre automatizar.
 */
export const parseEvidenceSchema = z
  .strictObject({
    confidence: parseConfidenceSchema,
    reasons: z.array(parseConfidenceReasonSchema),
    requiresHumanReview: z.boolean(),
    editorialNote: z.string().optional(),
  })
  .check((ctx) => {
    if (ctx.value.confidence === 'low' && !ctx.value.requiresHumanReview) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['requiresHumanReview'],
        params: { codigo: 'confianca_baixa_sem_revisao' satisfies CodigoProblema },
        message: 'Confiança "low" exige requiresHumanReview: true.',
      });
    }
  });

/**
 * Redação anterior materializada no corpo (ADR-006 §4). É bloco de
 * apresentação: não gera nó próprio nem Block ID, e a ordem do array é
 * cronológica, da mais antiga para a mais nova.
 */
export const redacaoAnteriorSchema = z.strictObject({
  texto: textoObrigatorio('O texto da redação anterior'),
  nota: textoObrigatorio('A nota da redação anterior').optional(),
});

export const referenciaRedacaoSchema = z.strictObject({
  blockId: blockIdSchema,
  lei: textoObrigatorio('A lei da referência de redação'),
  data: dataSchema,
  descricao: textoObrigatorio('A descrição da referência de redação'),
});

export const blockIdDepreciadoSchema = z.strictObject({
  antigo: blockIdSchema,
  novo: blockIdSchema,
});

// --- Fábrica das famílias de nó -------------------------------------------

/**
 * Campos comuns a todo nó da NormaAST (`NormaNodeBase`). `sourceRef` e
 * `parseEvidence` são obrigatórios em cada nó por RF-002-04: rastreabilidade
 * não é opcional em conteúdo jurídico.
 */
const camposBase = {
  id: idInternoSchema,
  ordem: ordemSchema,
  sourceRef: sourceReferenceSchema,
  supportingSourceRefs: z.array(sourceReferenceSchema).optional(),
  parseEvidence: parseEvidenceSchema,
} as const;

/**
 * Regra da ADR-005/RF-002-03: a decisão de preservar o texto revogado é
 * editorial e explícita. O Formatter não pode inferi-la do texto nem da fonte,
 * então ela é obrigatória em `revoked` e proibida fora dele — um valor
 * pendurado em um dispositivo ativo seria decisão sem efeito.
 */
type DecisaoDeRevogacao = Readonly<{ codigo: CodigoProblema; mensagem: string }>;

const decisaoDeRevogacaoPendente = (valor: {
  deviceStatus: string;
  preservarTextoRevogado?: boolean | undefined;
}): DecisaoDeRevogacao | undefined => {
  const revogado = valor.deviceStatus === 'revoked';
  const decidido = valor.preservarTextoRevogado !== undefined;

  if (revogado && !decidido) {
    return {
      codigo: 'revogacao_sem_decisao',
      mensagem: 'deviceStatus "revoked" exige a decisão explícita preservarTextoRevogado.',
    };
  }

  if (!revogado && decidido) {
    return {
      codigo: 'preservacao_sem_revogacao',
      mensagem: 'preservarTextoRevogado só existe quando deviceStatus é "revoked".',
    };
  }

  return undefined;
};

/**
 * Aplica a regra de revogação preservando o tipo do schema recebido, para que
 * a inferência de cada família de nó continue exata.
 */
const comRegraDeRevogacao = <
  S extends z.ZodType<{ deviceStatus: string; preservarTextoRevogado?: boolean | undefined }>,
>(
  schema: S,
): S =>
  schema.check((ctx) => {
    const pendencia = decisaoDeRevogacaoPendente(ctx.value);

    if (pendencia) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['preservarTextoRevogado'],
        params: { codigo: pendencia.codigo },
        message: pendencia.mensagem,
      });
    }
  });

/**
 * Constrói as famílias de nó para uma fase. Recebe os schemas de Block ID já
 * resolvidos para a fase, o que faz a regra RF-002-02 valer também em tempo de
 * compilação: em `parsed` o campo é inferido como `undefined`, em `identified`
 * como `string` nos nós referenciáveis.
 */
const construirFamilias = <Disp extends z.ZodType, Div extends z.ZodType, Fase extends z.ZodType>(
  blockIdDispositivo: Disp,
  blockIdDivisao: Div,
  fase: Fase,
) => {
  /** `DispositivoNodeBase`: um dispositivo individual, não a lei em si. */
  const camposDispositivo = {
    ...camposBase,
    blockId: blockIdDispositivo,
    deviceStatus: deviceStatusSchema,
    notaStatus: z.string().optional(),
    preservarTextoRevogado: z.boolean().optional(),
    redacoesAnteriores: z.array(redacaoAnteriorSchema).optional(),
    redacaoAtualDadaPor: z.string().optional(),
    renumeradoPara: blockIdSchema.optional(),
  } as const;

  /** `DivisaoNodeBase`: Block ID é opcional e ausente por padrão. */
  const camposDivisao = {
    ...camposBase,
    blockId: blockIdDivisao,
    deviceStatus: deviceStatusSchema,
    notaStatus: z.string().optional(),
    numero: z.string().optional(),
    titulo: textoObrigatorio('O título da divisão'),
  } as const;

  const penaSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('pena'),
      numero: z.string().optional(),
      texto: textoObrigatorio('O texto da pena'),
      children: z.tuple([]),
    }),
  );

  const tabelaSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('tabela'),
      numero: textoObrigatorio('O número da tabela'),
      caption: textoObrigatorio('A legenda da tabela'),
      headers: z.array(z.string()).min(1, 'A tabela precisa de ao menos uma coluna.'),
      rows: z.array(z.array(z.string())),
      children: z.tuple([]),
    }),
  ).check((ctx) => {
    // DATA_MODEL §Anexos e tabelas, regra 3: headers.length define a
    // contagem de colunas e toda linha deve respeitá-la. Tabela irregular
    // falha antes do Preview em vez de virar renderização silenciosamente
    // torta.
    const colunas = ctx.value.headers.length;

    ctx.value.rows.forEach((linha, indice) => {
      if (linha.length !== colunas) {
        ctx.issues.push({
          code: 'custom',
          input: linha,
          path: ['rows', indice],
          params: { codigo: 'tabela_irregular' satisfies CodigoProblema },
          message: `A linha ${String(indice)} tem ${String(linha.length)} célula(s); headers define ${String(colunas)}.`,
        });
      }
    });
  });

  const itemSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('item'),
      numero: textoObrigatorio('O número do item'),
      texto: textoObrigatorio('O texto do item'),
      get children() {
        return z.array(penaSchema);
      },
    }),
  );

  const alineaSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('alinea'),
      letra: textoObrigatorio('A letra da alínea'),
      texto: textoObrigatorio('O texto da alínea'),
      get children() {
        return z.array(z.discriminatedUnion('tipo', [itemSchema, penaSchema]));
      },
    }),
  );

  const incisoSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('inciso'),
      numero: textoObrigatorio('O número do inciso'),
      texto: textoObrigatorio('O texto do inciso'),
      get children() {
        return z.array(z.discriminatedUnion('tipo', [alineaSchema, penaSchema]));
      },
    }),
  );

  const paragrafoSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('paragrafo'),
      numero: textoObrigatorio('O número do parágrafo'),
      texto: textoObrigatorio('O texto do parágrafo'),
      get children() {
        return z.array(z.discriminatedUnion('tipo', [incisoSchema, alineaSchema, penaSchema]));
      },
    }),
  );

  const artigoSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('artigo'),
      numero: textoObrigatorio('O número do artigo'),
      caput: textoObrigatorio('O caput do artigo'),
      get children() {
        return z.array(
          z.discriminatedUnion('tipo', [paragrafoSchema, incisoSchema, alineaSchema, penaSchema]),
        );
      },
    }),
  );

  const anexoSchema = comRegraDeRevogacao(
    z.strictObject({
      ...camposDispositivo,
      tipo: z.literal('anexo'),
      numero: textoObrigatorio('O número do anexo'),
      titulo: textoObrigatorio('O título do anexo'),
      get children() {
        return z.array(z.discriminatedUnion('tipo', [artigoSchema, tabelaSchema]));
      },
    }),
  );

  const subsecaoSchema = z.strictObject({
    ...camposDivisao,
    tipo: z.literal('subsecao'),
    get children() {
      return z.array(artigoSchema);
    },
  });

  const secaoSchema = z.strictObject({
    ...camposDivisao,
    tipo: z.literal('secao'),
    get children() {
      return z.array(z.discriminatedUnion('tipo', [subsecaoSchema, artigoSchema]));
    },
  });

  const capituloSchema = z.strictObject({
    ...camposDivisao,
    tipo: z.literal('capitulo'),
    get children() {
      return z.array(z.discriminatedUnion('tipo', [secaoSchema, artigoSchema]));
    },
  });

  const tituloSchema = z.strictObject({
    ...camposDivisao,
    tipo: z.literal('titulo'),
    get children() {
      return z.array(
        z.discriminatedUnion('tipo', [capituloSchema, artigoSchema, anexoSchema, tabelaSchema]),
      );
    },
  });

  const livroSchema = z.strictObject({
    ...camposDivisao,
    tipo: z.literal('livro'),
    get children() {
      return z.array(z.discriminatedUnion('tipo', [tituloSchema, capituloSchema, artigoSchema]));
    },
  });

  const atoTransitorioSchema = z.strictObject({
    ...camposDivisao,
    tipo: z.literal('ato_transitorio'),
    get children() {
      return z.array(
        z.discriminatedUnion('tipo', [livroSchema, tituloSchema, capituloSchema, artigoSchema]),
      );
    },
  });

  /**
   * `LeiNode` estende `NormaNodeBase`, não `DispositivoNodeBase`: a raiz não
   * tem Block ID nem `deviceStatus`. O `strictObject` faz disso uma recusa
   * concreta, e não apenas uma ausência na documentação.
   */
  const leiSchema = z.strictObject({
    ...camposBase,
    tipo: z.literal('lei'),
    astPhase: fase,
    titulo: textoObrigatorio('O título da lei'),
    sigla: textoObrigatorio('A sigla da lei'),
    tipoNorma: tipoNormaSchema,
    numero: textoObrigatorio('O número da lei'),
    ano: z.int(),
    ramo: textoObrigatorio('O ramo da lei'),
    fonte: z.url(),
    dataPublicacao: dataSchema,
    dataAtualizacaoLegal: dataSchema,
    dataFormatacaoVinculex: dataSchema,
    totalArtigos: z.int().nonnegative(),
    versaoVinculex: semverSchema,
    legalStatus: legalStatusSchema,
    publicationStatus: publicationStatusSchema,
    tags: z.array(z.string()).optional(),
    revogadaPor: z.string().nullable().optional(),
    redacoesDadasPor: z.array(referenciaRedacaoSchema).optional(),
    idsDepreciados: z.array(blockIdDepreciadoSchema).optional(),
    fontesSecundarias: z.array(z.url()).optional(),
    dataVerificacaoIntegridade: dataSchema,
    avisosAtualizacao: z.array(z.string()).optional(),
    notasEditoriais: z.array(z.string()).optional(),
    get children() {
      return z.array(
        z.discriminatedUnion('tipo', [
          atoTransitorioSchema,
          livroSchema,
          tituloSchema,
          capituloSchema,
          artigoSchema,
          anexoSchema,
          tabelaSchema,
        ]),
      );
    },
  });

  return {
    leiSchema,
    atoTransitorioSchema,
    livroSchema,
    tituloSchema,
    capituloSchema,
    secaoSchema,
    subsecaoSchema,
    artigoSchema,
    paragrafoSchema,
    incisoSchema,
    alineaSchema,
    itemSchema,
    penaSchema,
    anexoSchema,
    tabelaSchema,
  };
};

// --- As duas fases ---------------------------------------------------------

// As fábricas ficam internas de propósito. O tipo inferido da árvore recursiva
// completa é grande demais para o TypeScript serializar no `.d.ts` do pacote
// (TS7056); exportar apenas as vistas anotadas mantém o contrato público
// legível e o arquivo de declaração pequeno, sem abrir mão de checagem alguma
// — a prova de equivalência logo abaixo é feita sobre estes valores internos.

/** Saída do Parser: nenhum dispositivo possui Block ID. */
const parsed = construirFamilias(
  blockIdProibidoSchema.optional(),
  blockIdProibidoSchema.optional(),
  z.literal('parsed'),
);

/** Saída do reconciliador: todo nó referenciável possui Block ID. */
const identified = construirFamilias(
  blockIdSchema,
  blockIdSchema.optional(),
  z.literal('identified'),
);

/**
 * Prova de que o schema construído produz exatamente a interface pública, nos
 * dois sentidos. Alias de tipo não exportado não aparece no `.d.ts`, mas é
 * verificado pelo compilador: acrescentar um campo em `nodes.ts` sem
 * acrescentá-lo aqui — ou o contrário — quebra o typecheck.
 *
 * É isto que sustenta o quinto critério de aceite da Feature 002.
 */
type Equivalente<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Cada entrada precisa ser `true`. Se o schema e a interface divergirem, a
 * propriedade correspondente vira `false` e o `satisfies` falha, apontando
 * exatamente qual contrato saiu de sincronia.
 */
const _PROVA_DE_EQUIVALENCIA = {
  faseParsed: true as Equivalente<z.infer<typeof parsed.leiSchema>, ParsedNormaAST>,
  faseIdentified: true as Equivalente<z.infer<typeof identified.leiSchema>, IdentifiedNormaAST>,
  origem: true as Equivalente<z.infer<typeof sourceReferenceSchema>, SourceReference>,
  evidencia: true as Equivalente<z.infer<typeof parseEvidenceSchema>, ParseEvidence>,
  redacaoAnterior: true as Equivalente<z.infer<typeof redacaoAnteriorSchema>, RedacaoAnterior>,
} satisfies Record<string, true>;

void _PROVA_DE_EQUIVALENCIA;

export const parsedNormaAstSchema: z.ZodType<ParsedNormaAST> = parsed.leiSchema;
export const identifiedNormaAstSchema: z.ZodType<IdentifiedNormaAST> = identified.leiSchema;

/** Famílias avulsas, para quem valida um ramo isolado da árvore. */
export const parsedArtigoSchema: z.ZodType<ArtigoNode<SlotSemBlockId>> = parsed.artigoSchema;
export const identifiedArtigoSchema: z.ZodType<ArtigoNode<SlotComBlockId>> =
  identified.artigoSchema;
export const parsedTabelaSchema: z.ZodType<TabelaNode<SlotSemBlockId>> = parsed.tabelaSchema;
export const identifiedTabelaSchema: z.ZodType<TabelaNode<SlotComBlockId>> =
  identified.tabelaSchema;
export const parsedAnexoSchema: z.ZodType<AnexoNode<SlotSemBlockId>> = parsed.anexoSchema;
export const identifiedAnexoSchema: z.ZodType<AnexoNode<SlotComBlockId>> = identified.anexoSchema;
export const parsedAtoTransitorioSchema: z.ZodType<
  AtoTransitorioNode<SlotSemBlockId, SlotSemBlockId>
> = parsed.atoTransitorioSchema;
export const identifiedAtoTransitorioSchema: z.ZodType<
  AtoTransitorioNode<SlotComBlockId, SlotBlockIdOpcional>
> = identified.atoTransitorioSchema;

/**
 * Aceita qualquer uma das duas fases. Útil a quem apenas percorre a árvore;
 * quem produz efeito jurídico deve exigir a fase específica.
 */
export const normaAstSchema: z.ZodType<ParsedNormaAST | IdentifiedNormaAST> = z.union([
  parsed.leiSchema,
  identified.leiSchema,
]);

export { astPhaseSchema };
