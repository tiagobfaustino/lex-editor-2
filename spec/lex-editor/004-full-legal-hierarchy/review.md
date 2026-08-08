# Revisão de Encerramento — Feature 004

A feature **não fechou**. T004-01 a T004-06 e T004-09 estão entregues; T004-07
está parcial e T004-08 e T004-10 seguem abertas. Este documento registra o que
ficou, por que ficou, e o que não se deduz do código.

## Estado por tarefa

| Tarefa | Estado |
|---|---|
| T004-01 matriz de cobertura | entregue |
| T004-02 gramática de divisões e dispositivos | entregue |
| T004-03 estados, redações, tabelas, anexos | **parcial** — falta mesclagem compilada/anotada e referências cruzadas |
| T004-04 reconciliação de identidade | entregue |
| T004-05 namespace, aliases, colisão tardia | entregue |
| T004-06 catorze verificações canônicas | entregue |
| T004-07 fixtures integrais | **parcial** — LINDB passa; CP e CF/88 não |
| T004-08 auditoria e correção de regras gerais | **aberta** |
| T004-09 projeção Postgres | entregue |
| T004-10 validação no Obsidian | **aberta** — depende de revisor humano |

## A decisão que exigiu ADR

A LINDB contradisse o `DATA_MODEL` no art. 15: cinco alíneas pendem do caput,
sem inciso. Resolvido pela
[ADR-010](../../../docs/architecture/ADR-010-alinea-sob-artigo-e-paragrafo.md),
com `DATA_MODEL.md` §NormaAST e `BLOCK_ID_SPEC.md` §2.1 emendados **antes** do
código. Nenhum ID publicado mudou: a gramática passou a aceitar uma cadeia que
antes não era produzível, sem reinterpretar nenhuma existente.

## O que rodar lei real ensinou

Cinco defeitos do extrator, nenhum dos quais apareceria em fixture sintética:

| Sintoma | Causa |
|---|---|
| Texto corrompido | encoding adivinhado pelo cabeçalho; agora utf-8 estrito com queda para windows-1252 |
| `1.991, de 1953` lido como item | separador de item não exigia espaço depois |
| Arts. 20+ da LINDB sem `Art.` | quebra crua do arquivo tratada como quebra de parágrafo; em HTML é espaço |
| Art. 6º da CF/88 quatro vezes | `<strike>` removido junto com as tags, apagando a distinção da ADR-006 |
| Revogado engolindo o texto do seguinte | o riscado não era fronteira ao juntar continuações |

A ordem do `plan.md` — casos mínimos antes das leis — continua certa. Falta
nela o recíproco: **leis inteiras antes de declarar a gramática pronta**.

## A rubrica: duas tentativas, duas reversões

O CP intercala o nomen juris como linha própria (`Homicídio simples`), marcado
com `<b>`. Hoje ela **gruda na ementa da divisão anterior**, produzindo
`CAPÍTULO I DOS CRIMES CONTRA A VIDA Homicídio simples`. É corrupção real, em
centenas de lugares.

Tentei duas regras para descartá-la, ambas baseadas no negrito:

1. "linha em negrito, não designador, **seguida** de designador" — derrubou um
   artigo e deixou os parágrafos dele órfãos;
2. "linha tocada por negrito que não é designador", com a checagem feita no
   texto já sem marcador — derrubou **cinco** artigos (434 → 429).

Revertidas as duas. A razão de reverter em vez de ajustar: perder conteúdo
normativo em silêncio é pior do que falhar no parsing. A falha bloqueia e
aparece; a perda não.

3. varredor que rastreia a profundidade de `<b>` e decide por pedaço de bloco,
   com a ênfase virando atributo em vez de marca no texto — **preservou os 434
   artigos** e acabou com a rubrica grudada, mas engoliu o art. 26 e produziu
   50 órfãos.

A terceira revelou a causa real, que invalida a premissa das três: **a ementa
da divisão também vem em negrito**.

```
TÍTULO III
DA IMPUTABILIDADE PENAL        <- negrito, e é a EMENTA do título
Art. 26 - É isento de pena ...
```

Descartar o negrito deixou `TÍTULO III` sem ementa, e o parser consumiu o art.
26 como título dela. O negrito não distingue rubrica de conteúdo: a mesma
marcação serve para nomen juris descartável e para ementa obrigatória. A
diferença é contextual.

| Contexto anterior | Pedaço em negrito é |
|---|---|
| divisão sem ementa na mesma linha | ementa da divisão, obrigatória |
| dispositivo completo | rubrica, descartável |

**A decisão precisa migrar para o parser**, que já mantém `aguardandoTitulo` e
portanto sabe se uma divisão espera ementa. O extrator deve apenas marcar o
pedaço como enfatizado — o que exige `extrairLinhas` devolver pedaços com
atributos, não strings. É o desenho para a quarta tentativa.

Enquanto isso não existir, o comportamento atual é o seguro: CP para em 2
linhas de 1641 e CF/88 em 15 de 4139, com erro visível.

## A lacuna que a projeção Postgres revelou

`LeiNode` estende `NormaNodeBase`, então a raiz carrega `id`, `ordem`,
`sourceRef`, `supportingSourceRefs` e `parseEvidence`. **Nenhuma tabela tem
coluna para eles** — `dispositivos` não aceita `tipo = 'lei'`. Sem tratamento,
a ida e volta perderia a rastreabilidade da própria norma.

O adaptador os carrega em `LinhaDaRaiz`, explicitamente, para que a perda não
seja silenciosa. Onde moram no banco é decisão da Feature 007.

## Dívidas

- **Rubrica (nomen juris)** corrompendo ementa de divisão — a mais séria.
- **Mesclagem compilada/anotada** (ADR-009 §2 e §3) e **referências cruzadas**
  ponta a ponta, ambas do T004-03.
- **Ementa de divisão separada do designador** na CF/88, quando o riscado
  quebra o par.
- **`scripts/capturar-fixture.mjs` reporta "linhas sem designador: 0" sempre.**
  A métrica é vácua: `juntarContinuacoes` absorve toda linha não reconhecida na
  anterior, então o número nunca é outro. O sinal honesto é rodar o pipeline.

## Evidência

`lint`, `format:check`, `typecheck`, `test:unit` (176 testes, 10 arquivos),
`test:boundaries`, `check:data-model` — todos passam em 2026-08-05.

Pipeline sobre as três leis: LINDB **ok** (30 artigos, 88 dispositivos, 88
Block IDs); CP falha em 2 linhas; CF/88 falha em 15.

## Para a validação no Obsidian (T004-10)

Dois goldens estão prontos para abrir:

- `fixtures/legal/lindb/esperado.md` — LINDB integral, 30 artigos. É o caso
  principal: exercita alínea sob caput (ADR-010), parágrafo único e a norma
  inteira.
- `fixtures/legal/cp-art-121/esperado.md` — recorte do art. 121 do CP.
  Exercita pena, inciso revogado com texto residual e alínea sob inciso.

O que conferir: se as âncoras `^bloco` são reconhecidas como block reference,
se a lista indentada recolhe e expande, se os callouts renderizam, e se o
frontmatter é lido sem erro de YAML.
