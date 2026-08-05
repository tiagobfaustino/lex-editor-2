# Matriz de cobertura — Feature 004

Liga cada regra normativa a uma fixture mínima e ao teste que a exercita. O
`plan.md` manda "uma fixture mínima por ramificação precede a lei completa", e
o risco registrado na spec é o inverso disso: fixtures enormes que escondem
qual regra quebrou.

Uma linha só vira `coberta` quando existe fixture mínima **e** teste. Golden de
lei inteira não conta: a spec proíbe usar snapshot como única evidência.

## Legenda

| Marca | Significado |
|---|---|
| `003` | já entregue e testado pela Feature 003 |
| `[ ]` | previsto nesta feature, ainda sem fixture ou sem teste |
| `n/a` | fora do escopo desta feature, com destino registrado |

---

## 1. Gramática de divisões (T004-02)

`MARKDOWN_SPEC.md` §3.1 e §7; `BLOCK_ID_SPEC.md` §2.4.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Livro vira `#` | MD §3.1 | `divisoes/livro.txt` | `[ ]` |
| Título vira `##` | MD §3.1 | `divisoes/titulo.txt` | `[ ]` |
| Capítulo vira `###` | MD §3.1 | `divisoes/capitulo.txt` | `[ ]` |
| Seção vira `####` | MD §3.1 | `divisoes/secao.txt` | `[ ]` |
| Subseção vira `#####` | MD §3.1 | `divisoes/subsecao.txt` | `[ ]` |
| Divisão não recebe Block ID por padrão | MD §7.3 | `divisoes/sem-block-id.txt` | `[ ]` |
| Heading não pula nível | MD §9.10 | `divisoes/salto-de-nivel.txt` | `[ ]` |
| Divisão entra no ID só para desambiguar | BID §2.4 | `identidade/colisao-por-divisao.txt` | `[ ]` |
| Número da divisão é ordinal cardinal, não romano | BID §8.2 | idem | `[ ]` |

## 2. Gramática de dispositivos (T004-02)

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Artigo, caput e `art-{n}` | BID §2.3 | `fixtures/legal/cp-art-121/` | `003` |
| Artigo com sufixo alfabético (`121-A`) | BID §2.3.6 | `dispositivos/artigo-sufixo.txt` | `[ ]` |
| Parágrafo numerado `par-{n}` | BID §2.3.5 | cp-art-121 | `003` |
| Parágrafo único `par-unico` | BID §2.3.5 | `dispositivos/paragrafo-unico.txt` | `[ ]` |
| Parágrafo único e numerado são exclusivos | BID §2.3.5 | `dispositivos/paragrafo-conflito.txt` | `[ ]` |
| Inciso em romano minúsculo | BID §2.3.7 | cp-art-121 | `003` |
| Inciso com sufixo (`inc-i-a`) | BID §2.1 | `dispositivos/inciso-sufixo.txt` | `[ ]` |
| Alínea letra única | BID §2.3.8 | cp-art-121 | `003` |
| Alínea letra dupla (`ali-aa`) | BID §7.2 | `dispositivos/alinea-dupla.txt` | `[ ]` |
| Item em cardinal arábico | BID §2.3.9 | `dispositivos/item.txt` | `[ ]` |
| Pena autônoma sem número | BID §2.3.12 | cp-art-121 | `003` |
| Pena numerada (`pena-2`) | BID §2.3.12 | `dispositivos/pena-numerada.txt` | `[ ]` |
| Pena ancorada em ancestral, não no anterior | BID §2.3.12 | `dispositivos/pena-de-paragrafo.txt` | `[ ]` |
| Pena na mesma frase não vira nó | BID §2.3.12 | `dispositivos/pena-embutida.txt` | `[ ]` |

> A pena ancorada em ancestral é a dívida explícita da Feature 003: no art. 121
> há linhas `Pena` que pertencem ao § 2º e ao inciso V, e o parser atual as
> ancoraria no dispositivo anterior. Duas linhas do texto oficial ficaram fora
> da fixture da 003 por isso. Resolver aqui reabilita esse trecho.

## 3. Estados do dispositivo (T004-03)

`ADR-005`; `MARKDOWN_SPEC.md` §5.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| `revoked` com texto residual, sem riscado | MD §5.1.1, §5.3 | cp-art-121 (inciso VI) | `003` |
| `revoked` com texto preservado e riscado | MD §5.1.2, §5.3 | `estados/revogado-preservado.txt` | `[ ]` |
| `vetoed` com nota padronizada | MD §5.1.3 | `estados/vetado.txt` | `[ ]` |
| `included`, `amended`, `suspended` | ADR-005 §3 | `estados/demais-estados.txt` | `[ ]` |
| `renumbered` com `renumeradoPara` | ADR-005 §3 | `identidade/renumeracao.txt` | `[ ]` |
| Block ID preservado em revogado | MD §5.1.4 | `estados/revogado-preservado.txt` | `[ ]` |
| Ativo não pode ter marcação de revogado | MD §9.7 | `estados/ativo-com-marcacao.txt` | `[ ]` |

## 4. Histórico de redações (T004-03)

`ADR-006`.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Redação anterior vira linha riscada acima da vigente | ADR-006 §1 | `historico/uma-redacao.txt` | `[ ]` |
| Ordem cronológica, mais antiga primeiro | ADR-006 §4 | `historico/varias-redacoes.txt` | `[ ]` |
| Linha de histórico **não** recebe Block ID | ADR-006 §2 | `historico/uma-redacao.txt` | `[ ]` |
| `(Redação dada…)` riscada sem ID ≠ `(Revogado…)` com ID | MD §5.5 | `historico/distinguir-nota.txt` | `[ ]` |
| Parsing inverso acumula histórico no próximo nó com ID | MD §5.5 | `historico/parsing-inverso.txt` | `[ ]` |
| Contagem de artigos vem da AST, não de itens de nível 0 | ADR-006, MD §9.4 | `historico/contagem.txt` | `[ ]` |

## 5. Anexos e tabelas (T004-03)

`DATA_MODEL.md` §Anexos; `MARKDOWN_SPEC.md` §3.3.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Anexo vira `## Anexo {n} - {titulo} ^{id}` | MD §3.3 | `anexos/anexo.txt` | `[ ]` |
| Anexo usa segmento `anx-{numero}` normalizado | BID §2.3.10 | `anexos/anexo-romano.txt` | `[ ]` |
| Artigo dentro de anexo carrega o segmento | BID §2.3.10 | `anexos/artigo-em-anexo.txt` | `[ ]` |
| Tabela referenciável no nível da tabela inteira | DM regra 2 | `anexos/tabela.txt` | `[ ]` |
| Serialização `; ` entre células e ` / ` entre linhas | MD §3.3.3 | `anexos/tabela.txt` | `[ ]` |
| Linha irregular falha antes da serialização | MD §3.3.5, §9.12 | `anexos/tabela-irregular.txt` | parcial (schema, 002) |
| Célula/linha não recebe Block ID | DM regra 2 | `anexos/tabela.txt` | `[ ]` |

## 6. Conjunto de fontes e evidência (T004-03)

`ADR-009`.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Exatamente uma `primary_current` | ADR-009 §1 | validado no domínio | `003` |
| Compilada é a preferida para texto vigente | ADR-009 §2 | `fontes/compilada-e-anotada/` | `[ ]` |
| Anotada enriquece histórico sem sobrescrever vigente | ADR-009 §3 | idem | `[ ]` |
| Ausência de compilada não bloqueia importação | ADR-009 §4 | `fontes/so-anotada/` | `[ ]` |
| `supportingSourceRefs` preserva a evidência complementar | ADR-009 §6 | `fontes/compilada-e-anotada/` | `[ ]` |
| Conflito entre fontes exige revisão humana | ADR-009 §6 | `fontes/conflito.txt` | `[ ]` |
| Ausência na compilada ≠ revogação | ADR-009 §7 | `identidade/ausente-na-candidata.txt` | `[ ]` |
| Confiança `low` exige `requiresHumanReview` | DM §NormaAST | validado no schema | `002` |
| Baixa confiança não avança para identificada | spec, invariante | `fontes/baixa-confianca.txt` | `[ ]` |

## 7. Identidade e reconciliação (T004-04, T004-05)

`ADR-001`; `BLOCK_ID_SPEC.md` §6 e §7.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Colisão na primeira publicação falha ou qualifica | BID §7.3 | `identidade/colisao-inedita.txt` | parcial (falha, 003) |
| Qualificação usa a menor divisão que desambigua | BID §2.4 | `identidade/colisao-por-divisao.txt` | `[ ]` |
| ID publicado não é reciclado nem recalculado | ADR-001 | `identidade/id-publicado-estavel.txt` | `[ ]` |
| Alteração textual não muda identidade | RF-004-03 | `identidade/mudanca-textual.txt` | `[ ]` |
| Colisão tardia não renomeia dispositivo publicado | BID §2.4 | `identidade/colisao-tardia.txt` | `[ ]` |
| Alias é permanente e acíclico | invariante | `identidade/alias-ciclo.txt` | `[ ]` |
| Renumeração produz redirect, não novo ID | RF-004-03 | `identidade/renumeracao.txt` | `[ ]` |
| Namespace histórico inclui revogados e depreciados | BID §2.4 | `identidade/namespace-historico.txt` | `[ ]` |
| Ambiguidade de identidade bloqueia | RF-004-04 | `identidade/ambiguo.txt` | `[ ]` |

## 8. Formatter e validação canônica (T004-06)

`MARKDOWN_SPEC.md` §9, as catorze verificações.

| # | Verificação | Estado |
|---|---|---|
| 1 | Frontmatter completo e tipado | `003` |
| 2 | Unicidade de Block ID | `003` |
| 3 | Cobertura de Block ID, com a exceção do histórico | parcial — falta a exceção da ADR-006 |
| 4 | Contagem de artigos bate com a AST | `003` (validador) |
| 5 | Indentação consistente, sem saltos | parcial — falta o caso de salto |
| 6 | Sintaxe de Block ID conforme a gramática | `003` |
| 7 | Consistência de `deviceStatus` | `[ ]` |
| 8 | Callouts obrigatórios presentes | `003` |
| 9 | Nenhum callout fora do cabeçalho | `003` |
| 10 | Headings não pulam nível | `[ ]` |
| 11 | Referências cruzadas resolvem | `[ ]` |
| 12 | Tabelas preservam retangularidade | parcial (schema) |
| 13 | Fase da NormaAST é `identified` | `003` |
| 14 | Rastreabilidade e confiança coerentes | parcial |

## 9. Projeção Postgres (T004-09)

`DATA_MODEL.md` §Schema Postgres/Supabase.

| Regra | Fixture mínima | Estado |
|---|---|---|
| AST → linhas sem perda semântica | `projecao/ida.test` | `[ ]` |
| Linhas → AST reconstrói a árvore | `projecao/volta.test` | `[ ]` |
| `camelCase` ↔ `snake_case` na fronteira | ADR-005 | `[ ]` |
| CHECKs do schema respeitados | `projecao/checks.test` | `[ ]` |

## 10. Leis de referência (T004-07, T004-08, T004-10)

| Lei | Fonte | Estado |
|---|---|---|
| Código Penal, DL 2.848/1940 | [texto compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm) | `[ ]` |
| Constituição Federal de 1988 | Planalto | `[ ]` |
| Lei curta — LINDB, DL 4.657/1942 | [compilado](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm) e [anotada](https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm) | `[ ]` |

A LINDB é a lei curta indicada porque a ADR-009 já a nomeia como caso de
referência para mesclagem entre compilada e anotada — cobre a §6 desta matriz
com uma norma real e pequena.

> **Lição da Feature 003, aplicável a todas as três.** A fixture do art. 121
> foi transcrita de `exemplos/` e divergia do oficial em seis pontos —
> grafias sem acento que o compilado preserva, pontuação final e sinais
> gráficos. Nenhum seria pego por revisão estrutural. Toda fixture desta
> feature é capturada da fonte oficial, e `exemplos/` serve só como referência
> comparativa, como a T004-07 já determina.

---

## Como esta matriz é usada

1. Nenhuma linha `[ ]` vira coberta sem fixture mínima **e** teste nomeado.
2. As leis integrais entram por último, quando a gramática já estiver coberta
   por casos mínimos — a ordem do `plan.md`.
3. A T004-10 fecha a matriz: toda linha em `coberta` ou com destino registrado.
