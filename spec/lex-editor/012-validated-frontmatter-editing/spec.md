# Feature 012 — Edição validada de metadados e frontmatter

## Metadados

- `implementation_status`: done
- `priority`: P1
- `owner`: não atribuído

## Objetivo

Permitir que o Editor Jurídico revise e corrija, em formulário estruturado, os
metadados de uma lei antes de publicar. Cada alteração deve validar tipo,
formato, origem e regra de mutabilidade, entrar no diário editorial e atualizar
preview, validação, exportação e publicação a partir da mesma revisão da
`IdentifiedNormaAST`, inclusive após fechar e reabrir o aplicativo.

## Problema

O parser e o Formatter já produzem o frontmatter canônico, e o domínio já
possui uma operação interna limitada de metadados. O desktop, porém, não expõe
um fluxo seguro para revisar esses valores. Editar YAML livremente criaria uma
segunda fonte de verdade e permitiria adulterar contagem, versão, proveniência,
aliases ou identidade publicada sem executar os efeitos necessários sobre
Block IDs, referências, aprovação e artefatos.

O RF-24 originalmente dizia que qualquer campo poderia ser editado. As fontes
normativas superiores definem, contudo, campos derivados e controlados por
outros fluxos. Esta feature explicita a matriz de mutabilidade: o editor pode
corrigir metadados editoriais; valores sistêmicos continuam visíveis, mas
somente leitura.

## Escopo

- Projeção tipada dos 13 campos obrigatórios e dos opcionais do frontmatter,
  indicando valor, origem, mutabilidade e motivo de bloqueio.
- Formulário estruturado, sem editor YAML, para título, sigla, tipo, número,
  ano, ramo, datas jurídicas, vigência, tags e norma revogadora.
- Correção de sigla e identidade jurídica somente antes da primeira
  publicação, com reconciliação de Block IDs, catálogo e referências.
- Bloqueio de edição direta para fonte, fontes auxiliares, data de formatação,
  total de artigos, SemVer, perfil de projeção, aliases, redações por
  dispositivo e IDs depreciados.
- Comando editorial atômico, com revisão esperada, motivo, validação runtime,
  diário durável, replay e invalidação de validação/aprovação anterior.
- Atualização imediata do preview e do Markdown derivado após confirmação
  durável, sem alterar snapshots nem conteúdo jurídico dos dispositivos.
- Funcionamento offline para projetos já importados e tratamento explícito de
  formulário obsoleto ou estado de publicação não comprovável.
- IPC/preload mínimo, DTOs fechados e interface acessível por teclado.

## Fora do escopo

- Editar YAML ou Markdown como fonte de verdade.
- Alterar texto, hierarquia ou estado de dispositivos; isso permanece no fluxo
  editorial da Feature 006.
- Alterar URL ou conjunto de fontes pelo frontmatter; isso pertence ao catálogo
  da Feature 011 e a um novo processo de importação/reprocessamento.
- Editar `publicationStatus`, `deviceStatus`, `projection_profile`, SemVer,
  número de publicação, aliases ou registro histórico de Block IDs.
- Renomear sigla, tipo, número ou ano de uma norma depois da primeira
  publicação.
- Implementar logs pesquisáveis do RF-23 ou alterar o schema público do SaaS.

## Dependências

- Features 005, 006, 007, 009, 010 e 011.
- `../../../docs/architecture/DATA_MODEL.md`, seção “Metadados de frontmatter”.
- `../../../docs/architecture/MARKDOWN_SPEC.md`, seção 2.
- `../../../docs/architecture/BLOCK_ID_SPEC.md`, seção 3.1.
- `../../../docs/architecture/ADR-002-norma-ast.md`.
- `../../../docs/architecture/ADR-005-status-fields.md`.
- `../../../docs/architecture/ADR-013-referencias-juridicas-resolvidas.md`.
- `../../../docs/lex-editor/PRD.md`, RF-11 e RF-24.
- `../../../docs/lex-editor/USER_FLOWS.md`, fluxo 10.

## Requisitos

- RF-012-01: projetar os campos do frontmatter a partir da revisão corrente da
  `IdentifiedNormaAST`, com schema runtime e classificação explícita entre
  editável, editável apenas antes da primeira publicação e somente leitura.
- RF-012-02: validar o formulário completo e cada campo por tipo, tamanho,
  enum, URL, data real, SemVer e regras cruzadas antes de gravar qualquer
  comando.
- RF-012-03: aplicar alterações somente por comando editorial tipado com
  `expectedRevisionHash`, ator derivado no processo principal e motivo
  obrigatório para identidade, vigência ou data jurídica.
- RF-012-04: impedir alteração direta de valores derivados ou controlados por
  importação, catálogo, Formatter, reconciliador e publicação.
- RF-012-05: permitir correção de sigla, tipo, número e ano somente quando a
  ausência de publicação anterior for comprovada; falta de prova bloqueia a
  alteração de identidade.
- RF-012-06: ao mudar sigla ou identidade antes da primeira publicação,
  reconciliar Block IDs e regenerar catálogo/layout/índice de referências na
  mesma operação lógica; conflito preserva integralmente a revisão anterior.
- RF-012-07: persistir a alteração e seu efeito no diário/checkpoint existentes,
  recuperar por replay e nunca exibir “salvo” antes da confirmação durável.
- RF-012-08: invalidar validação completa, confirmações e aprovação ligadas à
  revisão anterior; exportação e publicação exigem nova validação da revisão
  resultante.
- RF-012-09: fazer preview, exportação individual/em lote e publicação
  serializarem exatamente os metadados da mesma revisão, sem estado paralelo da
  UI.
- RF-012-10: expor ao renderer somente IDs opacos, valores limitados,
  capacidades e diagnósticos necessários; nunca AST, paths, snapshots ou
  histórico interno.
- RF-012-11: oferecer navegação por teclado, foco previsível, associação de
  erros aos campos e resumo acessível de alterações antes da confirmação.

## Invariantes

- Frontmatter é projeção da `IdentifiedNormaAST`; nunca existe um YAML editável
  paralelo à árvore.
- Campo somente leitura não pode ser alterado por IPC, chamada direta ao
  serviço ou replay de comando adulterado.
- Estado de publicação usado para congelar identidade vem do histórico
  autoritativo, não de um booleano informado pelo renderer.
- Sigla publicada e Block IDs publicados permanecem imutáveis.
- Alteração de identidade é tudo ou nada: AST, IDs, referências e layout nunca
  ficam em revisões diferentes.
- Toda alteração muda o hash da revisão e invalida aprovação anterior.
- O Formatter continua determinístico e não consulta relógio, rede, UI ou
  banco.
- Falha de validação, persistência ou reconciliação não produz sucesso nem
  modifica a revisão corrente.

## Cenários essenciais

### Correção editorial comum

Dada uma lei importada com ramo ou data jurídica incorretos, quando o editor
informa valores válidos, motivo e confirma, então o comando é persistido, a
aprovação anterior é invalidada e preview/exportação exibem o novo frontmatter
canônico após nova validação.

### Valor inválido

Dada uma data inexistente, enum desconhecido, tag excessiva ou combinação
incoerente, quando o editor tenta salvar, então o campo recebe diagnóstico
acessível e nenhuma entrada é acrescentada ao diário.

### Correção de sigla antes da publicação

Dada uma lei nunca publicada, quando a sigla é corrigida, então todos os Block
IDs provisórios são reconciliados, referências e layout são regenerados e a
operação só confirma se o conjunto completo permanecer válido.

### Identidade já publicada

Dada uma lei com versão publicada, quando alguém tenta alterar sigla, tipo,
número ou ano pela UI ou IPC direto, então a operação falha com código estável,
mantém IDs e revisão e orienta criar/corrigir a entidade por fluxo próprio.

### Recuperação e concorrência

Dado um formulário aberto sobre revisão antiga ou um encerramento após escrita
durável, quando o projeto é recarregado, então comando obsoleto é rejeitado e o
último comando confirmado reaparece por replay sem duplicação.

## Critérios de aceite

- [x] Os 13 campos obrigatórios e opcionais suportados aparecem com valor,
  origem e mutabilidade corretos; campos sistêmicos são somente leitura.
- [x] O editor corrige metadados válidos sem editar YAML e o mesmo valor aparece
  no preview, exportação e candidato de publicação.
- [x] Data, enum, URL, tamanho e regra cruzada inválidos falham antes de alterar
  a revisão, com erro inline e foco acessível.
- [x] Alteração confirmada entra no diário, sobrevive a reabertura e invalida
  validação/aprovação da revisão anterior.
- [x] Sigla/identidade podem mudar somente antes da primeira publicação e
  reconciliam IDs, catálogo, layout e referências atomicamente.
- [x] Identidade publicada, campos derivados e proveniência são imutáveis pela
  UI, IPC, serviço e replay adulterado.
- [x] Formulário obsoleto recebe conflito seguro e preserva a edição local para
  revisão, sem last-write-wins.
- [x] O fluxo funciona offline em projeto local já importado; se o histórico
  não provar que a lei nunca foi publicada, somente a identidade fica bloqueada.
- [x] Fluxo completo por teclado cobre abrir, editar, cancelar, confirmar,
  corrigir erro e voltar ao preview.
- [x] As Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003 preservam o
  frontmatter canônico nos perfis completo e vigente após a edição.

## Validação mínima

- Risco: crítico para identidade, Block IDs e publicação; alto para
  persistência e recuperação; médio para interação da UI.
- Testes unitários da matriz de mutabilidade, schemas, regras cruzadas,
  aplicação atômica, identidade publicada e serialização canônica.
- Integração do diário/checkpoint, crash/reabertura, conflito de revisão,
  invalidação de aprovação, referências e publicação.
- Testes IPC negativos para payload extra, campo sistêmico, revisão obsoleta,
  remetente inválido e resposta excessiva.
- E2E desktop offline para edição comum, erro inline, teclado, reabertura e
  tentativa de alterar identidade publicada.
- Regressão nas três leis de referência e nos dois perfis de projeção.

## Riscos

- Formulário virar um editor genérico de AST: usar contrato fechado e matriz de
  campos, sem chave/valor arbitrário.
- Correção de sigla quebrar todos os links: permitir apenas antes da primeira
  publicação e reconciliar todos os consumidores antes de confirmar.
- Valor exibido divergir do publicado: eliminar estado paralelo e sempre
  regenerar saídas da revisão corrente.
- Histórico remoto indisponível permitir renomeação perigosa: falhar fechado
  somente para campos de identidade e manter correções editoriais offline.
- Autosave mascarar falha: confirmação explícita, diário durável e estado de
  salvamento visível.
