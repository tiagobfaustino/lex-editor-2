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
| AST → linhas sem perda semântica | `projecao-postgres.test.ts` ida e volta | coberta |
| Linhas → AST reconstrói a árvore | idem, inclusive com linhas embaralhadas | coberta |
| `camelCase` ↔ `snake_case` na fronteira | `projecao-postgres.test.ts` forma das linhas | coberta |
| CHECKs do schema respeitados | idem — block_id, revogação e tabela | coberta |

### Lacuna encontrada: a raiz não tem onde morar

`LeiNode` estende `NormaNodeBase`, então a raiz carrega `id`, `ordem`,
`sourceRef`, `supportingSourceRefs` e `parseEvidence`. **Nenhuma tabela tem
coluna para eles**: `leis` e `versoes_lei` não os preveem, e `dispositivos` não
aceita `tipo = 'lei'` — o CHECK enumera os catorze tipos e a raiz não está
entre eles.

Sem tratamento, a ida e volta perderia a rastreabilidade da própria norma: de
que artefato ela veio e com que confiança foi interpretada. O adaptador carrega
os campos em `LinhaDaRaiz`, explicitamente, para que a perda não seja
silenciosa. **Onde eles vão morar no banco é decisão da Feature 007**, que é
quem escreve o SQL de verdade.

### Nota sobre `revogada_por`

A coluna é sempre presente e anulável, então a volta sempre emite o campo. Uma
árvore que vinha sem ele volta com `null`. Os dois dizem "não revogada", e
normalizar uma vez é melhor que carregar a distinção entre ausente e nulo por
todo o pipeline — o teste de ponto fixo garante que a normalização é estável.

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

## Divergência resolvida — alínea diretamente sob artigo

Encontrada na T004-07 e **resolvida pela
[ADR-010](../../../docs/architecture/ADR-010-alinea-sob-artigo-e-paragrafo.md)**.

O `DATA_MODEL.md` modelava `AlineaNode` só como filha de `IncisoNode`. O texto
compilado da LINDB contradiz isso no art. 15, onde cinco alíneas pendem do
caput. A decisão foi estender o modelo: alínea passa a ser filha admissível de
artigo, parágrafo e inciso, e a gramática de Block ID acompanha.

`DATA_MODEL.md` §NormaAST e `BLOCK_ID_SPEC.md` §2.1 foram emendados; o código
seguiu depois, não antes. Verificação em `lindb-integral.test.ts`:
`lindb-art-15-ali-a` a `-ali-e` são produzidos, e nenhum inciso é inventado na
cadeia.

## Achado resolvido — artigos sem o prefixo `Art.`

Os arts. 20 e seguintes da LINDB chegavam como `20. Nas esferas...`. O HTML do
Planalto quebra a linha **dentro** do texto (`Art. \r\n\t20.`), e a extração
tratava essa quebra crua como quebra de parágrafo. Em HTML ela é espaço: só
elemento de bloco quebra. Corrigido em `extrairLinhas`.

## Estado das leis de referência

| Lei | Snapshot | Pipeline |
|---|---|---|
| LINDB (lei curta) | capturado | **passa**: 30 artigos, 88 dispositivos, 88 Block IDs |
| Código Penal | capturado (660 KB) | **parsing completo**; para na identificação, por baixa confiança na ancoragem de pena |
| Constituição Federal de 1988 | capturado (1,8 MB) | 12 linhas não reconhecidas |

Os três snapshots estão versionados. A LINDB fecha; CP e CF/88 esbarram em dois
padrões, ambos identificados e ambos trabalho da T004-08:

**Nomen juris — resolvido na quarta tentativa.** O negrito do Planalto serve a
**dois usos opostos**, e é isso que derrubou as três primeiras regras:

| Pedaço anterior | O pedaço em negrito é |
|---|---|
| divisão sem ementa na mesma linha | a ementa dela, **obrigatória** |
| dispositivo completo | rubrica (nomen juris), **descartável** |

Descartar todo negrito faz `TÍTULO III` engolir o art. 26; manter tudo faz
`Homicídio simples` grudar em `CAPÍTULO I DOS CRIMES CONTRA A VIDA`.

A solução tem duas partes. `varrerPedacos` transforma a ênfase em **atributo do
pedaço**, decidido durante a varredura — marca embutida no texto não serve,
porque sobrevive à quebra de bloco e cai no pedaço do artigo, que foi como as
três primeiras derrubaram artigo. E `extrairLinhas` recebe a gramática por
parâmetro, para saber se o pedaço anterior era divisão esperando ementa. O
extrator não implementa a regra jurídica; ele pergunta.

Coberto por `extrator-planalto.test.ts`, que prende as duas leituras lado a
lado — inclusive o caso `<b>rubrica <br></b> Art. 188`, em que a tag de
fechamento cai no pedaço do artigo.

**Ementa de divisão separada do designador** na CF/88 segue aberta: quando o
riscado quebra o par, o par não se reconstitui.

### O que a captura das três leis já corrigiu no extrator

| Sintoma | Causa |
|---|---|
| Texto corrompido (`disposição` virando mojibake) | encoding adivinhado pelo cabeçalho; agora tenta utf-8 estrito e cai para windows-1252 |
| `1.991, de 1953` lido como item `1.` | separador de item não exigia espaço depois |
| Arts. 20+ da LINDB sem o prefixo `Art.` | quebra de linha crua do arquivo tratada como quebra de parágrafo; em HTML ela é espaço |
| Art. 6º da CF/88 aparecendo quatro vezes | `<strike>` removido junto com as demais tags, apagando a distinção entre redação anterior e vigente (ADR-006) |
| Dispositivo revogado engolindo o texto do seguinte | o riscado não era fronteira ao juntar continuações |

Nenhum deles apareceria em fixture sintética. É o argumento concreto para a
ordem do `plan.md`: casos mínimos primeiro, leis inteiras depois — mas leis
inteiras **antes** de declarar a gramática pronta.

---

## Bloqueios que exigem decisão normativa

Levantados em 2026-08-09, a partir de revisão externa e **conferidos aqui** —
os números abaixo são os medidos, não os relatados.

### 1. ADCT não existe no modelo

O extrator descarta `ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS` como
rubrica: no HTML ele vem em `<b>`, e nada antes dele espera ementa. Sem esse
nó, os artigos do ADCT ficam no topo e colidem com os da Constituição, que
reinicia a numeração.

Nem o `DATA_MODEL.md` nem a `BLOCK_ID_SPEC.md` definem nó ou segmento para o
ADCT. Modelá-lo como anexo seria decidir por conta própria que o ADCT é um
anexo da Constituição, o que é afirmação jurídica, não de implementação.

**Medido:** com o gerador corrigido, a CF/88 para na identificação com 4
colisões `block_id_duplicado` — comportamento correto da §7.3.

**Sugestão a decidir:** namespace explícito, `cf1988-adct-art-1`. Exige ADR e
emenda à `BLOCK_ID_SPEC.md` §2.1, no mesmo rito da ADR-010.

### 2. Redação anterior sem nota

A ADR-006 §4 modela `redacoesAnteriores` como par `{ texto, nota }`, e o schema
exige nota não vazia. O Planalto nem sempre fornece uma: a redação originária
aparece riscada e sem parentético algum.

**Medido:** a CF/88 tem 753 linhas riscadas; **743** produzem redação anterior
sem nota. É a maioria, não a exceção.

Inventar `"Redação original"` seria escrever conteúdo jurídico que a fonte não
tem. **A decidir:** tornar `nota` opcional na ADR-006 e no schema, ou definir
outra representação para a redação originária.

### 3. Ancoragem de pena no CP

O CP tem penas em que mais de um ancestral termina em dois-pontos. O contrato
atual marca confiança `low`, e a invariante da feature impede que isso avance
para a AST identificada — por desenho.

**Medido:** a CLI reporta 50 problemas, que é o teto de `LIMITE_PROBLEMAS`; o
total real é maior. Escolher o ancestral mais próximo automaticamente mudaria o
contrato e precisa de regra jurídica aprovada com teste, não de ajuste local.

### 4. Fidelidade da extração, antes da identificação

Parsing completo não é parsing correto. Há linhas contaminadas a investigar —
rubrica concatenada a pena, incisos concatenados — e isso precede qualquer
trabalho de identificação. **Ainda não medido caso a caso.**

## Correção de um relato anterior

Registrei antes que a CF/88 tinha "25 nós sem texto". **Estava errado**: o
relatório da CLI corta em 50 problemas, e eu li 25 + 25 como se fosse a lista
inteira. A varredura da árvore identificada mostra **zero** nós sem texto. Os
25 eram Block IDs com segmento vazio, hoje corrigidos.

A lição é de método: não concluir a partir de relatório truncado.
