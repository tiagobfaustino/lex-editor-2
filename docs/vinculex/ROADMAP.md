# Roadmap de Implementação — Vinculex SaaS

> Referências: `../architecture/SYSTEM_ARCHITECTURE.md` (arquitetura compartilhada), `../architecture/DATA_MODEL.md`, `../architecture/BLOCK_ID_SPEC.md`, `../architecture/UPDATE_PIPELINE.md`, `../architecture/ADR-005-status-fields.md`, `../architecture/ADR-007-fronteira-segura-publicacao.md`, `../architecture/ADR-008-monetizacao-e-gateway.md`, `../lex-editor/ROADMAP.md`.
> Este roadmap organiza a construção do Vinculex SaaS em fases sequenciais. O
> SaaS só consome projeções públicas da versão indicada por
> `leis.versao_publicada_id`, disponibilizadas depois que o Lex Editor aprova e
> o Serviço de Publicação conclui promoção e sync (ver
> `../lex-editor/ROADMAP.md`, Fase 7).

## Como ler este documento

Cada fase traz quatro blocos: **objetivo**, **entregáveis concretos**, **critério de saída** (o que precisa ser verdade para considerar a fase concluída) e **dependências** (técnicas internas ao SaaS e, quando existir, dependência externa do pipeline do Lex Editor). Fases não têm prazo fixo atribuído aqui — a ordem e os critérios de saída são o compromisso; a duração depende da capacidade do time. Oferta, limites e gateway do MVP estão fechados em `../architecture/ADR-008-monetizacao-e-gateway.md`; qualquer alteração posterior exige decisão versionada.

## Sumário

- [Fase 0 — Setup e Autenticação](#fase-0--setup-e-autenticação)
- [Fase 1 — Catálogo e Leitura](#fase-1--catálogo-e-leitura)
- [Fase 2 — Busca](#fase-2--busca)
- [Fase 3 — Favoritos e Coleções](#fase-3--favoritos-e-coleções)
- [Fase 4 — Notas e Marcações](#fase-4--notas-e-marcações)
- [Fase 5 — Progresso e Dashboard](#fase-5--progresso-e-dashboard)
- [Fase 6 — Atualizações Legislativas no SaaS](#fase-6--atualizações-legislativas-no-saas)
- [Fase 7 — Trilhas de Estudo](#fase-7--trilhas-de-estudo)
- [Fase 8 — Assinaturas](#fase-8--assinaturas)
- [Definição de Pronto do MVP](#definição-de-pronto-do-mvp)

---

## Fase 0 — Setup e Autenticação

### Objetivo

Ter um scaffold Next.js (App Router) + TypeScript + Tailwind rodando, com autenticação Supabase completa (cadastro, login, recuperação de senha, OAuth Google), estrutura de rotas definida e um layout base responsivo — a fundação sobre a qual todas as features de produto (Fases 1–8) serão construídas.

### Entregáveis concretos

- Scaffold Next.js (App Router) + TypeScript (strict mode) + Tailwind CSS, com ESLint + Prettier configurados e hook de pre-commit.
- Cliente Supabase tipado: `createBrowserClient` (componentes client) e `createServerClient` (Server Components/Route Handlers), com `Database` types gerados a partir do schema (`supabase gen types typescript`), mantidos versionados e regenerados a cada mudança de schema.
- Middleware Next.js de refresh de sessão Supabase (cookies `sb-*`), garantindo que Server Components sempre leiam sessão válida sem race condition entre client e server.
- Provider global de TanStack Query (`QueryClientProvider`) configurado com defaults sensatos (staleTime por tipo de dado — conteúdo normativo publicado pode ter staleTime alto, dados de usuário baixo).
- React Hook Form + Zod: schemas de validação compartilhados (`lib/schemas/`) para cadastro, login, recuperação de senha — reaproveitáveis em testes.
- Fluxos de autenticação completos via Supabase Auth:
  - Cadastro por e-mail/senha, com confirmação de e-mail (double opt-in) antes de liberar acesso completo.
  - Login por e-mail/senha.
  - Recuperação de senha (fluxo de "esqueci minha senha" com link de reset por e-mail).
  - OAuth Google (provedor configurado no projeto Supabase), com callback route (`/auth/callback`) tratando o `code exchange`.
- Trigger de banco (`on_auth_user_created`) que popula `usuarios_perfil` automaticamente a partir de `auth.users` no primeiro signup, evitando estado "usuário autenticado sem perfil" em qualquer ponto do produto.
- O trigger fixa `papel = 'usuario'` e `account_status = 'active'`; elevação de
  papel e suspensão passam somente por função administrativa auditada, nunca
  por metadado fornecido no signup.
- Middleware de proteção de rotas: grupo de rotas públicas (`(public)`: landing, `/login`, `/cadastro`, `/recuperar-senha`) vs. grupo autenticado (`(app)`: `/dashboard`, `/biblioteca`, `/leis/[sigla]`, `/busca`, `/favoritos`, `/notas`, `/configuracoes`), com redirecionamento para `/login` quando não autenticado e para `/dashboard` quando autenticado tentando acessar rota pública de auth.
- Layout base responsivo mobile-first: header com busca global (placeholder até Fase 2) e menu de usuário, navegação principal (sidebar em desktop, menu inferior/drawer em mobile), footer institucional. Paleta visual compartilhada com o Lex Editor tokenizada como variáveis Tailwind/CSS.
- Testes: Vitest para validações Zod e componentes de formulário; Playwright E2E cobrindo cadastro → confirmação de e-mail (mock) → login → logout, e o fluxo de OAuth Google (mock de provedor em ambiente de teste).
- CI mínima (lint + testes unitários + build) rodando a cada push/PR; deploy de preview automático (Vercel) por PR.

### Critério de saída

- `npm run dev` sobe a aplicação com landing, cadastro, login e recuperação de senha funcionais contra uma instância Supabase de desenvolvimento.
- Cadastro por e-mail/senha e login via Google OAuth resultam em sessão válida, perfil criado em `usuarios_perfil` e redirecionamento correto ao `/dashboard` (ainda que vazio nesta fase).
- Rotas do grupo `(app)` são inacessíveis sem sessão válida, comprovado por teste E2E.
- Layout base responde corretamente em pelo menos três breakpoints (mobile, tablet, desktop), validado manualmente e com snapshot de regressão visual quando disponível.

### Dependências

Nenhuma dependência do pipeline do Lex Editor — esta fase é infraestrutura pura de autenticação e não requer conteúdo normativo publicado. Depende de: instância Supabase de desenvolvimento provisionada (mesma referenciada em `../architecture/SYSTEM_ARCHITECTURE.md`), OAuth Google configurado no projeto Supabase, paleta visual oficial do Vinculex definida (compartilhada com `../lex-editor/ROADMAP.md`, Fase 0).

---

## Fase 1 — Catálogo e Leitura

### Objetivo

Consumir `api.leis_publicadas`, `api.dispositivos_publicados` e o resolvedor
oficial de Block ID, oferecendo catálogo por ramo/sigla e leitura da árvore
indicada pelo ponteiro público.

### Entregáveis concretos

- Camada tipada (`lib/queries/leis.ts`) que chama somente views/RPCs `api.*`;
  nenhum componente consulta tabelas normativas base.
- Página `/biblioteca` alimentada por `api.leis_publicadas`, agrupada por
  `ramo`, com sigla, título, tipo e `legal_status`.
- Página `/leis/[sigla]`: resolve exclusivamente
  o snapshot já filtrado por `api.dispositivos_publicados` — nunca
  `MAX(numero_publicacao)`, timestamp ou ordenação de SemVer —, monta a árvore
  por `parent_id` no servidor e renderiza a hierarquia.
- Cada dispositivo recebe `id` HTML igual ao `block_id`. A URL compartilhável
  canônica é `/leis/{sigla}/dispositivos/{blockId}`, resolvida no servidor;
  hashes ficam restritos à navegação dentro da página.
- Índice/sumário lateral colapsável espelhando a hierarquia da lei, com navegação rápida (clique salta para o dispositivo, sem reload de página).
- Indicação visual de `device_status` (`active`, `revoked`, `vetoed`, `amended`, `suspended`, `renumbered`, `unknown` — ver `../architecture/ADR-005-status-fields.md`) reaproveitando a paleta semântica de status já usada no Lex Editor, com `nota_status` exibida como texto explicativo (ex.: "Revogado pela Lei nº 12.015/2009").
- Resolução usa o valor sem `^` e um RPC server-side que consulta o snapshot
  público e `block_id_redirects`, com limite de saltos e detecção de ciclo.
  Alias válido produz redirect permanente; o cliente não percorre a cadeia.
- Lei ausente de `api.leis_publicadas` ou Block ID não resolvido retorna 404
  sem distinguir conteúdo inexistente de não publicado.
- Estratégia de performance para leis extensas (Código Penal, CF/88): carregamento server-side da árvore completa via RSC (evita round-trip client desnecessário), com virtualização de lista no client para o corpo de artigos e carregamento sob demanda do conteúdo fora da viewport, evitando travar o navegador com milhares de nós DOM simultâneos.
- Testes E2E: catálogo, índice lateral, URL canônica, redirect de alias,
  inexistente e ciclo de alias.

### Critério de saída

- O catálogo em `/biblioteca` lista corretamente todas as leis com `publication_status = 'published'` existentes na instância de desenvolvimento, sem exibir nenhuma lei em `draft`/`review`/`approved`/`archived`/`outdated`.
- Abrir a URL canônica de um Block ID renderiza, rola e destaca o dispositivo;
  um alias redireciona para o ID canônico.
- Dispositivos com `device_status` diferente de `active` são visualmente diferenciados e exibem `nota_status` quando presente.
- Uma lei do porte do Código Penal (centenas de dispositivos) carrega e é navegável dentro de um orçamento de performance definido pelo time (referência inicial: LCP < 2.5s em conexão 4G simulada).

### Dependências

Fase 0 concluída. A validação real exige ao menos uma lei promovida e
sincronizada pelo Serviço de Publicação na instância de desenvolvimento;
fixtures ajudam no desenvolvimento, mas não substituem esse teste integrado.

---

## Fase 2 — Busca

### Objetivo

Oferecer busca de texto integral, busca direta por número de artigo e filtros por ramo do direito, com uma decisão de arquitetura de busca deliberada e justificada para o MVP.

### Entregáveis concretos

- **Decisão de arquitetura de busca, registrada e justificada:** avaliadas duas rotas — (a) full-text search nativo do Postgres via `tsvector`/`tsquery`, com extensão `unaccent` e configuração de dicionário em português; (b) serviço dedicado externo (Algolia, Meilisearch ou Typesense).
  - **Recomendação para o MVP: Postgres nativo.** Justificativa: o volume de dados do MVP (sete leis prioritárias, na casa de dezenas de milhares de dispositivos no total) está muito abaixo do ponto em que um motor de busca dedicado se paga em latência ou relevância; manter a busca dentro do próprio Supabase evita operar um serviço externo adicional, evita sincronização de índice (risco de índice desatualizado em relação ao conteúdo publicado) e mantém a superfície de infraestrutura do MVP mínima. Reavaliar essa decisão se o catálogo crescer substancialmente (mais ramos do direito, jurisprudência, doutrina) ou se relevância de busca (sinônimos jurídicos, busca fuzzy, ranking por popularidade de consulta) se tornar um gargalo de produto perceptível — nesse cenário, Meilisearch é a alternativa mais provável por ser open-source, leve de operar e com bom suporte a português.
- Implementação Postgres: coluna gerada (`generated always as`) `tsvector` em `dispositivos` combinando `texto` e `numero` com peso diferenciado (`numero` com peso maior, para favorecer buscas diretas por artigo), índice GIN sobre essa coluna, extensão `unaccent` habilitada para tolerância a acentuação/grafia.
- RPC `api.buscar_dispositivos(query, ramo, lei_id, limite, cursor)` com
  resposta de colunas explícitas. Cada resultado é cruzado com
  `leis.versao_publicada_id`; a função não aceita versão e não retorna
  snapshots históricos ou colunas editoriais.
- Reconhecimento de busca direta por artigo: parser leve no client/edge que identifica padrões como "art 121", "artigo 121-a", "121º" e, quando reconhecido, prioriza resultado exato por `numero` em vez de depender só do ranking textual — evita que uma busca inequívoca de artigo específico apareça abaixo de resultados textuais menos relevantes.
- Filtros combináveis: por ramo do direito e por lei (sigla), aplicados junto com o termo de busca.
- UI: campo de busca global no header (herdado do layout da Fase 0), com debounce, exibição de resultados com trecho destacado (highlight do termo encontrado) e agrupamento por lei.
- Página de resultados dedicada `/busca?q=...&ramo=...`, com paginação e contagem total de resultados.
- Testes: termo comum com múltiplos resultados, busca direta de artigo, busca sem resultados, busca combinada com filtro de ramo, busca com acentuação/grafia variada validando `unaccent`.

### Critério de saída

- Buscar um termo jurídico comum (ex.: "excludente de ilicitude") retorna dispositivos relevantes, corretamente ancorados aos seus Block IDs, ordenados por relevância.
- Buscar "art. 121" (ou variações de grafia) direciona ao dispositivo correspondente do Código Penal como resultado de maior relevância.
- Filtro por ramo reduz corretamente o escopo dos resultados sem afetar a relevância dentro do escopo filtrado.
- Tempo de resposta da busca dentro de um orçamento definido (referência inicial: p95 < 500ms) no volume de dados do MVP, medido em ambiente equivalente a produção.

### Dependências

Fase 1 concluída (dispositivos publicados e navegáveis por Block ID — a busca não tem valor sem conteúdo real para indexar). A decisão de arquitetura de busca deve ser registrada antes do início da implementação, não durante.

---

## Fase 3 — Favoritos e Coleções

### Objetivo

Permitir favoritar um dispositivo específico ou uma lei inteira, organizar favoritos em coleções pessoais, e consultar tudo isso em uma tela dedicada.

### Entregáveis concretos

- Tabela `favoritos`, vinculada por `block_id` + `lei_id` e com
  `versao_lei_id_criacao` fixada a partir do ponteiro público no momento da
  criação.
- Tabela `colecoes` (`id, user_id, nome, descricao, criado_em, atualizado_em`, já definida em `../architecture/DATA_MODEL.md`) e tabela de junção N:N `favoritos_colecao(favorito_id, colecao_id, adicionado_em)`, associando um `favorito` já existente a uma ou mais coleções — não uma referência direta a `block_id`/`lei_id`, já que a coleção organiza favoritos, não dispositivos soltos.
- Botão de favoritar em cada dispositivo na página de leitura (ícone de estrela/marcador), com mutação otimista via TanStack Query (atualização visual imediata, rollback em caso de falha de rede).
- Favorito no nível de lei inteira (distinto do favorito de dispositivo), usado também como sinal de "acompanhamento" para notificações de atualização legislativa (ver Fase 6).
- Tela `/favoritos`: lista de dispositivos e leis favoritados, agrupados por lei, com ação de remoção direta e link para o dispositivo na página de leitura.
- Fluxo de criação/edição/exclusão de coleção, e associação de um favorito a uma ou mais coleções (modal ou drawer acionado a partir do botão de favoritar, ou a partir da tela de favoritos).
- Tela `/colecoes` e `/colecoes/[id]`, com itens ordenados por
  `favoritos_colecao.adicionado_em`. Reordenação manual não integra o contrato
  atual.
- RLS: `favoritos` e `colecoes` restritas a `auth.uid() = user_id`, seguindo o padrão já definido em `../architecture/DATA_MODEL.md`.
- Testes E2E: favoritar um artigo a partir da leitura, verificar que aparece em `/favoritos`, criar uma coleção, adicionar o artigo favoritado a ela, verificar persistência após reload.

### Critério de saída

- Usuário favorita e desfavorita um dispositivo com feedback visual imediato e persistência confirmada após reload da página.
- Usuário cria uma coleção, associa favoritos a ela e visualiza a coleção corretamente populada em `/colecoes/[id]`.
- Teste automatizado comprova que a RLS impede um usuário autenticado de ler ou modificar favoritos/coleções de outro usuário.

### Dependências

Fase 1 (dispositivos navegáveis por Block ID) e Fase 0 (autenticação). Não depende da Fase 2 (busca).

---

## Fase 4 — Notas e Marcações

### Objetivo

Permitir que o usuário registre notas pessoais vinculadas a um Block ID específico e aplique marcações rápidas (tags) a dispositivos, com garantia explícita de que ambas sobrevivem a atualizações legislativas do conteúdo subjacente.

### Entregáveis concretos

- Tabela `notas`, vinculada por `block_id` + `lei_id` e com
  `versao_lei_id_criacao`, permitindo comparação com o snapshot público atual.
- Tabela `marcacoes` (já definida em `../architecture/DATA_MODEL.md`: `id, user_id, lei_id, block_id, tipo_marcacao, criado_em`, com `tipo_marcacao` restrito por `CHECK` a `importante | revisar | duvida | cobranca_frequente` — não um campo `status` genérico, ver `../architecture/ADR-005-status-fields.md`), permitindo múltiplas marcações por dispositivo por usuário, uma linha por combinação `(user_id, block_id, tipo_marcacao)`.
- Editor de nota vinculado a Block ID: painel lateral ou modal acionado a partir do dispositivo na tela de leitura, campo de texto com suporte a formatação leve (Markdown básico), salvamento explícito com indicador de estado (salvando/salvo/erro).
- Indicador visual no dispositivo sinalizando existência de nota associada (ícone), sem expor o conteúdo da nota até o usuário abrir o painel — preserva a leitura limpa do texto normativo.
- Aplicação e remoção de marcações rápidas via chips de tag no dispositivo, com múltiplas marcações simultâneas permitidas.
- Tela consolidada `/notas`: lista de todas as notas do usuário, filtrável por lei e por tag de marcação associada ao mesmo dispositivo, com link direto para o dispositivo na leitura.
- **Sobrevivência e comparação testadas:** nota e marcações permanecem pelo
  `block_id`; o selo aparece somente quando o texto do mesmo Block ID difere
  entre `versao_lei_id_criacao` e a versão pública atual.
- Testes E2E cobrindo criação, edição e remoção de nota; aplicação e remoção de marcação; e um teste de regressão dedicado que simula duas `versoes_lei` diferentes para a mesma lei com um `block_id` comum tendo texto alterado entre elas, verificando que a nota criada na versão anterior permanece corretamente acessível e vinculada na versão nova.

### Critério de saída

- Uma nota criada em um dispositivo é salva vinculada ao `block_id`, sobrevive a reload e a navegação entre páginas.
- Marcações aplicadas aparecem visualmente no dispositivo correspondente e são corretamente filtráveis na tela consolidada `/notas`.
- Teste automatizado comprova que uma nota feita na versão N de uma lei permanece vinculada e visível na versão N+1 publicada, mesmo com o texto do dispositivo alterado (`device_status = 'amended'`).

### Dependências

Fase 1 e Fase 0. Para validar o critério de sobrevivência a atualização **com dados reais** (não apenas fixture simulada em banco de desenvolvimento), depende de pelo menos um ciclo real do worker de atualização legislativa e da aprovação editorial correspondente no Lex Editor (`../lex-editor/ROADMAP.md`, Fase 8) ter gerado uma nova `versao_lei` publicada para uma lei já em uso no SaaS. Até esse ciclo real acontecer em produção/staging, o comportamento é validado via seed manual simulando duas versões da mesma lei — suficiente para fechar esta fase, mas não substitui a validação de ponta a ponta quando o worker estiver ativo.

---

## Fase 5 — Progresso e Dashboard

### Objetivo

Rastrear o progresso de leitura do usuário por lei, calcular streak de estudo, e consolidar tudo em uma tela de dashboard inicial que sirva como ponto de partida da experiência recorrente no produto.

### Entregáveis concretos

- Duas tabelas já definidas em `../architecture/DATA_MODEL.md`: `eventos_leitura` (log append-only granular, `id, user_id, lei_id, block_id, lido_em`) e `progresso_leitura` (estado agregado por usuário/lei, recalculado a partir do log via trigger/job — `dispositivos_lidos, percentual_concluido, ultima_leitura_em, sequencia_dias_estudo, maior_sequencia_dias`). Granularidade de marcação no nível de **artigo** — não em cada inciso/parágrafo isoladamente — para evitar ruído excessivo de tracking e manter o cálculo de progresso legível para o usuário.
- Decisão de produto explícita sobre o gatilho de marcação: MVP usa marcação **manual** ("marcar artigo como lido", ação explícita do usuário), por ser previsível e não depender de heurísticas de tempo de leitura/scroll que podem gerar falsos positivos; tracking automático (tempo de permanência, percentual de scroll) fica registrado como evolução futura, não como parte deste roadmap.
- Cálculo de streak de estudo: dias consecutivos com pelo menos um registro em `eventos_leitura.lido_em`, atualizando `progresso_leitura.sequencia_dias_estudo`/`maior_sequencia_dias` (via trigger ou função no Supabase, não recalculado ad-hoc no client a cada carregamento).
- Barra de progresso por lei: Block IDs distintos de artigos explicitamente
  lidos divididos pelos artigos `active` da versão pública. A troca do
  ponteiro recalcula o agregado; divisões e artigos não ativos não entram no
  denominador.
- Tela `/dashboard`: resumo de progresso por lei em andamento, streak atual, favoritos recentes (Fase 3), seção de atualizações legislativas recentes (placeholder funcional até a Fase 6 entregar o conteúdo real), e atalho "continuar de onde parou" (última posição de leitura registrada).
- Testes E2E: marcar um artigo como lido, verificar incremento correto do percentual de progresso da lei e do streak; verificar quebra de streak ao pular um dia sem interação registrada (via manipulação de data em ambiente de teste).

### Critério de saída

- Progresso de leitura persiste por usuário e por lei, refletido corretamente na barra de progresso e na tela de dashboard.
- Streak é calculado corretamente tanto no cenário de dias consecutivos quanto no cenário de quebra de sequência, validado por teste automatizado com datas controladas.
- Dashboard consolida corretamente dados de progresso (desta fase) e de favoritos (Fase 3) sem duplicação ou inconsistência entre as duas fontes.

### Dependências

Fase 1 (leitura estruturada, base para marcar progresso) e Fase 3 (favoritos, para a seção "favoritos recentes" do dashboard).

---

## Fase 6 — Atualizações Legislativas no SaaS

### Objetivo

Expor ao usuário final, de forma segura e sem vazar detalhes internos de revisão editorial, o changelog público gerado pelo pipeline de atualização do Lex Editor, e notificá-lo quando uma lei que acompanha recebe uma nova versão publicada.

### Entregáveis concretos

- View `api.changelog_publico`, expondo `numero_publicacao`,
  `versao_vinculex`, `tipo_publicacao`, datas públicas, `changelog`,
  `mudancas` e `publicado_em`; nunca aprovador, fontes, URIs ou hashes.
- Página `/leis/[sigla]/changelog`: histórico de versões publicadas de uma lei, com o resumo humano de cada atualização e link direto para os dispositivos afetados (via Block ID) na página de leitura.
- Reaproveitamento do favorito de lei (Fase 3) como sinal de "acompanhamento" — decisão deliberada de não criar uma tabela dedicada de "seguir lei" separada de favoritos, para não duplicar um conceito já existente no modelo de dados.
- Tabela `notificacoes` definida em `DATA_MODEL.md`, única por
  `(user_id, versao_lei_id, tipo_notificacao)`, com `lida_em` nullable.
- Função privada/job idempotente executado depois da troca do ponteiro. Os
  destinatários são a união de favorito da lei, progresso registrado e
  trilha ativa contendo a lei, limitada aos usuários elegíveis pelo feature
  gate. Inserir a versão sem ativá-la não notifica.
- Notificação in-app nesta fase (badge/contador e lista com marcação de lida);
  e-mail transacional permanece evolução posterior.
- Testes: publicar uma nova `versao_lei` de teste para uma lei favoritada por um usuário de teste e verificar que a notificação é gerada corretamente, que o changelog público reflete a nova versão, e que nenhum dado interno de revisão editorial é exposto pela view pública.

### Critério de saída

- Cada usuário elegível recebe exatamente uma notificação por versão, mesmo
  quando atende a vários critérios.
- O changelog público em `/leis/[sigla]/changelog` reflete corretamente o histórico de versões, sem expor dados internos de revisão editorial (diff bruto, identidade de quem aprovou, hashes).
- Teste de ponta a ponta usando uma atualização real publicada pelo Lex Editor (não apenas simulada por seed manual) confirma o fluxo completo desde a publicação até a notificação visível no SaaS.

### Dependências

Fase 3 (favoritos de lei como sinal de acompanhamento) e Fase 1 (leitura estruturada, para os links do changelog). **Dependência crítica externa: o worker de atualização legislativa e a interface de aprovação de atualizações do Lex Editor (`../lex-editor/ROADMAP.md`, Fase 8) precisam estar operacionais e já ter gerado ao menos um ciclo real de aprovação com nova `versao_lei` publicada.** Sem isso, o fluxo é testável apenas com dados inseridos manualmente simulando uma segunda versão — suficiente para fechar a fase tecnicamente, mas o critério de saída de ponta a ponta com dado real fica pendente até o worker estar em produção.

---

## Fase 7 — Trilhas de Estudo

### Objetivo

Oferecer trilhas de estudo públicas, curadas pela equipe editorial do produto (papel distinto do editor jurídico do Lex Editor), e permitir que o usuário monte suas próprias trilhas privadas, com acompanhamento de progresso item a item.

### Entregáveis concretos

- Tabela `trilhas_estudo` (já definida em `../architecture/DATA_MODEL.md`: `id, criado_por, titulo, descricao, publica boolean, foco_concurso, criado_em, atualizado_em` — `publica = true` para trilhas curadas pela equipe, `publica = false` para trilhas privadas do usuário) e tabela `trilha_itens(id, trilha_id, lei_id, block_id, ordem, titulo_customizado)`, vinculando itens por `block_id`/`lei_id` (com `block_id` opcional, NULL quando o item é a lei inteira) pelo mesmo motivo de estabilidade já aplicado a favoritos e notas.
- Catálogo `/trilhas`: trilhas públicas com título, descrição,
  `foco_concurso` e quantidade de itens; ramo único e estimativa de tempo não
  são prometidos pelo schema atual.
- Página `/trilhas/[id]` com itens ordenados e ação “iniciar trilha”, gravando
  `trilhas_usuario`; o índice parcial garante uma única trilha ativa. O
  progresso é derivado de `eventos_leitura` cruzado com `trilha_itens`.
- Criação de trilha privada pelo próprio usuário: interface para montar uma sequência a partir de dispositivos/leis já navegados ou favoritados, com reordenação (arrastar e soltar).
- Acompanhamento de progresso dentro da trilha: percentual concluído, indicação do próximo item sugerido, marcação explícita de item concluído (podendo reaproveitar a marcação de progresso de leitura quando o item é um dispositivo, ou uma marcação própria da trilha quando o item é uma lei inteira).
- Ferramenta `/admin/trilhas`, entregue nesta fase e integrada ao shell administrativo do SaaS. Criação, edição, reordenação e publicação exigem `papel IN ('curador', 'administrador')` e `account_status = 'active'` no servidor e no banco. O papel é distinto do Editor Jurídico do Lex Editor: trilhas não são conteúdo normativo e não transitam pelo pipeline de aprovação jurídica.
- Testes E2E: seguir uma trilha pública do catálogo até a marcação de itens concluídos; criar uma trilha privada, reordenar itens, verificar persistência da ordem.

### Critério de saída

- Uma trilha pública é navegável do catálogo até o acompanhamento de progresso item a item, refletindo corretamente o estado de conclusão de cada item.
- Usuário cria e reordena uma trilha privada com persistência correta da ordem após reload.
- O progresso exibido dentro da trilha reflete corretamente o progresso de leitura subjacente por dispositivo/lei, sem divergir do que é mostrado na página de leitura ou no dashboard.
- Curador publica e reordena uma trilha por `/admin/trilhas`; usuário comum recebe 403 ao chamar as mesmas funções diretamente.

### Dependências

Fase 5 (progresso de leitura, para sobrepor progresso dentro da trilha) e Fase 1 (leis/dispositivos referenciáveis como itens de trilha).

---

## Fase 8 — Assinaturas

### Objetivo

Introduzir a camada de monetização do produto: distinção entre plano gratuito e pago, integração com gateway de pagamento, e um painel administrativo para gestão de usuários, assinaturas e estatísticas — sem, em nenhum momento, abrir qualquer caminho de edição de conteúdo normativo a partir do SaaS.

### Entregáveis concretos

- **Asaas como gateway do MVP**, conforme `../architecture/ADR-008-monetizacao-e-gateway.md`: Checkout hospedado em BRL, cartão com renovação automática e Pix pago ativamente a cada ciclo. O retorno do navegador não concede acesso.
- Tabelas `assinaturas` e `eventos_gateway_pagamento` definidas em `../architecture/DATA_MODEL.md`. `subscription_status` (`trialing | active | past_due | canceled | expired`) é independente de `account_status`; eventos são deduplicados por `(provedor, evento_id)`.
- Oferta fixa do MVP: Premium por R$ 19,90/mês ou R$ 199,00/ano; avaliação única de 7 dias por conta verificada; plano gratuito com catálogo/busca/changelog completos, 20 favoritos e 5 notas. Coleções, marcações, exportação, trilhas privadas, progresso completo e notificações personalizadas exigem Premium.
- Catálogo de entitlements versionado e funções/RPCs transacionais que revalidam conta, período da assinatura e cota sob lock antes da escrita. `useFeatureGate` apresenta o estado na UI, mas não é a fronteira de autorização.
- Fluxo de checkout: tela de comparação de planos, criação server-side do Checkout Asaas, redirecionamento, evento autenticado inserido na inbox idempotente, reconciliação com a API e tela de confirmação que aguarda o estado server-side.
- Autoatendimento em `/configuracoes/assinatura`: consulta de período, meio de pagamento e cancelamento ao fim do ciclo por endpoint server-side que chama o Asaas. O cliente nunca recebe API key nem edita `subscription_status`.
- Painel administrativo (`/admin`, exige `papel = 'administrador'` e
  `account_status = 'active'`):
  - Gestão de usuários: busca, visualização de perfil, ação de suspensão de conta.
  - Gestão de assinaturas: estado/histórico e solicitação de
    cancelamento/reembolso ao provedor, sem editar `subscription_status`.
  - Estatísticas de uso: usuários ativos, leis mais lidas e conversão
    free → pago; texto de busca não é armazenado no schema transacional.
  - Nenhuma tela do painel administrativo do SaaS permite editar `leis`, `versoes_lei`, `dispositivos` ou qualquer conteúdo normativo — essa é uma linha vermelha arquitetural reafirmada aqui, não apenas em `../architecture/SYSTEM_ARCHITECTURE.md`.
- Testes: upgrade em sandbox, webhook idempotente, cancelamento ao fim do
  período, autorização por `papel` + `account_status` e auditoria append-only
  das ações administrativas.

### Critério de saída

- Usuário completa o upgrade pelo Checkout Asaas; somente evento autenticado, deduplicado e reconciliado ativa a assinatura.
- Cancelamento de assinatura rebaixa o usuário ao plano gratuito automaticamente ao término do período já pago, sem intervenção manual.
- Painel administrativo permite consultar usuários, assinaturas e estatísticas básicas, sem qualquer caminho de edição de conteúdo normativo disponível na interface nem permitido pela RLS.
- Cartão e Pix funcionam em sandbox; evento duplicado, fora de ordem ou forjado não concede nem remove acesso incorretamente, e a reconciliação periódica repara um webhook perdido.

### Dependências

Todas as fases anteriores, por exigirem uma base de usuários engajados e features de valor comprovado antes de introduzir cobrança. Antes do go-live também são necessários contrato comercial/conta Asaas aprovados, credenciais separadas de sandbox e produção e URLs de webhook configuradas.

---

## Definição de Pronto do MVP

O MVP do Vinculex SaaS é considerado concluído quando **todos** os critérios abaixo são satisfeitos simultaneamente, usando o Código Penal como lei de prova de fogo (mesma lei usada como critério de aceite do MVP do Lex Editor, garantindo que o primeiro conteúdo real disponível para o SaaS seja também o mais estruturalmente complexo entre as leis prioritárias):

| # | Critério de aceite | Fase(s) associada(s) |
|---|---|---|
| 1 | Cadastro por e-mail/senha, login e recuperação de senha funcionam de ponta a ponta contra a instância de produção/staging do Supabase; login via Google OAuth funciona como alternativa. | Fase 0 |
| 2 | O catálogo consome conteúdo real exclusivamente de `api.leis_publicadas`; nenhuma tabela editorial ou lei fora da projeção pública é alcançável. | Fase 1 |
| 3 | O Código Penal é lido de forma estruturada; URLs canônicas por Block ID e redirects de aliases funcionam, e dispositivos revogados são sinalizados. | Fase 1 |
| 4 | A busca retorna resultados relevantes para termos jurídicos comuns e localiza corretamente um artigo específico por número, dentro do orçamento de performance definido. | Fase 2 |
| 5 | Um usuário favorita um dispositivo do Código Penal e o favorito persiste corretamente, restrito por RLS ao próprio usuário. | Fase 3 |
| 6 | Um usuário cria uma nota vinculada a um Block ID do Código Penal. | Fase 4 |
| 7 | Após uma atualização de teste da lei (nova `versao_lei` com o mesmo `block_id` e texto alterado — real, publicada pelo Lex Editor, ou simulada via seed controlado caso o worker ainda não esteja em produção), a nota e o favorito do passo 5–6 permanecem corretamente vinculados e visíveis, sem qualquer ação manual do usuário. | Fase 4 |

Fases 5 (Progresso e Dashboard), 6 (Atualizações Legislativas no SaaS), 7 (Trilhas de Estudo) e 8 (Assinaturas) **não são pré-requisito do MVP** — são evoluções naturais pós-MVP que aprofundam engajamento, retenção e monetização, mas o MVP já entrega valor completo ao permitir que um estudante se cadastre, encontre uma lei complexa de verdade, leia sua estrutura, busque um artigo específico, e registre favoritos e notas pessoais que sobrevivem a atualizações legislativas futuras — a proposta de valor central do produto.
