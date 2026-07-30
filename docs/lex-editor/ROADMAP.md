# Roadmap de Implementação — Lex Editor

> Referências: `../architecture/SYSTEM_ARCHITECTURE.md` (arquitetura compartilhada), `../architecture/BLOCK_ID_SPEC.md`, `../architecture/MARKDOWN_SPEC.md`, `../architecture/UPDATE_PIPELINE.md`.
> Este roadmap organiza a construção do Lex Editor em fases sequenciais. Cada fase só inicia depois que a anterior atinge seu critério de saída — o pipeline é uma cadeia de dependências reais (não é possível gerar Block IDs sem uma NormaAST estável, nem formatar Markdown sem Block IDs atribuídos).

## Como ler este documento

Cada fase traz quatro blocos: **objetivo**, **entregáveis concretos**, **critério de saída** (o que precisa ser verdade para considerar a fase concluída e destravar a próxima) e **dependências técnicas** (o que precisa existir antes de começar). Fases não têm prazo fixo atribuído aqui — a ordem e os critérios de saída são o compromisso; a duração depende da capacidade do time.

## Sumário

- [Fase 0 — Setup do Projeto](#fase-0--setup-do-projeto)
- [Fase 1 — Parser (fonte → texto bruto estruturável)](#fase-1--parser-fonte--texto-bruto-estruturável)
- [Fase 2 — NormaAST](#fase-2--normaast)
- [Fase 3 — Gerador e reconciliador de Block IDs](#fase-3--gerador-e-reconciliador-de-block-ids)
- [Fase 4 — Formatter Markdown/Obsidian](#fase-4--formatter-markdownobsidian)
- [Fase 5 — Preview](#fase-5--preview)
- [Fase 6 — Validação e Exportação](#fase-6--validação-e-exportação)
- [Fase 7 — Publicação](#fase-7--publicação)
- [Fase 8 — Worker de Atualização](#fase-8--worker-de-atualização)
- [Definição de Pronto do MVP](#definição-de-pronto-do-mvp)

---

## Fase 0 — Setup do Projeto

### Objetivo

Ter um esqueleto de aplicação Electron + Vite + React + TypeScript rodando localmente, com estrutura de pastas, ferramentas de qualidade (lint, format, testes) e a casca visual da aplicação (layout, paleta) prontos para receber funcionalidade real a partir da Fase 1.

### Entregáveis concretos

- Scaffold do projeto com Electron (processo main), Vite (bundler do renderer) e React + TypeScript, com hot reload funcional em desenvolvimento e build de produção (instalador local) funcional.
- Estrutura de pastas dividida em três camadas com fronteira de responsabilidade explícita:
  ```
  packages/
    legal-domain/  # schemas NormaAST, Block IDs, validação; sem Electron
  src/
    main/           # processo Electron: janelas, IPC, acesso a filesystem/git/rede
    renderer/        # app React: UI, estado, componentes, rotas
      components/
      features/
        importacao/
        preview/
        validacao/
        publicacao/
        atualizacoes/
      hooks/
      state/
    shared/
      ipc/           # somente schemas/DTOs mínimos permitidos no renderer
  ```
- Canal IPC tipado por capacidades nomeadas, validando `senderFrame`, frame
  principal, origem, schema e tamanho; preload não expõe `ipcRenderer`.
- Baseline Electron de produção: `contextIsolation`, sandbox e `webSecurity`
  ativos; `nodeIntegration` desativado; CSP restritiva; navegação, popup,
  permissões, `webview`, código remoto e rede direta do renderer negados.
- Configuração de lint (ESLint com regras TypeScript + React) e formatação (Prettier), rodando via script de CLI e integrados a hook de pre-commit.
- Configuração de testes: Vitest para unitário/integração (renderer e lógica de domínio em `shared`), Playwright configurado para E2E de aplicação Electron (smoke test mínimo: abrir app, ver tela inicial).
- Pipeline de CI mínima (lint + testes unitários) rodando a cada push/PR.
- Paleta visual oficial do Vinculex implementada como tokens de design (variáveis CSS ou tema), incluindo cores semânticas para status de dispositivo (vigente, revogado, vetado, alterado) — essas cores serão reaproveitadas no preview (Fase 5) e na revisão de atualizações (Fase 8).
- Layout base da aplicação com três áreas persistentes:
  1. **Área de importação** — ponto de entrada (URL ou arquivo local), visível quando não há lei carregada ou acessível via ação "Nova importação".
  2. **Área de preview** — painel central, ocupa a maior parte da tela quando uma lei está carregada.
  3. **Área de logs/validação** — painel lateral ou inferior, colapsável, exibindo mensagens estruturadas por severidade (erro, aviso, info) geradas pelas etapas do pipeline.
- Roteamento interno mínimo entre as telas: Importação, Preview/Edição, Fila de Atualizações (placeholder), Configuração de Fontes (placeholder).

### Critério de saída

- `npm run dev` abre a aplicação Electron com o layout base renderizado (três áreas visíveis, mesmo que vazias).
- `npm run build` gera um pacote instalável sem erros.
- `npm run lint`, `npm run test` (Vitest) e `npm run test:e2e` (Playwright, smoke test) rodam com sucesso localmente e em CI.
- Fronteira documentada: `packages/legal-domain` é consumido por main/worker,
  mas não empacotado integralmente no renderer; `shared/ipc` contém somente
  DTOs seguros. Teste confirma que HTML bruto, AST, paths e secrets não
  atravessam a ponte.
- Build de produção confirma CSP, fuses/ASAR integrity suportados e assinatura
  por plataforma.

### Dependências técnicas

Nenhuma — é a fase inicial. Pré-requisito organizacional: paleta visual oficial Vinculex definida (ainda que em ferramenta externa de design) antes de tokenizar no código.

---

## Fase 1 — Parser (fonte → texto bruto estruturável)

### Objetivo

Transformar uma fonte de lei (URL do Planalto ou arquivo local) em texto Markdown limpo e em metadados básicos extraídos (título, ementa, blocos de dispositivos brutos), pronto para ser interpretado hierarquicamente na Fase 2. Nesta fase o sistema ainda não entende "o que é um artigo" — apenas separa ruído de conteúdo e localiza os blocos de texto normativo.

### Entregáveis concretos

- Integração com Defuddle para extração HTML → Markdown limpo, encapsulada em um serviço no processo `main` (acesso de rede e filesystem não pertence ao renderer).
- Criação de um **snapshot imutável da entrada** antes do Defuddle, com
  SHA-256, tipo de fonte e URI interna. O HTML bruto e o Markdown limpo seguem
  juntos para o parser do Planalto; o texto limpo auxilia a leitura, mas não
  substitui sinais estruturais presentes apenas no HTML.
- Fluxo de **importação por URL**: campo de entrada na área de importação,
  validação de formato de URL, download do HTML via `main`, persistência do
  snapshot bruto imutável com SHA-256 e execução do Defuddle. O renderer
  recebe somente uma projeção segura para preview; os artefatos completos
  permanecem no processo principal.
- Fluxo de **importação por arquivo local**: seletor de arquivo nativo (Electron `dialog`), suporte a `.html` e `.md` já limpos, mesmo pipeline de processamento a partir do ponto pós-Defuddle quando o arquivo já é Markdown.
- Extrator de metadados de cabeçalho: título da norma, tipo (lei ordinária, decreto-lei, lei complementar, emenda constitucional), número, ano, ementa — via reconhecimento de padrões no início do documento (ex.: "LEI Nº 14.133, DE 1º DE ABRIL DE 2021").
- Segmentação inicial do corpo do texto em blocos brutos candidatos a dispositivos (uma linha ou parágrafo por candidato), sem ainda atribuir hierarquia — essa é a entrada da Fase 2.
- Tratamento de erros de rede: timeout, DNS/host inválido, HTTP 4xx/5xx, certificado inválido — cada um com mensagem específica exibida na área de logs, nunca uma falha silenciosa ou genérica.
- Tratamento de erros de parsing/extração: Defuddle retorna vazio ou conteúdo não reconhecível como norma jurídica (ex.: página de erro do Planalto, redirecionamento para busca) — sistema deve detectar ausência de padrão de cabeçalho legal e sinalizar "fonte não reconhecida como norma jurídica" em vez de prosseguir silenciosamente.
- Suporte inicial restrito à fonte Planalto (HTML); estrutura do serviço de importação desenhada com uma interface `FonteImportadora` que permita adicionar LexML e outras fontes futuramente sem reescrever o fluxo.
- Testes unitários dos extratores de metadados e da segmentação bruta, usando fixtures de HTML reais salvas localmente (não dependentes de rede em CI).

### Critério de saída

- Colar uma URL real do Planalto (ex.: Código Penal) resulta em Markdown limpo exibido/logado, com título, ementa e lista de blocos brutos extraídos corretamente identificados manualmente por amostragem.
- Importar o mesmo conteúdo via arquivo local produz resultado equivalente ao importado por URL (paridade entre os dois fluxos de entrada).
- Todos os cenários de erro de rede e de parsing têm teste automatizado cobrindo a mensagem exibida ao usuário.
- Testes unitários rodando sobre fixtures de pelo menos duas fontes reais (ex.: Código Penal e uma lei curta de artigo único) sem acesso à rede.

### Dependências técnicas

Fase 0 concluída (estrutura `main`/`renderer`/`shared`, IPC tipado, área de importação e área de logs no layout). Biblioteca Defuddle disponível e integrável ao processo `main` (Node.js).

---

## Fase 2 — NormaAST

### Objetivo

Definir e implementar a árvore normativa intermediária (NormaAST), o modelo de dados central de todo o pipeline: a estrutura que representa fielmente a hierarquia jurídica de uma norma, independente da fonte de origem. É a fase de maior risco técnico do projeto, pois qualquer erro de reconhecimento aqui se propaga para Block IDs e Markdown.

### Entregáveis concretos

- Contratos de runtime e tipos inferidos para `ParsedNormaAST` e
  `IdentifiedNormaAST`, cobrindo raiz, divisões, artigo, parágrafo, inciso,
  alínea, item, pena autônoma, anexo e tabela. A fase `parsed` proíbe Block
  IDs; a fase `identified` os exige em todo nó referenciável.
- Modelagem por nó com `deviceStatus` (`active | revoked | vetoed | included |
  amended | renumbered | suspended | unknown`), redação atual, redações
  anteriores, decisão de preservação de texto revogado e destino de
  renumeração quando aplicável.
- `sourceRef` para localizar cada nó no snapshot bruto e no texto limpo, com
  hashes de integridade, e `parseEvidence` com confiança, razões e flag
  explícita de revisão humana.
- Implementação do reconhecimento de hierarquia completa a partir dos blocos brutos produzidos na Fase 1: motor de regras/regex capaz de identificar cada nível pela sua marcação textual característica (numeração romana para incisos, letras para alíneas, "Art." para artigos, títulos em maiúsculas para divisões estruturais etc.), com resolução de ambiguidade quando marcações se repetem em contextos diferentes.
- Tratamento explícito de dispositivos **revogados** com
  `deviceStatus: 'revoked'`, `preservarTextoRevogado` obrigatório e histórico
  preservado quando presente.
- Tratamento explícito de dispositivos **vetados** com
  `deviceStatus: 'vetoed'` e mensagem oficial preservada.
- Tratamento de casos estruturais especiais: artigos com numeração fracionária (ex.: "Art. 121-A"), parágrafo único vs. parágrafos numerados, incisos e alíneas fora de ordem ou renumerados por lei posterior.
- Testes unitários com pelo menos três leis reais de estrutura diferente:
  1. **Código Penal** — hierarquia intermediária (título/capítulo/seção, artigos, parágrafos, incisos, alíneas), volume alto de dispositivos, presença de dispositivos revogados.
  2. **Constituição Federal de 1988** — estrutura mais complexa (título/capítulo/seção/subseção), grande profundidade hierárquica, incisos e alíneas em múltiplos níveis, emendas constitucionais alterando dispositivos.
  3. **Lei de artigo único ou poucos artigos** (ex.: uma lei extravagante curta) — caso mínimo, valida que a NormaAST não exige níveis superiores desnecessários.
- Suíte de asserções estruturais: contagem de nós por tipo, verificação de que todo nó folha tem texto não vazio, verificação de que a árvore é navegável em profundidade sem ciclos ou nós órfãos.
- Testes de contrato garantindo que o Formatter rejeita `ParsedNormaAST` e que
  a projeção `IdentifiedNormaAST → Postgres → IdentifiedNormaAST` não perde
  hierarquia, texto, histórico, tabela ou evidência de origem.

### Critério de saída

- As três leis de referência são parseadas em NormaAST com 100% dos artigos identificados corretamente (validado por contagem cruzada com índice oficial/sumário da norma) e taxa de reconhecimento correto de parágrafos/incisos/alíneas validada manualmente por amostragem em pelo menos 20% dos dispositivos de cada lei.
- Dispositivos revogados e vetados presentes nas fixtures de teste são corretamente marcados com o status apropriado, sem serem confundidos com dispositivos vigentes.
- Todo nó de baixa confiança aponta para o fragmento original e exige revisão
  humana; nenhum nó de baixa confiança pode chegar silenciosamente à fase
  `identified`.
- Cobertura de testes unitários do módulo de reconhecimento hierárquico acima de um limiar definido pelo time (referência: 80%+ das ramificações de regras de reconhecimento).
- Estrutura de interfaces da NormaAST revisada e aprovada como estável o suficiente para servir de base aos Block IDs (mudanças estruturais depois desse ponto têm custo alto, pois afetam geração de ID).

### Dependências técnicas

Fase 1 concluída (blocos brutos segmentados e metadados de cabeçalho disponíveis). Acesso a texto oficial de referência das três leis de teste para validação cruzada (sumário/índice oficial).

---

## Fase 3 — Gerador e reconciliador de Block IDs

### Objetivo

Implementar a atribuição inicial determinística e a reconciliação histórica de
identificadores semânticos, únicos e imutáveis, seguindo
`../architecture/BLOCK_ID_SPEC.md`. A primeira publicação gera os IDs; toda
atualização posterior parte da última NormaAST publicada e do registro
append-only.

### Entregáveis concretos

- Implementação do algoritmo de geração inicial conforme `../architecture/BLOCK_ID_SPEC.md`, cobrindo a composição hierárquica completa (ex.: valor canônico `cp-art-121-par-2-inc-viii`, renderizado no Markdown como `^cp-art-121-par-2-inc-viii`).
- Normalização de componentes do ID: minúsculas, sem acentuação, separadores consistentes, tratamento de numeração fracionária (ex.: "Art. 121-A" → `art-121-a`), tratamento de parágrafo único (convenção explícita definida na spec, ex.: `par-unico`).
- Mecanismo de **atribuição única e persistente**: IDs são armazenados sem `^` em registro append-only; reprocessamentos reutilizam o valor publicado em vez de recalculá-lo a partir da árvore atual.
- **Reconciliação de identidade jurídica** entre NormaAST publicada e candidata, com casos ambíguos encaminhados para confirmação editorial.
- **Detecção de colisão histórica**: na primeira publicação, qualificar todos os novos conflitantes; em atualização, preservar o ID publicado e qualificar somente o dispositivo novo. IDs revogados, renumerados e depreciados continuam reservados.
- **Aliases/redirecionamentos permanentes** para correções e renumerações explícitas, com validação de destino existente e proibição de ciclos.
- Tratamento de casos estruturais que afetam geração de ID: dispositivos inseridos entre dispositivos existentes por lei posterior (ex.: "Art. 121-A" entre "Art. 121" e "Art. 122"), incisos/alíneas renumerados, dispositivos revogados que preservam o ID original (o ID marca a posição jurídica, não desaparece com a revogação).
- Testes unitários exaustivos cobrindo: composição e normalização; primeira publicação determinística; reprocessamento com registro; alteração de texto; novo conflito introduzido depois da publicação sem renomear o ID antigo; alias permanente; rejeição de ciclo; reconstrução a partir de Git + registro versionado.

### Critério de saída

- Rodar o gerador sobre as três leis de referência produz zero colisões de Block ID.
- Suíte de testes cobre 100% dos tipos de composição de ID descritos em `../architecture/BLOCK_ID_SPEC.md` (todo nível hierárquico, toda variação de numeração prevista na spec).
- Teste de regressão comprovando que alterar o texto de um dispositivo (simulando uma atualização legislativa futura) não altera seu Block ID, apenas seu conteúdo.
- Teste de regressão comprovando que introduzir posteriormente uma ramificação
  conflitante preserva todos os IDs publicados e qualifica apenas os novos.
- Amostra de Block IDs gerados revisada manualmente por um editor jurídico (ou pelo responsável de produto com esse chapéu) para validar legibilidade e aderência à convenção esperada para uso em links Obsidian.

### Dependências técnicas

Fase 2 concluída (NormaAST estável e validada). Documento `../architecture/BLOCK_ID_SPEC.md` finalizado e aprovado antes da implementação — a spec precisa existir como fonte de verdade antes do código.

---

## Fase 4 — Formatter Markdown/Obsidian

### Objetivo

Serializar a NormaAST com Block IDs atribuídos em um arquivo Markdown final, seguindo `../architecture/MARKDOWN_SPEC.md`: lista indentada hierárquica, frontmatter rico com os 13 campos mínimos, callouts institucionais restritos ao cabeçalho, e sinalização visual clara de dispositivos revogados/vetados. Esta é a última etapa automática antes da revisão humana.

### Entregáveis concretos

- Implementação do gerador de **frontmatter YAML** com os 13 campos normativos:
  `title`, `sigla`, `tipo`, `numero`, `ano`, `ramo`, `fonte`,
  `data_publicacao`, `data_atualizacao_legal`,
  `data_formatacao_vinculex`, `total_artigos`, `versao_vinculex` e
  `legal_status`.
- Implementação da serialização exata: divisões viram headings; artigo,
  parágrafo, inciso, alínea, item, pena e tabela viram itens referenciáveis;
  anexo usa heading próprio com Block ID.
- Implementação dos **callouts institucionais de cabeçalho**: bloco de callout Obsidian (`> [!info]` ou equivalente definido na spec) logo após o frontmatter, contendo avisos institucionais padronizados (ex.: fonte oficial, data da última verificação, aviso de que o conteúdo não substitui a publicação oficial) — restritos ao cabeçalho, nunca inseridos no meio do corpo normativo.
- **Sinalização de dispositivos revogados/vetados** conforme
  `deviceStatus: 'revoked' | 'vetoed'` e a decisão explícita
  `preservarTextoRevogado`.
- Geração de links internos entre dispositivos quando a NormaAST identificar referências cruzadas explícitas no texto (ex.: "nos termos do art. 5º desta Lei") — conversão para link wiki do Obsidian (`[[sigla#^block-id]]`) quando o alvo for resolvível dentro da mesma norma.
- Serialização determinística: gerar o Markdown duas vezes a partir da mesma NormaAST produz bytes idênticos (pré-requisito para diffs limpos no worker de atualização, Fase 8).
- Testes unitários comparando saída gerada com fixtures de Markdown esperado (golden files) para as três leis de referência, cobrindo frontmatter, indentação, callouts e sinalização de revogado/vetado.

### Critério de saída

- Markdown gerado para as três leis de referência abre corretamente no Obsidian, com lista indentada navegável, blocos referenciáveis por Block ID funcionando (`[[cp#^cp-art-121]]` resolve para o dispositivo correto) e frontmatter reconhecido pelo Obsidian (visível no painel de propriedades).
- Todos os 13 campos de frontmatter presentes e corretamente preenchidos (ou com aviso de validação explícito quando a fonte não fornece o dado) para as três leis de referência.
- Dispositivos revogados e vetados visualmente diferenciados no arquivo gerado, validado por revisão manual.
- Teste de determinismo (mesma entrada → mesma saída byte a byte) passando em CI.

### Dependências técnicas

Fase 3 concluída (Block IDs atribuídos e estáveis). Documento `../architecture/MARKDOWN_SPEC.md` finalizado e aprovado antes da implementação.

---

## Fase 5 — Preview

### Objetivo

Renderizar dentro do próprio Lex Editor uma visualização do Markdown gerado equivalente à experiência do Obsidian (lista indentada, callouts, frontmatter como painel de propriedades, links internos navegáveis), acompanhada dos avisos de validação produzidos pelas etapas anteriores, para que o editor jurídico revise sem sair da aplicação.

### Entregáveis concretos

- Componente de renderização Markdown no `renderer` com suporte aos elementos usados pelo Formatter: listas aninhadas profundas, callouts no estilo Obsidian, referências de bloco (`^block-id`) e links wiki (`[[...]]`) resolvidos internamente (sem navegação externa).
- Painel de metadados/frontmatter exibido de forma estruturada (não como YAML cru), espelhando o painel de propriedades do Obsidian, com os 13 campos visíveis e destacados quando incompletos.
- Indicação visual inline de dispositivos revogados/vetados na área de preview, reaproveitando a paleta de status definida na Fase 0.
- Painel de avisos de validação (conectado à área de logs definida na Fase 0), listando por severidade: erros estruturais (bloqueiam publicação), avisos (não bloqueiam, mas exigem atenção — ex.: campo de frontmatter ausente na fonte), informações (ex.: quantidade de dispositivos reconhecidos).
- Navegação dentro do preview por hierarquia (árvore lateral colapsável espelhando livro/título/capítulo/seção) permitindo saltar diretamente a um dispositivo sem rolagem manual em normas extensas (CF/88, CP).
- Indicador de origem por dispositivo: ao selecionar um item no preview, exibir o Block ID correspondente e (quando aplicável) a posição no texto bruto original, para apoiar a fase de correção manual (fluxo detalhado em `USER_FLOWS.md`).

### Critério de saída

- Abrir o preview das três leis de referência exibe corretamente toda a hierarquia, sem necessidade de abrir o Obsidian externamente para validar a estrutura.
- Avisos de validação gerados nas fases anteriores (frontmatter incompleto, dispositivo não reconhecido, etc.) aparecem no painel de logs com severidade correta e localização (qual dispositivo/linha) clicável até o ponto correspondente no preview.
- Teste E2E (Playwright) cobrindo o fluxo "importar → ver preview renderizado → ver pelo menos um aviso de validação" usando uma fixture com erro proposital.

### Dependências técnicas

Fase 4 concluída (Markdown gerado e determinístico). Layout base e área de logs da Fase 0.

---

## Fase 6 — Validação e Exportação

### Objetivo

Formalizar as regras de validação estrutural que determinam se uma lei está
apta a ser publicada e implementar a exportação do Markdown final — isolado ou
em lote — além do gerador de entradas do `UPDATE.md`, usado em toda publicação,
inclusive a inicial.

### Entregáveis concretos

- Motor de **regras de validação estrutural**, incluindo (não exaustivo): todo artigo deve ter Block ID único e não vazio; todo dispositivo deve ter texto não vazio; frontmatter deve conter os 13 campos mínimos (erro se ausente, aviso se inferido); hierarquia deve ser consistente (nenhum inciso "solto" fora de um artigo ou parágrafo); contagem de artigos reconhecidos deve bater com o intervalo declarado na fonte quando disponível (ex.: "Art. 1º ao Art. 361" para o Código Penal); nenhum dispositivo revogado/vetado sem marcação de status.
- Classificação de cada regra em **bloqueante** (impede exportação/publicação) ou **não bloqueante** (aviso, mas exportação permitida com confirmação explícita do editor).
- Exportação de **arquivo único** (.md de uma lei) para o filesystem local, reaproveitando o Formatter da Fase 4, com nome de arquivo e estrutura de pasta seguindo a convenção do repositório Git (`../architecture/SYSTEM_ARCHITECTURE.md`, seção "Estrutura de pastas do repositório Git de leis").
- Exportação **em lote**: seleção de múltiplas leis já processadas e exportação simultânea, respeitando a mesma convenção de pastas, com relatório final de sucesso/falha por lei.
- Geração de **UPDATE.md**: único changelog canônico por lei, com entrada
  determinística para publicação inicial, atualização, correção editorial ou
  rollback; não existe `CHANGELOG.md` paralelo.
- Testes unitários do motor de regras cobrindo cada regra bloqueante e não bloqueante isoladamente, mais teste de integração de exportação em lote com uma lei válida e uma lei propositalmente inválida na mesma leva (garantindo que a falha de uma não interrompe a exportação das demais).

### Critério de saída

- As três leis de referência passam em todas as regras bloqueantes e produzem arquivo `.md` exportado idêntico (byte a byte) ao gerado diretamente pelo Formatter na Fase 4.
- Uma fixture proposital com erro estrutural (ex.: inciso órfão) é corretamente bloqueada na exportação, com mensagem de erro acionável.
- Exportação em lote de três leis simultaneamente produz a estrutura de pastas esperada no filesystem local, validada por teste automatizado.
- `UPDATE.md` gerado a partir de uma NormaAST antes/depois simulada (fixture de teste) lista corretamente os dispositivos alterados/incluídos/revogados.

### Dependências técnicas

Fase 5 concluída (preview funcional para permitir que o editor veja os avisos antes de tentar exportar). Fase 4 (Formatter) como dependência direta de geração do `.md`.

---

## Fase 7 — Publicação

### Objetivo

Levar o Markdown validado e aprovado do filesystem local a um release
candidate no Git e solicitar ao Serviço de Publicação a revalidação, promoção
do SHA ao branch protegido e sincronização transacional com o Supabase, com
histórico e rollback para frente.

### Entregáveis concretos

- Serviço de **release candidate** no processo `main`: prepara
  SemVer, `numero_publicacao`, chave idempotente e manifesto; escreve Markdown,
  `UPDATE.md` e manifesto no mesmo commit; faz push somente para
  `releases/{publicationId}`.
- Credencial Git local via SSH agent/credential manager, limitada a branches
  candidatas. Não é digitada na UI, salva em `.env` de produção ou passada em
  argumento/log.
- Tela de confirmação de publicação exibindo resumo do que será commitado (arquivos afetados, diff resumido quando for atualização) antes do commit efetivo — segundo gate humano além da aprovação do preview.
- **Serviço de Publicação server-side**: revalida identidade/papel, aprovação,
  SHA, base, paths, manifesto, hashes e schemas; promove o SHA ao branch
  protegido e chama a função privada transacional que troca
  `leis.versao_publicada_id` somente ao final.
- Autenticação editorial individual e aprovação server-side ligada ao digest.
  Sessão local usa credential storage do SO e nunca é exposta ao renderer.
- Gravação do ponteiro de rastreabilidade (commit SHA) junto ao registro no Supabase, amarrando cada publicação no banco ao commit correspondente no Git.
- **Histórico e rollback** dentro do Lex Editor: tela ordenada por
  `numero_publicacao`, diff contra a versão corrente e restauração de snapshot
  anterior como nova publicação, com justificativa, novo SemVer, novo release
  commit, `restaura_versao_id` e nova entrada em `UPDATE.md`.
- Tratamento de falhas por diário durável e chave de idempotência: commit local
  não é “publicado”; push sem sync aparece como “sincronização pendente”; retry
  reutiliza versão, manifesto e SHA e não cria outra `versoes_lei`.
- Concorrência otimista por commit-base e `versao_publicada_id`: duas
  publicações simultâneas da mesma lei não podem reutilizar SemVer ou sobrescrever
  o ponteiro; a perdedora recalcula os artefatos e exige nova confirmação.
- Testes de segurança: XSS/IPC forjado, traversal/symlink, SSRF/redirect,
  injeção Git, manifesto adulterado/replay, ausência de secrets no bundle/logs e
  negação de escrita direta por renderer/editor/worker/SaaS.

### Critério de saída

- Publicar uma das três leis de referência resulta em release commit visível no
  branch protegido somente após promoção server-side, com Markdown,
  `UPDATE.md` e manifesto no mesmo commit, e em snapshot completo no Supabase.
- Cenário de falha simulada (rede indisponível durante push) não corrompe o estado local nem duplica commits ao tentar novamente.
- Cenário concorrente com duas tentativas sobre a mesma base publica apenas
  uma; a outra é bloqueada antes do sync e não altera Git/Supabase.
- Rollback de teste cria nova versão/commit e restaura corretamente o snapshot
  escolhido, sem reescrever o histórico Git ou registros anteriores.
- Fluxo completo "preview aprovado → commit → sync → confirmação visível na UI" validado por teste E2E.
- Varredura do instalador prova ausência de secret administrativa e credencial
  do branch protegido; a identidade local falha ao tentar essas operações.

### Dependências técnicas

Fase 6 concluída. Repositório com branch protegido e escopo de branch
candidato provisionado. Serviço de Publicação e ambientes Supabase separados de
desenvolvimento/staging/produção disponíveis conforme
`../architecture/ADR-007-fronteira-segura-publicacao.md`.

---

## Fase 8 — Worker de Atualização

### Objetivo

Implementar o serviço Node.js independente que monitora periodicamente as fontes oficiais de leis já publicadas, detecta divergência de conteúdo, gera diff a nível de dispositivo e alimenta uma fila de atualizações pendentes — revisável e aprovável exclusivamente por um editor humano dentro do Lex Editor, nunca publicada automaticamente. Fluxo de referência completo em `../architecture/UPDATE_PIPELINE.md`.

### Entregáveis concretos

- Serviço Node.js standalone (fora do processo Electron), com scheduler próprio (cron interno ou disparado por scheduler da plataforma de hospedagem, conforme `../architecture/SYSTEM_ARCHITECTURE.md`), configurável por lei quanto à frequência de verificação.
- Reaproveitamento do **Parser** (Fase 1) e da **NormaAST** (Fase 2) como dependências de biblioteca compartilhada (código de domínio isolado em pacote/módulo consumível tanto pelo Lex Editor quanto pelo worker, evitando duplicação de lógica de reconhecimento).
- Cálculo de hash sobre a **projeção normativa** da `ParsedNormaAST`, excluindo
  IDs, `sourceRef` e evidência operacional, além do SHA-256 separado do
  snapshot bruto; comparação com a última projeção normativa publicada.
- **Geração de diff a nível de dispositivo**: ao detectar divergência de hash, reprocessar a fonte via Parser/NormaAST, reaproveitar Block IDs já existentes para dispositivos inalterados (conforme regra de estabilidade da Fase 3) e produzir uma lista estruturada de dispositivos incluídos, alterados e revogados desde a última publicação.
- **Fila de pendências**: registro no Supabase (ou armazenamento intermediário definido em `../architecture/UPDATE_PIPELINE.md`) de cada proposta de atualização gerada, com status (`pendente`, `aprovada`, `rejeitada`) e vínculo com a lei/versão publicada anterior.
- **Interface de revisão/aprovação no Lex Editor**: nova tela consumindo a fila de pendências, exibindo diff dispositivo a dispositivo (texto anterior vs. novo, Block ID preservado, tipo de mudança), com ações de aprovar (dispara o fluxo de publicação da Fase 7, gerando `UPDATE.md` e novo commit/sync) ou rejeitar (mantém a versão publicada atual e registra o motivo da rejeição).
- Notificação/indicador visível no Lex Editor quando há pendências não revisadas (contador na navegação, por exemplo), para que o Editor Jurídico não precise checar manualmente a fila.
- Tratamento de falso positivo: divergência de hash causada por mudança cosmética da fonte oficial (ex.: reformatação de HTML sem alteração de texto normativo) deve ser filtrada antes de virar pendência, ou pelo menos sinalizada com baixa severidade — critério detalhado em `../architecture/UPDATE_PIPELINE.md`.
- Testes de integração do worker: simulação de fonte alterada (fixture antes/depois), verificação de que a pendência gerada contém o diff correto e que nenhuma publicação ocorre sem a ação explícita de aprovação no Lex Editor.

### Critério de saída

- Worker rodando em ambiente de teste detecta corretamente uma alteração simulada em uma das leis de referência (fixture "antes" publicada, fixture "depois" servida como fonte) e gera uma pendência com diff correto a nível de dispositivo.
- Nenhum caminho de código do worker escreve diretamente em conteúdo publicado (vigente) no Supabase — apenas na fila de pendências; verificado por revisão de código e por teste que garante ausência de permissão de escrita em tabelas de conteúdo publicado a partir das credenciais do worker.
- Fluxo completo de aprovação testado E2E: pendência aparece na fila do Lex Editor → editor abre diff → aprova → `UPDATE.md` e manifesto gerados → SHA enviado ao branch candidato → Serviço de Publicação revalida e promove o SHA → sync transacional → hash de referência atualizado.
- Fluxo de rejeição testado: pendência rejeitada não altera a versão publicada e fica registrada com motivo, sem reaparecer automaticamente até nova detecção de divergência real.

### Dependências técnicas

Fase 7 concluída (publicação e histórico funcionando, pois aprovação de atualização reutiliza esse fluxo). Fases 1 e 2 (Parser e NormaAST) empacotadas de forma reutilizável fora do contexto exclusivo do Lex Editor. Ambiente de hospedagem do worker provisionado (Railway/Fly.io ou equivalente) com acesso restrito conforme princípios de segurança de `../architecture/SYSTEM_ARCHITECTURE.md`.

---

## Definição de Pronto do MVP

O MVP do Lex Editor é considerado concluído quando **todos** os critérios abaixo são satisfeitos simultaneamente, usando o Código Penal como lei de prova de fogo (maior volume de dispositivos entre as leis prioritárias, com presença de dispositivos revogados):

| # | Critério de aceite | Fase(s) associada(s) |
|---|---|---|
| 1 | O Código Penal é importado com sucesso a partir da URL oficial do Planalto, sem intervenção manual no texto bruto. | Fase 1 |
| 2 | Todos os dispositivos do Código Penal são reconhecidos na NormaAST — 100% dos artigos, validado por contagem cruzada com o índice oficial; parágrafos, incisos e alíneas reconhecidos corretamente por amostragem revisada manualmente. | Fase 2 |
| 3 | Dispositivos revogados do Código Penal são corretamente identificados e sinalizados com `deviceStatus = 'revoked'`, sem serem confundidos com dispositivos vigentes. | Fase 2, Fase 4, Fase 5 |
| 4 | Todo dispositivo do Código Penal recebe um Block ID único, semântico e sem colisões, seguindo `../architecture/BLOCK_ID_SPEC.md`. | Fase 3 |
| 5 | O Markdown gerado é válido segundo `../architecture/MARKDOWN_SPEC.md` — frontmatter com os 13 campos mínimos, lista indentada correta, callouts restritos ao cabeçalho — e abre corretamente no Obsidian, com blocos referenciáveis funcionando. | Fase 4 |
| 6 | O preview dentro do Lex Editor reflete fielmente o Markdown gerado, com avisos de validação visíveis e navegação hierárquica funcional. | Fase 5 |
| 7 | A exportação do Código Penal para `.md` não perde informação em relação à NormaAST de origem (validado por comparação estrutural: mesma contagem de dispositivos, mesmos Block IDs, mesmo texto). | Fase 6 |
| 8 | Um editor jurídico consegue revisar o preview, identificar e corrigir manualmente pelo menos um erro de reconhecimento do parser, e essa correção é preservada na exportação final. | Fase 5, Fase 6 |
| 9 | A publicação do Código Penal aprovado gera um release candidate real no repositório Git privado; o Serviço de Publicação promove exatamente esse SHA ao branch protegido e sincroniza o snapshot no Supabase, com ponteiro rastreável. | Fase 7 |
| 10 | Todas as regras de validação estrutural bloqueantes passam para o Código Penal antes da publicação ser permitida pela interface. | Fase 6, Fase 7 |

O worker de atualização (Fase 8) **não é pré-requisito do MVP** — é a evolução natural pós-MVP que passa a manter as leis já publicadas atualizadas automaticamente, mas o MVP entrega valor completo ao permitir importar, validar, revisar e publicar uma lei complexa do zero até o repositório canônico.
