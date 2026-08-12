# Especificação do Formato Markdown/Obsidian — Vinculex / Lex Editor

Versão: 1.3
Status: Normativo (fonte de verdade para o Formatter e para qualquer ferramenta que consuma os arquivos `.md` gerados pelo Lex Editor)
Depende de: `BLOCK_ID_SPEC.md` (todo Block ID citado aqui segue aquela gramática)

## Sumário

- [1. Visão geral e princípios](#1-visão-geral-e-princípios)
- [2. Schema do frontmatter](#2-schema-do-frontmatter)
- [3. Estrutura de lista indentada](#3-estrutura-de-lista-indentada)
- [4. Sintaxe de Block ID inline](#4-sintaxe-de-block-id-inline)
- [5. Sinalização de dispositivos revogados e vetados](#5-sinalização-de-dispositivos-revogados-e-vetados)
- [6. Callouts institucionais permitidos](#6-callouts-institucionais-permitidos)
- [7. Regras de geração de headings para divisões](#7-regras-de-geração-de-headings-para-divisões)
- [8. Exemplo completo e realista de arquivo `.md`](#8-exemplo-completo-e-realista-de-arquivo-md)
- [9. Validação do Markdown gerado](#9-validação-do-markdown-gerado)

---

## 1. Visão geral e princípios

O Formatter converte uma NormaAST validada em um arquivo Markdown único por norma, otimizado para uso no Obsidian e para consumo posterior pelo Vinculex SaaS. Três princípios orientam todas as decisões de formato:

1. **Lista indentada como estrutura principal do corpo da norma.** Artigos, parágrafos, incisos, alíneas e itens são representados como itens de lista aninhados (`-`), não como blocos de texto soltos nem como callouts individuais. A hierarquia legal é uma árvore; a lista indentada do Markdown/Obsidian é a representação nativa mais próxima dessa árvore, permite recolher/expandir dispositivos no editor, e mantém o Block ID visualmente ancorado à linha exata que ele identifica.
2. **Callouts restritos ao cabeçalho do arquivo.** Callouts (`> [!tipo]`) comunicam metainformação sobre o documento como um todo (fonte oficial, data de atualização, avisos de segurança jurídica, notas editoriais gerais). Usar um callout por artigo quebraria a leitura sequencial de uma lei inteira (dezenas ou centenas de blocos de destaque empilhados) e é explicitamente proibido por esta especificação.
3. **Frontmatter é a interface de metadados do arquivo, não o texto legal é a interface de dados.** Os metadados estruturados necessários para compreender e validar o arquivo publicado (título, sigla, `legal_status`, datas) vivem no frontmatter YAML. O corpo é otimizado para leitura humana e para o modelo de block reference do Obsidian, não para parsing programático linha a linha. Em runtime, o SaaS consome projeções públicas do banco derivadas da mesma NormaAST; o Markdown é uma materialização publicada, não sua API de consulta.

---

## 2. Schema do frontmatter

O frontmatter é um bloco YAML delimitado por `---` no início do arquivo. Todos os 13 campos mínimos são obrigatórios em todo arquivo `.md` de lei.

### 2.1 Campos obrigatórios

| Campo | Tipo | Obrigatório | Exemplo | Descrição |
|---|---|---|---|---|
| `title` | string | sim | `"Código Penal"` | Nome oficial de uso corrente da norma |
| `sigla` | string | sim | `"cp"` | Sigla canônica usada nos Block IDs (ver `BLOCK_ID_SPEC.md`, Seção 3) |
| `tipo` | string (enum) | sim | `"decreto-lei"` | Um de: `lei ordinária`, `lei complementar`, `decreto-lei`, `decreto`, `medida provisória`, `emenda constitucional`, `código`, `constituição` |
| `numero` | string | sim | `"2.848"` | Número oficial da norma (string para preservar formatação, ex. `"14.133"`) |
| `ano` | integer | sim | `1940` | Ano de publicação original |
| `ramo` | string (enum) | sim | `"penal"` | Um de: `penal`, `processual penal`, `processual penal militar`, `constitucional`, `administrativo`, `civil`, `trânsito`, `infância e juventude`, ou outro ramo do direito relevante ao escopo do projeto |
| `fonte` | string (URL) | sim | `"https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm"` | URL oficial da fonte usada na importação |
| `data_publicacao` | date (`YYYY-MM-DD`) | sim | `1940-12-07` | Data de publicação original da norma |
| `data_atualizacao_legal` | date (`YYYY-MM-DD`) | sim | `2023-11-27` | Data da última alteração legislativa conhecida incorporada ao texto |
| `data_formatacao_vinculex` | date (`YYYY-MM-DD`) | sim | `2026-07-01` | Data em que o Lex Editor processou/gerou esta versão do arquivo |
| `total_artigos` | integer | sim | `361` | Contagem total de artigos reconhecidos pelo parser (usada como checksum estrutural na validação, Seção 9) |
| `versao_vinculex` | string (SemVer) | sim | `"1.3.0"` | Sem prefixo `v`: `1.0.0` na primeira publicação; MAJOR para mudança incompatível do contrato de representação, MINOR para mudança normativa e PATCH para correção não normativa |
| `legal_status` | string (enum) | sim | `"vigente"` | Vigência jurídica da lei perante o ordenamento. Um de: `vigente`, `revogada`, `alterada`, `suspensa`, `sem_eficacia`, `desconhecida` (ver `./ADR-005-status-fields.md`) |

> Nota: `legal_status` é o único dos três campos de status (ver `./ADR-005-status-fields.md`) que vive no frontmatter da lei. `publication_status` (fluxo editorial do Vinculex) é um campo de banco de dados, não do Markdown; `deviceStatus` (projetado como `device_status` no banco) é atributo da NormaAST e se manifesta como marcação inline no corpo do arquivo (Seção 5), não como campo de frontmatter.

### 2.2 Campos opcionais recomendados

| Campo | Tipo | Obrigatório | Exemplo | Descrição |
|---|---|---|---|---|
| `projection_profile` | string (enum) | na projeção derivada | `"current_only"` | Identifica a saída derivada contendo somente dispositivos vigentes. A publicação canônica `complete_with_history` omite o campo para preservar compatibilidade byte a byte; sua ausência significa o perfil canônico completo (ADR-012). |
| `aliases` | list\<string\> | não | `["NLLC", "Lei 14.133/2021"]` | Nomes alternativos sem colisão obtidos do catálogo da revisão exportada; auxiliam descoberta no Obsidian, mas não substituem a identidade jurídica (ADR-013). |
| `tags` | list\<string\> | não | `["penal", "cfo-pmmg", "concurso"]` | Tags Obsidian para navegação por grafo e filtros de estudo |
| `revogada_por` | string \| null | não | `null` | Sigla/identificação da norma revogadora, se `legal_status` for `revogada` |
| `redacao_dada_por` | list\<object\> | não | ver exemplo abaixo | Histórico de leis que alteraram a redação de dispositivos específicos desta norma |
| `ids_depreciados` | list\<object\> | não | `[{ antigo: "cp-art-121-par-2-inc-9", novo: "cp-art-121-par-2-inc-ix" }]` | Mapeamento permanente de Block IDs corrigidos após publicação, sempre sem `^` (ver `BLOCK_ID_SPEC.md`, Seção 6) |
| `fonte_secundaria` | list\<string\> | não | `["https://www.jusbrasil.com.br/..."]` | Fontes de checagem cruzada usadas na revisão editorial |

Exemplo de `redacao_dada_por`:

```yaml
redacao_dada_por:
  - block_id: "cp-art-121-par-2-inc-vi"
    lei: "Lei nº 13.104/2015"
    data: 2015-03-09
    descricao: "Inclusão da qualificadora de feminicídio"
```

### 2.3 Exemplo completo de frontmatter

```yaml
---
title: "Código Penal"
sigla: "cp"
tipo: "decreto-lei"
numero: "2.848"
ano: 1940
ramo: "penal"
fonte: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm"
data_publicacao: 1940-12-07
data_atualizacao_legal: 2023-11-27
data_formatacao_vinculex: 2026-07-01
total_artigos: 361
versao_vinculex: "1.3.0"
legal_status: "vigente"
aliases: ["CP", "Código Penal Brasileiro", "Decreto-Lei 2.848/1940"]
tags: ["penal", "cfo-pmmg", "concurso", "codigo"]
revogada_por: null
redacao_dada_por:
  - block_id: "cp-art-121-par-2-inc-vi"
    lei: "Lei nº 13.104/2015"
    data: 2015-03-09
    descricao: "Inclusão da qualificadora de feminicídio"
---
```

### 2.4 Serialização canônica determinística

O Formatter deve produzir uma única representação para os mesmos dados da
NormaAST:

1. os 13 campos obrigatórios aparecem primeiro e na ordem da Seção 2.1;
2. campos opcionais presentes aparecem depois, na ordem da Seção 2.2;
   `projection_profile`, quando exigido, é o primeiro deles;
3. strings, incluindo URLs, enums, número da norma e semver, usam aspas duplas
   e escaping compatível com JSON; inteiros e datas `YYYY-MM-DD` usam forma
   escalar sem aspas;
4. cada chave ocupa uma linha no formato `chave: valor`; coleções seguem a
   forma exibida nos exemplos desta especificação;
5. `---` abre e fecha o frontmatter em linhas próprias;
6. não existem tabs ou espaços ao final das linhas;
7. o documento inteiro usa LF e termina com exatamente uma newline;
8. existe exatamente uma linha vazia entre o frontmatter, cada callout de
   cabeçalho e o primeiro heading ou artigo.

Essas regras são normativas para geração e golden tests. Parsers podem aceitar
YAML semanticamente equivalente somente quando o fluxo não exigir round-trip
byte a byte; um fluxo canônico estrito deve rejeitar outra representação.

---

## 3. Estrutura de lista indentada

### 3.1 Heading vs. item de lista — regra exata

| Nível hierárquico (NormaAST) | Representação Markdown |
|---|---|
| Ato das Disposições Constitucionais Transitórias | `#` (heading nível 1) |
| Livro | `#` (heading nível 1) |
| Título | `##` (heading nível 2) |
| Capítulo | `###` (heading nível 3) |
| Seção | `#### ` (heading nível 4) |
| Subseção | `#####` (heading nível 5) |
| Artigo | item de lista, nível de indentação 0 (`- `) |
| Parágrafo | item de lista, um nível abaixo do pai (tipicamente 2 espaços) |
| Inciso | item de lista, um nível abaixo do pai (tipicamente 4 espaços) |
| Alínea | item de lista, um nível abaixo do pai (tipicamente 6 espaços) |
| Item | item de lista, um nível abaixo do pai (tipicamente 8 espaços) |
| Pena autônoma | item de lista um nível abaixo do dispositivo ao qual pertence |
| Anexo suportado | `## Anexo {numero} - {titulo} {blockId}` |
| Tabela simples suportada | item de lista, nível de indentação 0 (`- Tabela ... {blockId}`) |

**Regra exata:** ADCT, livro, título, capítulo, seção e subseção viram headings.
Anexo usa o heading específico da Seção 3.3. Artigo, parágrafo, inciso,
alínea, item, pena e tabela viram itens de lista referenciáveis, respeitando a
relação pai-filho da `IdentifiedNormaAST`. A lista reinicia no nível 0 a cada
artigo; cada descendente e cada pena ficam exatamente um nível abaixo do pai
real. Quando a fonte omite um nível jurídico intermediário — por exemplo,
alínea diretamente sob artigo — a serialização não cria recuo vazio: a alínea
fica no nível 1 (2 espaços).

Cada nível de indentação usa **2 espaços** (não tab), consistente com o padrão de renderização de listas do Obsidian.

### 3.2 Exemplo de indentação

```markdown
### Capítulo I - Dos Crimes contra a Vida

- Art. 121. Matar alguém. ^cp-art-121
  - § 1º Se o agente comete o crime impelido por motivo de relevante valor social ou moral, ou sob o domínio de violenta emoção, logo em seguida a injusta provocação da vítima: pena reduzida de um sexto a um terço. ^cp-art-121-par-1
  - § 2º Se o homicídio é cometido: ^cp-art-121-par-2
    - I - mediante paga ou promessa de recompensa, ou por outro motivo torpe; ^cp-art-121-par-2-inc-i
    - II - por motivo fútil; ^cp-art-121-par-2-inc-ii
```

Note que o texto do parágrafo/inciso/alínea/item que introduz uma subdivisão (ex.: "§ 2º Se o homicídio é cometido:") ainda recebe seu próprio Block ID, mesmo sendo apenas uma frase de transição — ele é um dispositivo legal autônomo e pode ser referenciado isoladamente.

### 3.3 Anexos e tabelas simples suportados

Anexos extraídos de fontes oficiais permitidas podem ser materializados como
heading de nível 2 quando possuem identidade pública mínima e posição
determinística:

```markdown
## Anexo I - Tabela Oficial ^lda-anx-i
```

Tabelas simples suportadas são representadas como bloco jurídico referenciável
em uma única linha canônica:

```markdown
- Tabela 1. Demonstrativo oficial | Código; Descrição | A; Ativo / B; Suspenso ^lda-anx-i-tab-1
```

Regras:

1. O Block ID do anexo usa o segmento `anx-{numero}`.
   Quando a fonte possui um único `ANEXO` sem numeral, o rótulo é
   `Anexo único` e o segmento canônico é `anx-unico`; não se inventa `I`.
2. O Block ID da tabela usa o segmento `tab-{numero}` e referencia a tabela
   inteira.
3. Cabeçalhos são separados por `; `; linhas são separadas por ` / `; células
   de uma linha são separadas por `; `.
4. Linhas e células individuais não recebem Block IDs nesta versão.
5. Tabelas sem cabeçalho, com linhas irregulares, células mescladas,
   cabeçalhos multinível, nested tables, imagens, fórmulas ou notas ambíguas
   devem falhar antes da serialização.

---

## 4. Sintaxe de Block ID inline

O valor recebido da NormaAST e persistido no banco não contém `^`
(`cp-art-121`). O prefixo é responsabilidade exclusiva desta serialização:

1. O Block ID aparece **ao final da linha do dispositivo**, sempre no formato `^{id}` (sem chaves, sem link, é a sintaxe nativa do Obsidian).
2. Exatamente **um espaço** separa o fim do texto (incluindo pontuação final) do `^{id}`. Nunca use múltiplos espaços, nunca omita o espaço.
3. O Block ID é o **último token da linha** — nada pode vir depois dele na mesma linha.
4. Quando o texto de um dispositivo se estende por múltiplas linhas visuais (linha longa sem quebra de parágrafo Markdown), o Block ID ainda é único e vai ao final de todo o bloco de texto daquele dispositivo, não ao final de cada linha física.
5. O Block ID nunca é duplicado em outro lugar do arquivo para o mesmo dispositivo. Referências cruzadas a esse dispositivo a partir de outros pontos do Vinculex usam link (`[[cp#^cp-art-121]]`), nunca republicam a âncora.

```markdown
- Art. 33. A pena de reclusão deve ser executada em forma progressiva, com a transferência para regime menos rigoroso, a ser determinada pelo juiz, quando o preso tiver cumprido ao menos: ^cp-art-33
```

### 4.1 Wikilinks jurídicos derivados

O Formatter recebe a NormaAST e um `LegalReferenceIndex` da mesma revisão. Os
links são decoração derivada: não entram na NormaAST, não alteram o hash
jurídico e são aplicados somente ao trecho literal conferido pelo span UTF-16.

- alvo na mesma nota: `[[#^nllc-art-1-par-3|§ 3º]]`;
- alvo em outra norma do pacote:
  `[[VincuLex/constituicao-federal/cf88#^cf1988-art-37|caput do art. 37]]`;
- a extensão `.md` e paths locais nunca são emitidos;
- o label é exatamente o trecho literal da lei;
- `unresolved` e `ambiguous` permanecem texto literal;
- um alvo `resolved` cuja revisão, nota ou âncora não exista no layout bloqueia
  a materialização, em vez de produzir link quebrado;
- embeds `![[...]]` não são gerados.

Os spans de cada campo são validados antes da decoração e aplicados da direita
para a esquerda. O Formatter rejeita sobreposição, trecho divergente e label
com sintaxe insegura para wikilink. A projeção `current_only` omite referências
cuja origem foi removida e só materializa alvos presentes no pacote vigente;
`complete_with_history` também analisa dispositivos históricos preservados,
sem atribuir link ou Block ID às linhas editoriais de redação anterior.

---

## 5. Sinalização de dispositivos revogados e vetados

### 5.1 Sintaxe

Dispositivos com `deviceStatus: 'revoked'` ou `deviceStatus: 'vetoed'` na NormaAST (ver `./ADR-005-status-fields.md`) são renderizados conforme a informação disponível:

1. quando a fonte oficial fornece somente um texto residual de revogação
   (ex.: `(Revogado pela Lei nº 12.015, de 2009)`), esse texto é reproduzido
   literalmente, sem itálico acrescentado e sem `~~`;
2. quando o texto anterior é preservado editorialmente, ele é riscado com
   `~~texto~~` e seguido pela `notaStatus` em itálico;
3. quando o dispositivo foi vetado, a `notaStatus` padronizada é emitida em
   itálico;
4. o Block ID é **sempre preservado** ao final da linha, sem alteração,
   seguindo `BLOCK_ID_SPEC.md` Seção 5.

Formato da nota de status gerada quando não existe texto residual oficial
literal:

```
*(Revogado pela Lei nº {numero}/{ano})*
*(Vetado)*
*(Vetado — mantida a numeração do projeto de lei original)*
```

### 5.2 Exemplos

Dispositivo revogado, com texto oficial de revogação disponível na fonte:

```markdown
- Art. 224. (Revogado pela Lei nº 12.015, de 2009) ^cp-art-224
```

Dispositivo revogado, com texto anterior preservado para contexto histórico (riscado) e prefixo indicando a norma revogadora — usado quando o Formatter opta por manter o texto pré-revogação como referência editorial:

```markdown
- ~~§ 3º Se o crime é praticado por meio de veículo automotor.~~ *(Revogado pela Lei nº 13.281/2016)* ^ctb-art-165-par-3
```

Dispositivo vetado (nunca vigorou):

```markdown
- § 4º *(Vetado)* ^nllc-art-178-par-4
```

### 5.3 Regra de decisão

O Formatter usa o texto riscado (`~~...~~`) somente quando
`preservarTextoRevogado` for `true`. Quando o campo for `false`, reproduz o
texto residual oficial armazenado no dispositivo sem acrescentar itálico. A
decisão é registrada explicitamente na NormaAST, nunca inferida pelo Formatter
a partir do texto ou da fonte.

### 5.4 Parsing inverso da representação canônica

Ao reimportar Markdown canônico:

- texto riscado seguido de nota de revogação produz
  `deviceStatus: 'revoked'`, `preservarTextoRevogado: true` e `notaStatus`
  igual ao conteúdo da nota sem os delimitadores de itálico;
- texto residual oficial de revogação sem `~~` produz
  `deviceStatus: 'revoked'`, `preservarTextoRevogado: false` e `notaStatus`
  igual ao próprio texto residual;
- marcação padronizada de veto produz `deviceStatus: 'vetoed'`;
- marcação incompleta ou combinação diferente dessas formas é inválida e não
  pode ser corrigida por inferência jurídica.

### 5.5 Histórico de redações de um dispositivo alterado (ver ADR-006)

Quando um dispositivo vigente teve redações anteriores (alteração por
`(Redação dada pela Lei/MP ...)`), cada redação anterior é materializada como
uma linha riscada, na mesma indentação do dispositivo, **imediatamente acima**
da linha vigente, na ordem da mais antiga para a mais nova. Essas linhas de
histórico **não** recebem Block ID — apenas a redação vigente o recebe.

```markdown
- ~~h) contra criança, velho, enfermo ou mulher grávida.~~ *(Redação dada pela Lei nº 9.318, de 1996)*
- h) contra criança, maior de 60 (sessenta) anos, enfermo ou mulher grávida; ^cp-art-61-inc-ii-ali-h
```

Regra de decisão pela nota em itálico:

- `*(Redação dada pela Lei nº X, de Y)*` numa linha riscada **sem Block ID** →
  redação anterior do dispositivo vigente que a segue (`deviceStatus` do nó
  permanece o da redação vigente; a linha entra em `redacoesAnteriores`);
- `*(Revogado pela Lei nº X, de Y)*` numa linha riscada **com Block ID** →
  dispositivo revogado (`deviceStatus: 'revoked'`, Seção 5.1–5.4).

O parsing inverso acumula as linhas de histórico (riscadas, sem Block ID) e as
anexa como `redacoesAnteriores` (par `{ texto, nota? }`) ao próximo dispositivo
com Block ID.

Quando a fonte não trouxer nota, a linha histórica termina logo após o trecho
riscado; o Formatter não inventa texto em itálico (ADR-011).

---

## 6. Callouts institucionais permitidos

Callouts aparecem exclusivamente na região de cabeçalho do arquivo, entre o frontmatter e o primeiro heading/artigo do corpo. Os tipos permitidos e sua sintaxe Obsidian exata:

### 6.1 `[!info]` — Fonte oficial

```markdown
> [!info] Fonte Oficial
> Texto compilado a partir do Portal da Legislação do Planalto. Última verificação de integridade em 2026-07-01.
```

### 6.2 `[!warning]` — Atualização legislativa

```markdown
> [!warning] Atualização
> Este código foi parcialmente alterado após a data de formatação deste arquivo. Consulte a fonte oficial para eventuais alterações supervenientes não incorporadas.
```

### 6.3 `[!caution]` — Segurança jurídica

```markdown
> [!caution] Aviso de Segurança Jurídica
> Este material é destinado a fins de estudo. O texto pode ter sofrido alterações após a publicação desta versão. Não deve ser utilizado como fonte para peticionamento ou decisão jurídica sem confirmação na fonte oficial.
```

### 6.4 `[!note]` — Nota editorial geral

```markdown
> [!note] Nota Editorial
> A numeração de incisos deste código segue a redação vigente após a Lei nº 13.104/2015. Dispositivos revogados foram mantidos com marcação visual para referência histórica.
```

### 6.5 Regra de uso

- Todo arquivo `.md` de lei deve conter, no mínimo, os callouts `[!info]` (fonte) e `[!caution]` (segurança jurídica).
- `[!warning]` é obrigatório sempre que `legal_status` no frontmatter for diferente de `vigente`, ou quando `data_atualizacao_legal` for anterior a alterações legislativas conhecidas e ainda não incorporadas.
- `[!note]` é opcional, usado para observações editoriais que não se encaixam nos demais tipos.
- Callouts não são aninhados dentro de itens de lista de artigos em nenhuma circunstância.

---

## 7. Regras de geração de headings para divisões

1. Toda divisão estrutural (ADCT, livro, título, capítulo, seção, subseção) gera um heading Markdown no nível correspondente à Seção 3.1. O ADCT usa exatamente `# Ato das Disposições Constitucionais Transitórias` (ADR-011).
2. O texto do heading reproduz a numeração romana/ordinal e a ementa da divisão exatamente como no texto oficial: `### Capítulo I - Dos Crimes contra a Vida`.
3. **Divisões estruturais não recebem Block ID próprio por padrão.** A unidade referenciável mínima do sistema é o dispositivo legal (artigo e seus descendentes), não a divisão. Isso é consistente com `BLOCK_ID_SPEC.md`, que define IDs para `artigo`, `paragrafo`, `inciso`, `alinea`, `item`, `pena`, `anexo` e `tabela` — divisões intermediárias só aparecem *dentro* de um Block ID de dispositivo quando necessárias para desambiguação (ver `BLOCK_ID_SPEC.md`, Seção 2.4), nunca como Block ID de heading isolado.
4. Exceção: se o produto exigir link direto para uma divisão inteira (ex.: "ver Capítulo I"), o Formatter pode opcionalmente anexar um Block ID de divisão usando o mesmo padrão de abreviação da Seção 2.4 do `BLOCK_ID_SPEC.md` (`^cp-cap-1`), mas essa é uma extensão opcional e não obrigatória nesta versão da especificação, e não deve ser confundida com o Block ID de artigo.
5. Headings de divisão não usam numeração de Markdown automática (não usar `1.` como prefixo) — a numeração já está no texto do heading (`Capítulo I`), e duplicar numeração automática do Obsidian causaria redundância visual.

---

## 8. Exemplo completo e realista de arquivo `.md`

```markdown
---
title: "Código Penal"
sigla: "cp"
tipo: "decreto-lei"
numero: "2.848"
ano: 1940
ramo: "penal"
fonte: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm"
data_publicacao: 1940-12-07
data_atualizacao_legal: 2023-11-27
data_formatacao_vinculex: 2026-07-01
total_artigos: 361
versao_vinculex: "1.3.0"
legal_status: "vigente"
tags: ["penal", "cfo-pmmg", "concurso", "codigo"]
revogada_por: null
redacao_dada_por:
  - block_id: "cp-art-121-par-2-inc-vi"
    lei: "Lei nº 13.104/2015"
    data: 2015-03-09
    descricao: "Inclusão da qualificadora de feminicídio"
  - block_id: "cp-art-121-par-2-inc-vii"
    lei: "Lei nº 13.142/2015"
    data: 2015-06-06
    descricao: "Redação atual da qualificadora contra autoridade policial"
---

> [!info] Fonte Oficial
> Texto compilado a partir do Portal da Legislação do Planalto (Decreto-Lei nº 2.848, de 7 de dezembro de 1940). Última verificação de integridade em 2026-07-01.

> [!warning] Atualização
> Este código sofreu alterações legislativas incorporadas até 2023-11-27. Consulte a fonte oficial para eventuais alterações supervenientes não incorporadas nesta versão.

> [!caution] Aviso de Segurança Jurídica
> Este material é destinado a fins de estudo (preparação para concursos, incluindo CFO/PMMG). O texto pode ter sofrido alterações após a publicação desta versão. Não deve ser utilizado como fonte para peticionamento ou decisão jurídica sem confirmação na fonte oficial.

> [!note] Nota Editorial
> Dispositivos revogados foram mantidos com marcação visual (texto riscado) para referência histórica quando o texto pré-revogação estava disponível na fonte oficial.

## Parte Especial

### Título I - Dos Crimes contra a Pessoa

#### Capítulo I - Dos Crimes contra a Vida

- Art. 121. Matar alguém: ^cp-art-121
  - Pena - reclusão, de seis a vinte anos. ^cp-art-121-pena
  - § 1º Se o agente comete o crime impelido por motivo de relevante valor social ou moral, ou sob o domínio de violenta emoção, logo em seguida a injusta provocação da vítima, o juiz pode reduzir a pena de um sexto a um terço. ^cp-art-121-par-1
  - § 2º Se o homicídio é cometido: ^cp-art-121-par-2
    - I - mediante paga ou promessa de recompensa, ou por outro motivo torpe; ^cp-art-121-par-2-inc-i
    - II - por motivo fútil; ^cp-art-121-par-2-inc-ii
    - III - com emprego de veneno, fogo, explosivo, asfixia, tortura ou outro meio insidioso ou cruel, ou de que possa resultar perigo comum; ^cp-art-121-par-2-inc-iii
    - IV - à traição, de emboscada, ou mediante dissimulação ou outro recurso que dificulte ou torne impossível a defesa do ofendido; ^cp-art-121-par-2-inc-iv
    - V - para assegurar a execução, a ocultação, a impunidade ou vantagem de outro crime; ^cp-art-121-par-2-inc-v
    - VI - contra a mulher por razões da condição de sexo feminino; ^cp-art-121-par-2-inc-vi
    - VII - contra autoridade ou agente descrito nos arts. 142 e 144 da Constituição Federal, integrantes do sistema prisional e da Força Nacional de Segurança Pública, no exercício da função ou em decorrência dela, ou contra seu cônjuge, companheiro ou parente consanguíneo até terceiro grau, em razão dessa condição; ^cp-art-121-par-2-inc-vii
    - Pena - reclusão, de doze a trinta anos. ^cp-art-121-par-2-pena
  - § 3º Se o homicídio é culposo: ^cp-art-121-par-3
    - Pena - detenção, de um a três anos. ^cp-art-121-par-3-pena
  - § 4º No homicídio culposo, a pena é aumentada de um terço, se o crime resulta de inobservância de regra técnica de profissão, arte ou ofício, ou se o agente deixa de prestar imediato socorro à vítima, não procura diminuir as consequências do seu ato, ou foge para evitar prisão em flagrante. ^cp-art-121-par-4

- Art. 121-A. *(Dispositivo hipotético para fins de exemplo de numeração composta — não corresponde a texto oficial do Código Penal)* ^cp-art-121-a
  - Parágrafo único. Aplica-se o disposto neste artigo subsidiariamente ao art. 121. ^cp-art-121-a-par-unico

- Art. 122. Induzir ou instigar alguém a suicidar-se ou a praticar automutilação ou prestar-lhe auxílio material para que o faça: ^cp-art-122
  - Pena - reclusão, de seis meses a dois anos. ^cp-art-122-pena

- Art. 123. Matar, sob a influência do estado puerperal, o próprio filho, durante o parto ou logo após: ^cp-art-123
  - Pena - detenção, de dois a seis anos. ^cp-art-123-pena

#### Capítulo II - Da Lesão Corporal

- Art. 129. Ofender a integridade corporal ou a saúde de outrem: ^cp-art-129
  - Pena - detenção, de três meses a um ano. ^cp-art-129-pena
  - § 1º Se resulta: ^cp-art-129-par-1
    - I - incapacidade para as ocupações habituais, por mais de trinta dias; ^cp-art-129-par-1-inc-i
    - II - perigo de vida; ^cp-art-129-par-1-inc-ii
    - III - debilidade permanente de membro, sentido ou função; ^cp-art-129-par-1-inc-iii
    - IV - aceleração de parto: ^cp-art-129-par-1-inc-iv
    - Pena - reclusão, de um a cinco anos. ^cp-art-129-par-1-pena

- Art. 224. ~~Presume-se a violência, se a vítima:~~ *(Revogado pela Lei nº 12.015, de 2009)* ^cp-art-224
```

> Linhas de pena autônomas são `PenaNode` normativos e seguem a gramática
> `-pena[-{numero}]` de `BLOCK_ID_SPEC.md`. Quando a pena faz parte da mesma
> frase do dispositivo na fonte, permanece no texto do pai e não cria nó
> separado.

---

## 9. Validação do Markdown gerado

O Formatter só considera um arquivo `.md` válido para publicação após passar em todas as verificações abaixo. Falha em qualquer item bloqueia a publicação (fail-fast, consistente com a política de falha de `BLOCK_ID_SPEC.md` Seção 7.3).

1. **Frontmatter completo.** Todos os 13 campos obrigatórios presentes, com tipos corretos (`ano` e `total_artigos` são inteiros; datas em `YYYY-MM-DD`; `legal_status` e `tipo` pertencem aos enums definidos na Seção 2.1).
2. **Unicidade de Block ID.** Nenhum `^id` se repete no arquivo (validação já realizada na etapa de geração de IDs, mas reconfirmada no Markdown final como defesa em profundidade contra bugs do Formatter).
3. **Cobertura de Block ID.** Todo item de lista que representa a redação vigente de um artigo, parágrafo, inciso, alínea, item, pena ou tabela simples suportada possui exatamente um Block ID ao final da linha; todo heading de anexo suportado possui exatamente um Block ID ao final da linha. Nenhum dispositivo vigente ou bloco tabular suportado é publicado sem ID. Exceção (ADR-006): linhas de histórico de redações anteriores (riscadas, com nota `(Redação dada ...)`) não têm Block ID.
4. **Contagem de artigos.** O número de nós `artigo` da NormaAST é igual ao valor de `total_artigos` no frontmatter. (Contar itens de lista de nível 0 só vale quando não há artigos com histórico de redações no corpo — ver ADR-006 —; a fonte de verdade da contagem é a NormaAST.)
5. **Indentação consistente.** Toda a árvore de lista usa incrementos de exatamente 2 espaços por nível, sem mistura de tabs, e sem "saltos" de nível (ex.: um inciso não pode aparecer indentado diretamente sob um artigo sem parágrafo intermediário, a menos que a NormaAST de fato não tenha parágrafo entre eles).
6. **Sintaxe de Block ID.** Em todo `^id` do corpo, o valor após o prefixo `^` corresponde à gramática de `block-id` em `BLOCK_ID_SPEC.md` Seção 2.1. O prefixo é validado como parte da sintaxe Markdown, não como parte do valor de domínio.
7. **Consistência de `deviceStatus`.** Todo dispositivo com `deviceStatus: 'revoked'` ou `deviceStatus: 'vetoed'` na NormaAST está visualmente sinalizado no Markdown conforme Seção 5; nenhum dispositivo `active` contém marcação de revogado/vetado por engano. A projeção SQL correspondente chama-se `device_status`.
8. **Callouts obrigatórios presentes.** `[!info]` e `[!caution]` sempre presentes; `[!warning]` presente quando exigido pela regra da Seção 6.5.
9. **Nenhum callout fora do cabeçalho.** Validação estrutural garante que não existe `>` de callout aninhado dentro da árvore de lista de dispositivos.
10. **Headings consistentes com a hierarquia declarada.** A sequência de níveis de heading (`#` a `#####`) não pula nível (ex.: não pode ir de `##` direto para `####` sem heading de nível `###` intermediário, salvo quando a norma genuinamente não possui aquela divisão, caso em que o Formatter usa o próximo nível disponível de forma consistente em todo o documento).
11. **Referências cruzadas resolvem.** Entradas de `redacao_dada_por` apontam
para Block IDs presentes no corpo vigente. Em `ids_depreciados`, o destino
`novo` deve existir no corpo vigente e a origem `antigo` deve existir no
registro histórico/alias da lei; não é obrigatório materializar a âncora
antiga no corpo atual.
12. **Tabelas simples suportadas preservam retangularidade.** Cada linha serializada em tabela simples deve possuir a mesma contagem de células dos cabeçalhos. A validação rejeita linhas/células com Block IDs próprios, HTML bruto ou conteúdo tabular não sanitizado.
13. **Fase da NormaAST.** O Formatter rejeita qualquer árvore que não passe em
`IdentifiedNormaASTSchema` com `astPhase: 'identified'`; uma
`ParsedNormaAST` nunca pode ser serializada ou publicada diretamente.
14. **Rastreabilidade e confiança.** Todo nó possui `sourceRef` válido para o
snapshot identificado por SHA-256 e `parseEvidence` coerente. Evidência
`low` exige `requiresHumanReview: true` e confirmação editorial registrada
antes da publicação.
15. **Identificação da projeção.** A saída derivada `current_only` declara
`projection_profile: "current_only"` exatamente uma vez no frontmatter. A
publicação canônica `complete_with_history` omite o campo para manter os bytes
históricos e é identificada por essa ausência, conforme a ADR-012.
16. **Aliases e wikilinks jurídicos.** Quando existe índice de referências, os
aliases correspondem exatamente à entrada da revisão no layout; cada wikilink
materializa um span literal `resolved`, aponta para arquivo e Block ID presentes
no mesmo pacote/perfil e usa a forma interna ou externa da Seção 4.1. Nenhum
embed, path local ou link de estado não resolvido é aceito.

Somente após as dezesseis verificações acima o arquivo é liberado para revisão
humana e, em seguida, para release candidate; promoção no Git e sync no
Supabase são executados pelo Serviço de Publicação conforme o pipeline geral.
