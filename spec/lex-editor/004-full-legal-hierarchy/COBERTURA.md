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
| Livro vira `#` | MD §3.1 | `gramatica.test.ts` divisões | coberta |
| Título vira `##` | MD §3.1 | `gramatica.test.ts` divisões | coberta |
| Capítulo vira `###` | MD §3.1 | `gramatica.test.ts` divisões | coberta |
| Seção vira `####` | MD §3.1 | `gramatica.test.ts` divisões | coberta |
| Subseção vira `#####` | MD §3.1 | `gramatica.test.ts` divisões | coberta |
| Divisão não recebe Block ID por padrão | MD §7.3 | `gramatica.test.ts` divisões | coberta |
| Heading não pula nível | MD §9.10 | `divisoes/salto-de-nivel.txt` | `[ ]` |
| Divisão entra no ID só para desambiguar | BID §2.4 | `gramatica.test.ts` desambiguação | coberta |
| Número da divisão é ordinal cardinal, não romano | BID §8.2 | `gramatica.test.ts` desambiguação | coberta |

## 2. Gramática de dispositivos (T004-02)

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Artigo, caput e `art-{n}` | BID §2.3 | `fixtures/legal/cp-art-121/` | `003` |
| Artigo com sufixo alfabético (`121-A`) | BID §2.3.6 | `gramatica.test.ts` dispositivos | coberta |
| Parágrafo numerado `par-{n}` | BID §2.3.5 | cp-art-121 | `003` |
| Parágrafo único `par-unico` | BID §2.3.5 | `gramatica.test.ts` dispositivos | coberta |
| Parágrafo único e numerado são exclusivos | BID §2.3.5 | `dispositivos/paragrafo-conflito.txt` | `[ ]` |
| Inciso em romano minúsculo | BID §2.3.7 | cp-art-121 | `003` |
| Inciso com sufixo (`inc-i-a`) | BID §2.1 | `gramatica.test.ts` dispositivos | coberta |
| Alínea letra única | BID §2.3.8 | cp-art-121 | `003` |
| Alínea letra dupla (`ali-aa`) | BID §7.2 | `gramatica.test.ts` dispositivos | coberta |
| Item em cardinal arábico | BID §2.3.9 | `gramatica.test.ts` dispositivos | coberta |
| Pena autônoma sem número | BID §2.3.12 | cp-art-121 | `003` |
| Pena numerada (`pena-2`) | BID §2.3.12 | `dispositivos/pena-numerada.txt` | `[ ]` |
| Pena ancorada em ancestral, não no anterior | BID §2.3.12 | `gramatica.test.ts` ancoragem | coberta |
| Pena na mesma frase não vira nó | BID §2.3.12 | `dispositivos/pena-embutida.txt` | `[ ]` |

> **Resolvido na T004-02.** O sinal disponível no texto plano é o dois-pontos:
> um dispositivo que termina em `:` anuncia o que vem abaixo. Com um único
> candidato aberto a decisão é firme; com mais de um — o § anuncia a lista e o
> último inciso também —, o texto plano genuinamente não resolve, e a pena é
> ancorada no mais próximo com confiança `low` e revisão obrigatória. A
> invariante da feature então impede que ela avance para a AST identificada.
> Fingir certeza aqui produziria Block ID permanente sobre palpite.

## 3. Estados do dispositivo (T004-03)

`ADR-005`; `MARKDOWN_SPEC.md` §5.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| `revoked` com texto residual, sem riscado | MD §5.1.1, §5.3 | cp-art-121 (inciso VI) | `003` |
| `revoked` com texto preservado e riscado | MD §5.1.2, §5.3 | `estados-e-anexos.test.ts` estados | coberta |
| `vetoed` com nota padronizada | MD §5.1.3 | `estados-e-anexos.test.ts` estados | coberta |
| `included`, `amended`, `suspended` | ADR-005 §3 | `estados-e-anexos.test.ts` estados | coberta |
| `renumbered` com `renumeradoPara` | ADR-005 §3 | `estados-e-anexos.test.ts` estados (estado); `renumeradoPara` na T004-05 | parcial |
| Block ID preservado em revogado | MD §5.1.4 | `estados-e-anexos.test.ts` estados | coberta |
| Ativo não pode ter marcação de revogado | MD §9.7 | `estados/ativo-com-marcacao.txt` | `[ ]` |

## 4. Histórico de redações (T004-03)

`ADR-006`.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Redação anterior vira linha riscada acima da vigente | ADR-006 §1 | `estados-e-anexos.test.ts` histórico | coberta |
| Ordem cronológica, mais antiga primeiro | ADR-006 §4 | `estados-e-anexos.test.ts` histórico | coberta |
| Linha de histórico **não** recebe Block ID | ADR-006 §2 | `estados-e-anexos.test.ts` histórico | coberta |
| `(Redação dada…)` riscada sem ID ≠ `(Revogado…)` com ID | MD §5.5 | `historico/distinguir-nota.txt` | `[ ]` |
| Parsing inverso acumula histórico no próximo nó com ID | MD §5.5 | `estados-e-anexos.test.ts` histórico | coberta |
| Contagem de artigos vem da AST, não de itens de nível 0 | ADR-006, MD §9.4 | `estados-e-anexos.test.ts` histórico | coberta |

## 5. Anexos e tabelas (T004-03)

`DATA_MODEL.md` §Anexos; `MARKDOWN_SPEC.md` §3.3.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Anexo vira `## Anexo {n} - {titulo} ^{id}` | MD §3.3 | `estados-e-anexos.test.ts` anexos | coberta |
| Anexo usa segmento `anx-{numero}` normalizado | BID §2.3.10 | `estados-e-anexos.test.ts` anexos | coberta |
| Artigo dentro de anexo carrega o segmento | BID §2.3.10 | `estados-e-anexos.test.ts` anexos | coberta |
| Tabela referenciável no nível da tabela inteira | DM regra 2 | `estados-e-anexos.test.ts` anexos | coberta |
| Serialização `; ` entre células e ` / ` entre linhas | MD §3.3.3 | `estados-e-anexos.test.ts` anexos | coberta |
| Linha irregular falha antes da serialização | MD §3.3.5, §9.12 | `estados-e-anexos.test.ts` anexos | coberta |
| Célula/linha não recebe Block ID | DM regra 2 | `estados-e-anexos.test.ts` anexos | coberta |

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
| Ausência na compilada ≠ revogação | ADR-009 §7 | `identidade.test.ts` namespace | coberta |
| Confiança `low` exige `requiresHumanReview` | DM §NormaAST | validado no schema | `002` |
| Baixa confiança não avança para identificada | spec, invariante | `gramatica.test.ts` baixa confiança | coberta |

## 7. Identidade e reconciliação (T004-04, T004-05)

`ADR-001`; `BLOCK_ID_SPEC.md` §6 e §7.

| Regra | Fonte normativa | Fixture mínima | Estado |
|---|---|---|---|
| Colisão na primeira publicação falha ou qualifica | BID §7.3 | `gramatica.test.ts` desambiguação | coberta |
| Qualificação usa a menor divisão que desambigua | BID §2.4 | `gramatica.test.ts` desambiguação | coberta |
| ID publicado não é reciclado nem recalculado | ADR-001 | `identidade.test.ts` namespace | coberta |
| Alteração textual não muda identidade | RF-004-03 | `identidade.test.ts` identidade/texto | coberta |
| Colisão tardia não renomeia dispositivo publicado | BID §2.4 | `identidade.test.ts` colisão tardia | coberta |
| Alias é permanente e acíclico | invariante | `identidade.test.ts` aliases | coberta |
| Renumeração produz redirect, não novo ID | RF-004-03 | `reconciliar` emite alias a partir de `renumeradoPara` | parcial — falta caso ponta a ponta |
| Namespace histórico inclui revogados e depreciados | BID §2.4 | `identidade.test.ts` namespace | coberta |
| Ambiguidade de identidade bloqueia | RF-004-04 | `identidade.test.ts` ambiguidade | coberta |

## 8. Formatter e validação canônica (T004-06)

`MARKDOWN_SPEC.md` §9, as catorze verificações.

| # | Verificação | Estado |
|---|---|---|
| 1 | Frontmatter completo e tipado | `003` |
| 2 | Unicidade de Block ID | `003` |
| 3 | Cobertura de Block ID, com a exceção do histórico | `validacao-canonica.test.ts` §9.3 |
| 4 | Contagem de artigos bate com a AST | `003` (validador) |
| 5 | Indentação consistente, sem saltos | `validacao-canonica.test.ts` §9.5 |
| 6 | Sintaxe de Block ID conforme a gramática | `003` |
| 7 | Consistência de `deviceStatus` | `estados-e-anexos.test.ts` estados |
| 8 | Callouts obrigatórios presentes | `003` |
| 9 | Nenhum callout fora do cabeçalho | `003` |
| 10 | Headings não pulam nível | `validacao-canonica.test.ts` §9.10 |
| 11 | Referências cruzadas resolvem | `validacao-canonica.test.ts` §9.11 |
| 12 | Tabelas preservam retangularidade | `estados-e-anexos.test.ts` anexos |
| 13 | Fase da NormaAST é `identified` | `003` |
| 14 | Rastreabilidade e confiança coerentes | evidência validada no schema; baixa confiança bloqueia na identificação |

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

---

## Divergência aberta — alínea diretamente sob artigo

Encontrada na T004-07, ao rodar a LINDB integral pela primeira vez.

O `DATA_MODEL.md` §NormaAST modela `AlineaNode` **apenas** como filha de
`IncisoNode`:

```typescript
interface IncisoNode  { children: (AlineaNode | PenaNode)[]; }
interface ArtigoNode  { children: (ParagrafoNode | IncisoNode | PenaNode)[]; }
```

O texto oficial compilado da LINDB contradiz isso no art. 15:

```
Art. 15. Será executada no Brasil a sentença proferida no estrangeiro, que
reuna os seguintes requisitos:
a) haver sido proferida por juiz competente;
b) terem sido os partes citadas ou haver-se legalmente verificado à revelia;
...
```

As alíneas pendem do caput, sem inciso intermediário. Não é caso isolado nem
erro de extração: é a estrutura da norma.

**Não corrigi o parser nem o modelo.** A DEVELOPMENT_RULES §5 manda parar e
registrar em conflito documental real, e a AGENTS.md proíbe ajustar contrato
superior em silêncio para o código passar. As duas saídas possíveis mudam
coisas diferentes:

1. **Estender o `DATA_MODEL`** para admitir `AlineaNode` em `ArtigoNode.children`
   e em `ParagrafoNode.children`. Reflete a legislação real, mas altera
   especificação normativa e exige rever a gramática de Block ID — hoje
   `ali-` só aparece depois de `inc-`, e um ID como `lindb-art-15-ali-a` não é
   produzível pela §2.1 vigente.
2. **Tratar como irregularidade da fonte**, marcando confiança baixa e exigindo
   decisão editorial. Preserva o modelo, mas joga para revisão humana uma
   estrutura que é corriqueira — a LINDB tem cinco alíneas assim num artigo só.

A primeira parece certa, mas é decisão de arquitetura, não de implementação.

## Achado menor — artigos sem o prefixo `Art.`

Na mesma execução, os arts. 20, 21 e seguintes da LINDB (incluídos pela Lei
13.655/2018) chegam como `20. Nas esferas administrativa...`, sem `Art.`. Ou o
HTML os marca de outra forma, ou a extração está separando o prefixo. Investigar
na T004-08, que é a tarefa de auditoria.
