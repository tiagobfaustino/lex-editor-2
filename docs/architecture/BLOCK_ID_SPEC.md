# Especificação de Block IDs — Vinculex / Lex Editor

Versão: 1.2
Status: Normativo (esta especificação é a fonte de verdade para o Parser, o gerador de Block IDs e o Formatter)
Escopo: geração, reconciliação, validação e ciclo de vida de identificadores
canônicos de dispositivos legais (`block-id`), renderizados como `^block-id`
no Markdown produzido pelo Lex Editor.

## Sumário

- [1. Propósito e motivação](#1-propósito-e-motivação)
- [2. Gramática formal do ID](#2-gramática-formal-do-id)
- [3. Tabela de siglas oficiais](#3-tabela-de-siglas-oficiais)
- [4. Exemplos completos](#4-exemplos-completos)
- [5. Regras de imutabilidade](#5-regras-de-imutabilidade)
- [6. Deprecação de um Block ID publicado](#6-deprecação-de-um-block-id-publicado)
- [7. Detecção e resolução de colisão de IDs](#7-detecção-e-resolução-de-colisão-de-ids)
- [8. Algoritmo de geração](#8-algoritmo-de-geração)
- [9. Casos especiais e ambiguidades conhecidas](#9-casos-especiais-e-ambiguidades-conhecidas)

---

## 1. Propósito e motivação

Um Block ID é o identificador **canônico, semântico e imutável** de um dispositivo legal (artigo, parágrafo, inciso, alínea ou item) dentro de uma norma. O valor de domínio e de persistência não contém o prefixo `^` (ex.: `cp-art-121`). O Formatter acrescenta esse caractere exclusivamente ao materializar a sintaxe nativa de block reference do Obsidian (`^cp-art-121`), o que permite:

- Linkar diretamente para um dispositivo específico (`[[cp#^cp-art-121-par-2-inc-i]]`);
- Gerar backlinks confiáveis entre normas correlatas (ex.: um artigo do CPP que remete a um artigo do CP);
- Anotar dispositivos individualmente com notas do Obsidian sem perder a referência quando o arquivo for reformatado;
- Persistir vínculos de estudo (cadernos de questões, flashcards, mapas mentais) através de atualizações do texto legal.

### 1.1 Por que o ID representa posição, não conteúdo

A regra central deste documento é: **o Block ID identifica o lugar do dispositivo na estrutura da lei, não o texto vigente naquele lugar.**

Isso decorre de uma característica factual da legislação brasileira: leis são alteradas por outras leis, mas a *posição estrutural* de um dispositivo (art. 121, § 2º, inciso I do Código Penal) é estável mesmo quando sua redação muda. Se o ID fosse derivado do conteúdo textual (ex.: um hash do texto, ou um slug do início da frase), qualquer alteração legislativa quebraria todos os links, notas e backlinks apontando para aquele dispositivo — destruindo exatamente o valor que o Obsidian promete entregar (conhecimento conectado e persistente).

Consequência prática: alterar a redação de um artigo é uma operação de **atualização de conteúdo**, nunca de **regeneração de ID**. O ID muda apenas quando a posição estrutural do dispositivo muda (ver Seção 6).

Há duas fases de autoridade:

1. **Pré-publicação:** a estrutura atual da norma determina os candidatos a
   ID de forma determinística.
2. **Pós-publicação:** o Git e o registro versionado de Block IDs são
   autoritativos. A estrutura candidata é reconciliada com a última versão
   publicada; IDs existentes são reutilizados e nunca recalculados apenas
   porque a árvore atual passou a exigir outra desambiguação.

Portanto, "determinístico" não significa que uma NormaAST atual isolada
reconstrói decisões históricas. Depois da primeira publicação, a reconstrução
correta exige os artefatos canônicos versionados.

---

## 2. Gramática formal do ID

### 2.1 Notação EBNF

```ebnf
block-id        = sigla , { "-" , divisao-intermediaria } , "-" , ( dispositivo-artigo | anexo | tabela ) ;
obsidian-anchor = "^" , block-id ;

sigla           = letra-minuscula , { letra-minuscula | digito | "-" } ;

divisao-intermediaria
                = ( "liv" | "tit" | "cap" | "sec" | "sub" ) , "-" , numero-cardinal ;

dispositivo-artigo
                = "art" , "-" , numero-artigo ,
                  [ "-" , ( dispositivo-paragrafo | dispositivo-inciso | dispositivo-pena ) ] ;

numero-artigo   = digito-sequencia , [ "-" , letra-aditiva ] ;
                  (* ex.: "121", "121-a", "5" *)

letra-aditiva   = letra-minuscula , { letra-minuscula } ;
                  (* "a", "b", "aa" -- ver §7.2 *)

dispositivo-paragrafo
                = "par" , "-" , ( "unico" | numero-cardinal ) ,
                  [ "-" , ( dispositivo-inciso | dispositivo-pena ) ] ;

dispositivo-inciso
                = "inc" , "-" , numero-inciso ,
                  [ "-" , ( dispositivo-alinea | dispositivo-pena ) ] ;

numero-inciso   = numeral-romano-minusculo , [ "-" , letra-aditiva ] ;

dispositivo-alinea
                = "ali" , "-" , letra-aditiva ,
                  [ "-" , ( dispositivo-item | dispositivo-pena ) ] ;

dispositivo-item
                = "item" , "-" , numero-cardinal ,
                  [ "-" , dispositivo-pena ] ;

dispositivo-pena
                = "pena" , [ "-" , numero-cardinal ] ;

anexo           = "anx" , "-" , numero-anexo ,
                  [ "-" , ( dispositivo-artigo | tabela ) ] ;
tabela          = "tab" , "-" , numero-cardinal ;
numero-anexo    = numero-cardinal | numeral-romano-minusculo | letra-aditiva ;

numero-cardinal = digito-sequencia ;
digito-sequencia
                = digito , { digito } ;
digito          = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
letra-minuscula = "a" | "b" | ... | "z" ;
numeral-romano-minusculo
                = "i" | "ii" | "iii" | "iv" | "v" | "vi" | "vii" | "viii" | "ix" | "x" | ... ;
```

### 2.2 Template canônico

```
{sigla}[-{divisao-intermediaria}...]-art-{numero}[-par-{numero|unico}][-inc-{romano}][-ali-{letra}][-item-{numero}][-pena[-{numero}]]
{sigla}-anx-{numero-anexo}
{sigla}-anx-{numero-anexo}-art-{numero}...
{sigla}-anx-{numero-anexo}-tab-{numero}
{sigla}-tab-{numero}
```

No Markdown, e somente nele, o Formatter serializa esses valores como
`^{block-id}`.

### 2.3 Regras de composição

1. **Segmentos são cumulativos e hierárquicos.** Um ID de item obrigatoriamente contém os segmentos de alínea, inciso, parágrafo (se houver) e artigo que o contêm. Não é permitido "pular" um nível existente (ex.: um item dentro de uma alínea não pode omitir o segmento `ali`).
2. **Separador único: hífen (`-`).** Nunca use underscore, ponto ou espaço.
3. **Tudo em minúsculas.** Inclui siglas, numerais romanos e letras de alínea. O Obsidian trata block references como case-sensitive em alguns contextos de busca; a normalização em minúsculas evita ambiguidade e colisão silenciosa entre `^CP-Art-121` e `^cp-art-121`.
4. **Sem acentos, sem caracteres especiais.** Siglas e segmentos usam apenas `[a-z0-9-]`.
5. **Parágrafo único vs. numerado:**
   - Se o artigo tem um único parágrafo redigido como "Parágrafo único", o segmento é `par-unico` (não `par-1`).
   - Se o artigo tem parágrafos numerados (§ 1º, § 2º, ...), o segmento é `par-{n}` com `n` cardinal (`par-1`, `par-2`), nunca ordinal e nunca com símbolo `§`.
   - Um artigo nunca tem simultaneamente `par-unico` e `par-{n}` — são mutuamente exclusivos por definição legislativa.
6. **Numeração composta de artigo (art. 121-A, 121-B):** o sufixo alfabético faz parte do `numero-artigo`, unido por hífen e em minúsculas: `art-121-a`, `art-121-b`. Isso é o único caso em que uma letra aparece imediatamente após o segmento `art` sem um rótulo (`par`/`inc`/`ali`) precedendo-a — o parser deve tratar `art-{digitos}-{letra-única}` como uma unidade atômica de numeração de artigo, não como um sub-dispositivo.
7. **Incisos usam numeral romano em minúsculas**, nunca numeral arábico: `inc-i`, `inc-iv`, `inc-lvii`, `inc-xlii`. Isso segue a convenção legislativa brasileira, que numera incisos em algarismos romanos.
8. **Alíneas usam letra minúscula única (ou dupla — ver §7.2):** `ali-a`, `ali-b`, ..., `ali-z`, e após esgotar o alfabeto, `ali-aa`, `ali-bb`.
9. **Itens usam numeral cardinal arábico**, conforme a convenção legislativa (itens de alínea são normalmente numerados em arábico: "1.", "2."): `item-1`, `item-2`.
10. **Anexos suportados usam `anx-{numero}`.** O número é normalizado sem acento e em minúsculas (`ANEXO I` → `anx-i`). Dispositivos textuais dentro de anexo carregam esse segmento antes de `art`.
11. **Tabelas simples suportadas usam `tab-{numero}`.** O ID referencia a tabela inteira, nunca linha ou célula individual. Uma tabela dentro de anexo inclui o segmento do anexo (`lda-anx-i-tab-1`).
12. **Penas textualmente autônomas usam `pena`.** Quando a fonte apresenta a
    pena como linha própria vinculada a um artigo, parágrafo, inciso, alínea ou item,
    ela é um `PenaNode` referenciável e recebe o sufixo `-pena`. Se houver mais
    de uma pena sob o mesmo pai, usa-se a ordem jurídica explícita
    (`-pena-2`, `-pena-3`); o gerador nunca inventa numeração apenas pela ordem
    de parsing. Texto de pena incorporado à mesma frase do dispositivo
    permanece no texto do pai e não cria nó separado.

### 2.4 Divisões intermediárias — quando incluir

Por padrão, o Block ID **não inclui** capítulo, seção ou título, porque o número do artigo já é único dentro de uma norma na esmagadora maioria dos códigos brasileiros (numeração é contínua do art. 1º ao último artigo, independente da divisão estrutural).

A divisão intermediária **deve ser incluída** apenas quando é estruturalmente necessária para desambiguar, isto é, quando a mesma norma reinicia a numeração de artigos por divisão (padrão raro, mas existente em alguns anexos, regulamentos e leis compiladas com capítulos numerados de forma independente). Nesse caso:

- Inclua apenas a menor divisão suficiente para desambiguar (não empilhe livro + título + capítulo se o capítulo sozinho já resolve).
- Use as abreviações fixas: `liv` (livro), `tit` (título), `cap` (capítulo), `sec` (seção), `sub` (subseção).
- Formato: `{abrev}-{numero-cardinal-da-divisao}`, onde o número é a posição ordinal da divisão (Capítulo III → `cap-3`), nunca o numeral romano do texto.

Exemplo (hipotético, norma cuja numeração reinicia por capítulo):

```
lei-9999-2020-cap-2-art-1
```

Regra de decisão na **primeira publicação**: antes de emitir o ID de um artigo,
o algoritmo de geração (Seção 8) verifica todos os candidatos da norma. Se
dois ou mais dispositivos novos colidirem, a menor divisão ancestral que os
diferencia é inserida no ID de **todos** os candidatos conflitantes.

Regra de decisão em **atualizações**: o pipeline carrega primeiro o registro
histórico. Um dispositivo já publicado mantém seu ID, mesmo que uma nova
ramificação passe a produzir o mesmo candidato simples. Somente o dispositivo
novo recebe a menor sequência de divisões ancestrais que resulte em um ID não
reservado. A busca considera todo ID já emitido para a lei, inclusive IDs de
dispositivos revogados, renumerados ou depreciados.

---

## 3. Tabela de siglas oficiais

| Norma | Sigla | Observação |
|---|---|---|
| Constituição Federal de 1988 | `cf1988` | Ano incluído por convenção (distingue de futuras constituições/emendas de referência) |
| Código Penal (Decreto-Lei 2.848/1940) | `cp` | |
| Código de Processo Penal (Decreto-Lei 3.689/1941) | `cpp` | |
| Código de Processo Penal Militar (Decreto-Lei 1.002/1969) | `cppm` | |
| Código de Trânsito Brasileiro (Lei 9.503/1997) | `ctb` | |
| Estatuto da Criança e do Adolescente (Lei 8.069/1990) | `eca` | |
| Lei 14.133/2021 (Nova Lei de Licitações e Contratos) | `nllc` | Sigla mnemônica consagrada no projeto; alternativa aceitável `lei-14133-2021` para novas leis sem apelido definido |
| Código Penal Militar (Decreto-Lei 1.001/1969) | `cpm` | |
| Código Civil (Lei 10.406/2002) | `cc` | |
| Consolidação das Leis do Trabalho (Decreto-Lei 5.452/1943) | `clt` | |

### 3.1 Regra geral de geração de sigla para lei nova

Para normas sem apelido consagrado no projeto, a sigla é gerada deterministicamente a partir do tipo e da identificação numérica da norma:

```
{tipo-abreviado}-{numero}-{ano}
```

Onde `tipo-abreviado` segue a tabela:

| Tipo de norma | Abreviação |
|---|---|
| Lei ordinária | `lei` |
| Lei complementar | `lc` |
| Decreto-lei | `dl` |
| Decreto | `dec` |
| Medida provisória | `mp` |
| Emenda constitucional | `ec` |

Exemplos: `lei-14133-2021`, `lc-95-1998`, `dl-2848-1940`, `ec-19-1998`.

**Precedência:** se a norma possuir um código/sigla consagrado e cadastrado na tabela oficial do projeto (Seção 3, tabela principal), esse é usado preferencialmente à forma genérica `{tipo}-{numero}-{ano}`, para manter legibilidade (`cp` em vez de `dl-2848-1940`). A tabela oficial é mantida no repositório do Lex Editor como fonte de verdade extensível; a regra genérica é o *fallback* automático para qualquer norma ainda não cadastrada, garantindo que o gerador nunca fique sem produzir um ID válido.

**Imutabilidade da sigla:** uma vez atribuída e publicada, a sigla de uma norma nunca é alterada, mesmo que um apelido mais popular seja adotado depois — trocar a sigla quebraria todos os Block IDs já publicados daquela norma inteira. Correções de sigla (erro de digitação, por exemplo) só são permitidas antes da primeira publicação.

---

## 4. Exemplos completos

| # | Caso | Block ID |
|---|---|---|
| 1 | Artigo simples, sem subdivisão | `cp-art-121` |
| 2 | Artigo com parágrafo único | `eca-art-4-par-unico` |
| 3 | Artigo com múltiplos parágrafos numerados (§ 2º) | `cp-art-121-par-2` |
| 4 | Inciso dentro de parágrafo | `cp-art-121-par-2-inc-i` |
| 5 | Inciso direto no artigo (sem parágrafo intermediário) | `cf1988-art-5-inc-lvii` |
| 6 | Alínea dentro de inciso | `nllc-art-1-par-3-inc-ii-ali-b` |
| 7 | Item dentro de alínea | `ctb-art-165-par-1-inc-i-ali-a-item-1` |
| 8 | Artigo com numeração composta (art. 121-A) | `cp-art-121-a` |
| 9 | Parágrafo de artigo com numeração composta | `cp-art-121-a-par-1` |
| 10 | Dispositivo revogado (ID preservado; sinalização só no Markdown/metadados) | `cp-art-224` |
| 11 | Dispositivo vetado (ID preservado desde a promulgação) | `nllc-art-178-par-4` |
| 12 | Artigo cuja numeração é reiniciada por capítulo — desambiguado por divisão intermediária | `lei-9999-2020-cap-2-art-1` |
| 13 | Inciso com alínea dupla (após esgotar o alfabeto simples) | `cf1988-art-37-inc-xxi-ali-aa` |
| 14 | Artigo dentro de código com título e capítulo relevantes para outra norma reiniciada | `ctb-tit-3-cap-1-art-1` |
| 15 | Pena autônoma do caput de artigo | `cp-art-121-pena` |
| 16 | Pena autônoma de parágrafo | `cp-art-129-par-1-pena` |

> Nota sobre exemplos 10 e 11: o Block ID de um dispositivo revogado ou vetado é **idêntico** ao que teria sido gerado se o dispositivo estivesse em vigor normalmente. A revogação/veto é um atributo de estado do dispositivo — o campo `deviceStatus` da NormaAST, projetado como `device_status` no banco (ver `MARKDOWN_SPEC.md`, Seção 5, e `./ADR-005-status-fields.md`) —, nunca uma alteração estrutural do ID.

---

## 5. Regras de imutabilidade

1. **Alteração de redação não altera o ID.** Se a Lei X altera a redação do art. 121, § 2º, VIII do CP, o ID permanece `cp-art-121-par-2-inc-viii`. O conteúdo textual do nó na NormaAST passa a ser a redação vigente, e `redacaoAtualDadaPor` registra a lei alteradora no dispositivo; essas referências são agregadas em `LeiNode.redacoesDadasPor` e serializadas como `redacao_dada_por` no frontmatter (ver `MARKDOWN_SPEC.md`). Por ADR-006, as redações anteriores também são materializadas no corpo como linhas riscadas de histórico — que **não** recebem Block ID; apenas a redação vigente carrega a âncora `^id` na serialização Markdown.
2. **Revogação não remove o ID.** O dispositivo permanece na árvore, marcado com `deviceStatus: 'revoked'` (ver `./ADR-005-status-fields.md`), preservando o Block ID e o histórico de links/notas.
3. **Renumeração ou desmembramento por lei posterior** (caso em que uma lei reorganiza a estrutura de uma norma, ex.: transforma um parágrafo único em §§ 1º a 3º, ou insere um novo inciso entre dois existentes deslocando a numeração romana subsequente) segue a regra de **preservação por ancoragem histórica**:
   - O Block ID original de cada dispositivo pré-existente **nunca muda**, mesmo que sua posição relativa (ex.: o que era inciso II passe a ser, semanticamente, o III) seja afetada pela inserção de um novo dispositivo. O Lex Editor não renumera IDs já publicados.
   - Um dispositivo genuinamente novo, inserido entre dois existentes, recebe numeração de acordo com o texto oficial publicado (se a lei nova rotula o dispositivo inserido como "II-A", o ID usa `inc-ii-a`; numerais compostos em incisos seguem a mesma regra do art. 121-A, Seção 2.3, item 6).
   - Se a lei alteradora **explicitamente renumera** o texto oficial (ex.: "o § 1º passa a vigorar com a redação..." e "fica acrescido o § 2º, renumerando-se o antigo § 2º para § 3º"), o Lex Editor gera um novo dispositivo para o número reatribuído (`par-3` com o conteúdo do antigo § 2º) e marca o dispositivo antigo (`par-2` original) como `deviceStatus: 'renumbered'`, com `renumeradoPara: 'cp-art-X-par-3'` apontando para o novo ID. O ID antigo nunca é excluído nem reaproveitado — ele se torna um redirecionamento lógico permanente, registrado na NormaAST, no registro de aliases e no Markdown.
   - Essa regra prioriza estabilidade de links existentes sobre "correção" da numeração legislativa formal; a versão (`versao_vinculex`) e o changelog do arquivo documentam a mudança estrutural para quem consulta o histórico.
4. **Correção de erro de geração** (bug do parser que gerou um ID incorretamente antes da primeira publicação) é a única situação em que um ID pode ser trocado livremente — porque nada foi publicado ainda. Após a primeira publicação concluída — promoção do SHA e troca transacional do ponteiro público — o ID é considerado congelado e qualquer correção segue a regra de deprecação (Seção 6).

---

## 6. Deprecação de um Block ID publicado

Quando, por exceção, um ID publicado precisa ser corrigido (bug crítico, colisão descoberta tardiamente):

1. Gera-se o novo ID correto.
2. O ID antigo é adicionado à lista `ids_depreciados` nos metadados do documento, com um mapeamento `id_antigo -> id_novo`.
3. O mesmo mapeamento é persistido no registro de aliases/redirecionamentos,
   com referência à versão e ao motivo da correção.
4. O alias é permanente. O SaaS e qualquer consumidor oficial tentam resolver
   primeiro o ID canônico atual e, se ele não existir na versão consultada,
   seguem o redirecionamento. Aliases encadeados devem ser achatados para o
   destino canônico e ciclos são erro bloqueante.
5. O ID antigo continua reservado para sempre e nunca pode ser atribuído a
   outro dispositivo.
6. Esse mecanismo é excepcional e deve ser raro — o objetivo do pipeline de
   validação (Seção 7) é eliminar a necessidade de deprecação.

---

## 7. Detecção e resolução de colisão de IDs

### 7.1 Validação de unicidade

Antes de o Formatter escrever o arquivo final, o reconciliador/gerador de IDs
executa uma passada de validação sobre toda a NormaAST da norma:

1. Carrega todos os IDs e aliases já registrados para a lei, quando ela já
   tiver sido publicada.
2. Reconcilia cada dispositivo candidato com a última NormaAST publicada.
   Correspondências confirmadas reutilizam o ID existente.
3. Gera candidatos apenas para dispositivos ainda sem identidade publicada,
   usando a posição jurídica e as regras da Seção 2.
4. Valida a unicidade entre a árvore candidata, o namespace histórico
   reservado e os aliases.
5. Se não existir qualificação estrutural semântica capaz de resolver uma
   colisão, o processo aborta a publicação e reporta os nós conflitantes
   (caminho na árvore e posição na fonte original) para decisão humana.

### 7.2 Causas conhecidas de colisão e resolução

| Causa | Resolução |
|---|---|
| Numeração de artigo reiniciada por capítulo/anexo na primeira publicação | Inserir divisão intermediária mínima suficiente (Seção 2.4) em todos os dispositivos novos conflitantes |
| Novo dispositivo colide com ID já publicado | Preservar o ID publicado e qualificar somente o novo dispositivo com a menor divisão suficiente |
| Alíneas além de "z" (`aa`, `bb`, ...) | Suportado nativamente pela gramática (`letra-aditiva` aceita sequência de letras); o parser deve reconhecer o padrão de dupla letra do texto oficial e mapear 1:1, nunca inventar a sequência |
| Dois artigos com o mesmo número em diplomas diferentes anexados ao mesmo arquivo (ex.: lei + anexo regulamentar no mesmo Markdown) | Cada diploma deve ter sigla própria; não é permitido publicar duas normas distintas em um único arquivo Markdown compartilhando namespace de sigla |
| Erro de OCR/parsing que interpreta um número de artigo incorretamente (ex.: "12l" lido como "121") | Falha de validação estrutural anterior à geração de ID (contagem de artigos não bate com `total_artigos` esperado); deve ser corrigida no parser, não no gerador de ID |

### 7.3 Política de falha

A atribuição de Block IDs é uma etapa **bloqueante**: nenhum arquivo Markdown
com colisão de ID é considerado válido para publicação (ver critério de
validação em `MARKDOWN_SPEC.md`, Seção 9). Não há resolução silenciosa por
contador ou ordem de processamento (ex.: sufixar `-2`). A resolução automática
permitida é somente a qualificação estrutural definida nesta especificação,
aplicada a todos os conflitantes quando todos são inéditos ou apenas ao novo
dispositivo quando o outro ID já integra o namespace histórico.

---

## 8. Algoritmo de geração

### 8.1 Modelo de dados assumido (NormaAST, simplificado)

```typescript
type NormaNodeType =
  | "livro" | "titulo" | "capitulo" | "secao" | "subsecao"
  | "artigo" | "paragrafo" | "inciso" | "alinea" | "item" | "pena"
  | "anexo" | "tabela";

type DeviceStatus =
  | "active" | "revoked" | "vetoed" | "included"
  | "amended" | "renumbered" | "suspended" | "unknown";

interface NormaASTNode {
  type: NormaNodeType;
  /** Número/identificador bruto extraído do texto oficial, ex.: "121", "121-A", "2", "único", "viii", "b", "1" */
  numeroBruto: string;
  texto: string;
  /** Ausente antes da atribuição/reconciliação; sempre armazenado sem "^". */
  blockId?: string;
  /** Estado individual do dispositivo — ver ADR-005-status-fields.md */
  deviceStatus: DeviceStatus;
  children: NormaASTNode[];
}

interface NormaMeta {
  sigla: string; // já resolvida via tabela oficial ou regra genérica
}
```

### 8.2 Pseudocódigo / TypeScript

```typescript
/**
 * Gera o Block ID canônico de um nó da NormaAST.
 * `ancestors` é a cadeia de nós desde a raiz da norma até o pai direto de `node`
 * (não inclui `node`), na ordem raiz -> ... -> pai.
 */
function generateBlockId(
  node: NormaASTNode,
  ancestors: NormaASTNode[],
  meta: NormaMeta,
  divisoesNecessarias: Set<NormaASTNode> // calculado previamente pela passada de desambiguação (8.3)
): string {
  const segments: string[] = [meta.sigla];

  // 1. Divisões intermediárias, apenas as marcadas como necessárias para desambiguação
  for (const ancestor of ancestors) {
    if (isDivisaoEstrutural(ancestor) && divisoesNecessarias.has(ancestor)) {
      segments.push(divisaoAbrev(ancestor.type)); // "liv" | "tit" | "cap" | "sec" | "sub"
      segments.push(normalizarNumeroDivisao(ancestor.numeroBruto));
    }
  }

  // 2. Cadeia referenciável (inclui anexo/tabela e dispositivos textuais)
  const cadeia = [...ancestors.filter(isDispositivo), node];

  for (const n of cadeia) {
    switch (n.type) {
      case "anexo":
        segments.push("anx", normalizarNumeroAnexo(n.numeroBruto));
        break;
      case "tabela":
        segments.push("tab", normalizarCardinal(n.numeroBruto));
        break;
      case "artigo":
        segments.push("art", normalizarNumeroArtigo(n.numeroBruto));
        break;
      case "paragrafo":
        segments.push("par", normalizarParagrafo(n.numeroBruto)); // "unico" ou cardinal
        break;
      case "inciso":
        segments.push("inc", normalizarNumeroInciso(n.numeroBruto)); // "viii" ou "ii-a"
        break;
      case "alinea":
        segments.push("ali", normalizarLetra(n.numeroBruto)); // minúsculo, ex. "b" ou "aa"
        break;
      case "item":
        segments.push("item", normalizarCardinal(n.numeroBruto));
        break;
      case "pena":
        segments.push("pena");
        if (n.numeroBruto.trim()) {
          segments.push(normalizarCardinal(n.numeroBruto));
        }
        break;
    }
  }

  return segments.join("-");
}

function isDivisaoEstrutural(n: NormaASTNode): boolean {
  return ["livro", "titulo", "capitulo", "secao", "subsecao"].includes(n.type);
}

function isDispositivo(n: NormaASTNode): boolean {
  return [
    "artigo", "paragrafo", "inciso", "alinea", "item", "pena",
    "anexo", "tabela"
  ].includes(n.type);
}

function divisaoAbrev(type: NormaNodeType): string {
  return { livro: "liv", titulo: "tit", capitulo: "cap", secao: "sec", subsecao: "sub" }[type]!;
}

function normalizarNumeroArtigo(bruto: string): string {
  // "121-A" -> "121-a" ; "121" -> "121"
  return bruto.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizarParagrafo(bruto: string): string {
  const b = bruto.trim().toLowerCase();
  if (b === "único" || b === "unico") return "unico";
  return b.replace(/[^\d]/g, ""); // remove "º", "§" etc., mantém dígitos
}

function normalizarRomano(bruto: string): string {
  const value = bruto.trim().toLowerCase();
  if (!romanoValido(value)) throw new Error(`Numeral romano inválido: ${bruto}`);
  return value;
}

function normalizarNumeroInciso(bruto: string): string {
  const match = bruto.trim().toLowerCase().match(/^([ivxlcdm]+)(?:-([a-z]+))?$/);
  if (!match || !romanoValido(match[1])) {
    throw new Error(`Número de inciso inválido: ${bruto}`);
  }
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

function normalizarNumeroDivisao(bruto: string): string {
  const designador = extrairDesignadorDaDivisao(bruto); // "III" em "Capítulo III"
  if (/^\d+$/.test(designador)) return String(Number(designador));
  const romano = normalizarRomano(designador);
  return String(romanoParaInteiro(romano)); // "III" -> "3"
}

function normalizarLetra(bruto: string): string {
  return bruto.trim().toLowerCase().replace(/[^a-z]/g, "");
}

function normalizarCardinal(bruto: string): string {
  return bruto.trim().replace(/[^\d]/g, "");
}

function normalizarNumeroAnexo(bruto: string): string {
  const value = bruto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/^anexo\s+/, "");
  if (/^\d+$/.test(value)) return String(Number(value));
  if (/^[ivxlcdm]+$/.test(value) && romanoValido(value)) return value;
  if (/^[a-z]+$/.test(value)) return value;
  throw new Error(`Número de anexo inválido: ${bruto}`);
}
```

### 8.3 Passada de desambiguação (`divisoesNecessarias`)

Executada uma vez por norma, antes da geração final de IDs:

```typescript
function calcularDivisoesNecessarias(root: NormaASTNode): Set<NormaASTNode> {
  const nodesPorCandidatoBase = new Map<string, NormaASTNode[]>();

  visitarDispositivos(root, (node, path) => {
    const chave = gerarCandidatoSemDivisoes(node, path);
    const lista = nodesPorCandidatoBase.get(chave) ?? [];
    lista.push(node);
    nodesPorCandidatoBase.set(chave, lista);
  });

  const necessarias = new Set<NormaASTNode>();

  for (const [, nodes] of nodesPorCandidatoBase) {
    if (nodes.length > 1) {
      // Colisão: encontra, para cada par, a menor divisão ancestral que os diferencia
      // e marca essas divisões ancestrais (de cada um dos nós envolvidos) como necessárias.
      marcarMenorDivisaoDiferenciadora(nodes, necessarias);
    }
  }

  return necessarias;
}
```

`gerarCandidatoSemDivisoes` aplica as mesmas regras de segmentos da Seção
8.2, mas omite apenas `liv/tit/cap/sec/sub`. Assim, a detecção cobre colisões
de artigos e também de anexos, tabelas e descendentes referenciáveis.

Esse algoritmo calcula candidatos para uma **primeira publicação**. Ele garante
a propriedade central da Seção 2.4: divisões intermediárias só aparecem quando
necessárias e são aplicadas consistentemente quando todos os conflitantes são
inéditos.

Em uma atualização, ele é usado dentro de uma reconciliação stateful:

```typescript
function reconciliarBlockIds(
  candidata: NormaASTNode,
  publicada: NormaASTNode,
  idsReservados: Set<string>,
  aliases: Map<string, string>
): NormaASTNode {
  validarAliasesSemCiclo(aliases);
  const correspondencias = reconciliarIdentidadeJuridica(publicada, candidata);

  for (const node of visitarDispositivos(candidata)) {
    const publicado = correspondencias.get(node);
    if (publicado) {
      node.blockId = publicado.blockId;
      continue;
    }

    node.blockId = gerarMenorCandidatoEstruturalLivre(
      node,
      idsReservados
    );
    idsReservados.add(node.blockId);
  }

  validarUnicidadeContraRegistro(candidata, idsReservados, aliases);
  return candidata;
}
```

`reconciliarIdentidadeJuridica` não pode decidir silenciosamente casos
ambíguos de renumeração, desmembramento ou reaproveitamento de posição. Esses
casos exigem confirmação editorial antes da publicação, e a decisão resultante
é persistida no registro versionado.

### 8.4 Validação pós-geração

Após atribuir ou reconciliar todos os IDs, o pipeline executa a validação de
unicidade descrita na Seção 7.1 antes de entregar a árvore ao Formatter. A
validação considera IDs canônicos sem `^`; o Formatter valida separadamente as
âncoras Markdown materializadas.

---

## 9. Casos especiais e ambiguidades conhecidas

1. **Numerais romanos em incisos altos.** Incisos podem chegar a números romanos longos (ex.: art. 5º da CF/88 tem incisos até LXXVIII). A normalização deve suportar qualquer numeral romano válido, sem limite artificial de magnitude, e deve validar que o numeral romano é bem formado (rejeitar romanos inválidos como sinal de erro de OCR/parsing).
2. **Alíneas com letras duplas ("aa", "bb").** Ocorrem em incisos com mais de 26 alíneas (raro, mas presente em leis extensas como a 14.133/2021 e o CTB). O parser deve extrair a letra exatamente como grafada no texto oficial (não inferir a sequência alfabética), porque a lei pode pular ou repetir letras em emendas.
3. **Artigos revogados que preservam numeração.** Quando um artigo inteiro é revogado (ex.: "Art. 224. (Revogado pela Lei nº 12.015, de 2009)"), o nó permanece na NormaAST com `deviceStatus: "revoked"` e o Block ID é preservado normalmente (`cp-art-224`, renderizado como `^cp-art-224` no Markdown), pois a posição estrutural continua existindo e pode ser referenciada por outros dispositivos ou por material de estudo que discute a revogação.
4. **Artigos "fantasmas" (número pulado na numeração original).** Algumas leis pulam um número de artigo por erro de redação original (não por revogação). O gerador trata isso como uma lacuna normal na sequência — não gera um nó para um artigo que nunca existiu, e não tenta "preencher" a lacuna.
5. **Parágrafo único seguido posteriormente de mais parágrafos (transição relatada na Seção 5, item 3).** Ver regra de renumeração — o parágrafo único original vira `par-1` apenas se a lei alteradora explicitamente o renumerar; caso contrário, mantém-se `par-unico` mesmo coexistindo com novos parágrafos (situação rara e juridicamente inconsistente, mas o Lex Editor reflete o texto oficial tal como publicado, sinalizando a inconsistência para revisão humana em vez de a "corrigir" silenciosamente).
6. **Incisos com numeração composta ("II-A")**, análogos ao art. 121-A: tratados como unidade atômica `inc-ii-a`, seguindo a mesma lógica de extensão por letra descrita na Seção 2.3, item 6, aplicada ao segmento de inciso.
7. **Convenção de ano na sigla de constituições e emendas.** `cf1988` inclui o ano para deixar explícito o marco histórico de referência (distinguindo de eventuais referências a constituições anteriores em conteúdo de história do direito); emendas constitucionais usam a forma genérica `ec-{numero}-{ano}` e não alteram a sigla `cf1988` dos dispositivos que emendam — a alteração de texto por emenda é tratada via `redacao_dada_por`, não via mudança de sigla ou ID.
