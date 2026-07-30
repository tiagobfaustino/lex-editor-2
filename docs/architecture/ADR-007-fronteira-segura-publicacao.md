# ADR-007: Fronteira segura e autoridade server-side de publicação

## Status

Aceito — 2026-07-30

## Contexto

O Lex Editor é um aplicativo Electron que processa HTML de terceiros, permite
edição e aciona um fluxo capaz de alterar conteúdo jurídico público. Mesmo com
uso interno, seu renderer continua sendo uma superfície web: XSS, dependência
comprometida, IPC excessivamente amplo, URL maliciosa ou arquivo local
preparado podem tentar alcançar filesystem, Git ou credenciais.

A chave administrativa/secret do Supabase ignora RLS. Portanto, armazená-la no
Electron — no renderer, preload, processo principal, `.env`, bundle ou
armazenamento local — transformaria qualquer comprometimento da estação em
autoridade irrestrita sobre o banco de produção. RLS não mitiga esse caso.

Também é insuficiente confiar apenas em “o botão estava oculto” ou “o commit
veio do Lex Editor”: autorização precisa ser revalidada no servidor e o
conteúdo precisa ser vinculado ao manifesto aprovado.

## Decisão

### 1. Zonas de confiança

1. **Renderer Electron — não confiável.** Renderiza DTOs mínimos, coleta
   intenção do usuário e solicita capacidades nomeadas via preload. Não recebe
   segredos, HTML bruto, AST integral, seletores, caminhos reais, tokens, Git
   credentials ou clientes administrativos.
2. **Preload — ponte mínima.** Expõe funções específicas e versionadas, nunca
   `ipcRenderer`, filesystem, shell, processo, cliente Git/Supabase ou canal
   genérico.
3. **Processo principal — privilegiado apenas na estação.** Pode ler fontes,
   operar o repositório de trabalho e preparar artefatos, mas não possui chave
   administrativa do Supabase nem autoridade final de produção.
4. **Serviço de Publicação — autoridade de produção.** Workload server-side
   isolado que valida aprovação, release candidate, manifesto e hashes,
   promove o commit exato ao branch protegido e executa a transação de
   publicação.
5. **Worker de atualização — produtor de propostas.** Possui somente acesso à
   fonte e à API/função de criação de pendências. Não escreve conteúdo
   normativo, não promove branch e não chama a função de publicação.
6. **Vinculex SaaS — consumidor.** Usa apenas `anon`/sessão de usuário e
   superfícies públicas controladas. Nunca recebe identidade editorial ou
   administrativa.

### 2. Identidades e credenciais

- A credencial administrativa/secret do Supabase existe somente no Serviço de
  Publicação, como secret do ambiente hospedado. Ela nunca é distribuída com o
  Electron.
- Preferencialmente, o publicador usa uma role Postgres dedicada com
  `EXECUTE` somente sobre uma função privada transacional de publicação. Se a
  secret administrativa for necessária no MVP, permanece isolada nesse
  serviço; como ela ignora RLS, todas as validações desta ADR continuam
  obrigatórias.
- O Editor Jurídico autentica-se com identidade individual. A aprovação é um
  registro server-side ligado a `user_id`, `publicationId`, digest do
  manifesto e timestamp; o papel editorial é conferido novamente no momento da
  aprovação e da publicação.
- A credencial Git da estação só pode criar/enviar o branch candidato
  `refs/heads/releases/{publicationId}`. O branch canônico é protegido e apenas
  a identidade do Serviço de Publicação pode promover o SHA validado.
- Credenciais locais usam SSH agent/credential manager do sistema operacional.
  Não são aceitas em campos de UI, argumentos de linha de comando, arquivos do
  projeto ou `.env` de produção.
- Desenvolvimento, staging e produção usam projetos Supabase, repositórios,
  roles e secrets distintos. Um build de desenvolvimento não consegue
  publicar em produção.

### 3. Protocolo de publicação

1. O processo principal prepara Markdown, `UPDATE.md` e manifesto; persiste o
   diário local com permissão restrita e mostra ao renderer apenas o resumo.
2. A confirmação humana cria uma aprovação server-side para o digest exato.
   Alterar qualquer byte invalida essa aprovação.
3. O processo principal cria o release commit e o envia ao branch candidato
   derivado do `publicationId`; não escreve no branch canônico.
4. O Serviço de Publicação recebe `publicationId` e SHA, busca o commit
   diretamente no Git e valida:
   - identidade/papel do aprovador e digest aprovado;
   - branch candidato e commit-base esperados;
   - uma única lei e apenas caminhos permitidos;
   - schema e imutabilidade do manifesto;
   - hashes de Markdown, `UPDATE.md`, AST e snapshot;
   - SemVer, `numero_publicacao`, Block IDs, redirects e validações estruturais;
   - ausência de secrets, artefatos inesperados e symlinks no diff;
   - `versao_publicada_id` ainda igual à base aprovada.
5. Só então promove o SHA exato ao branch canônico protegido e executa a função
   transacional de publicação. A função bloqueia a lei, reconfirma
   concorrência/idempotência e troca o ponteiro público somente no final.
6. O serviço retorna apenas resultado e identificadores seguros. Logs e erros
   nunca devolvem secrets ou payloads internos ao renderer.

Push do candidato, aprovação editorial e publicação são eventos distintos.
Nenhum deles, isoladamente, torna conteúdo visível ao SaaS.

### 4. Baseline obrigatório do Electron

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` e
  `webSecurity: true` em produção.
- Conteúdo da aplicação carregado apenas do bundle local; sem código remoto,
  `eval`, `webview` ou navegação arbitrária.
- CSP de produção restritiva: scripts/estilos locais, `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'`; rede do renderer desabilitada.
- Toda navegação, nova janela e pedido de permissão é negado por padrão.
  Links externos passam por parser de URL e allowlist de `https` antes de
  `shell.openExternal`.
- Todo handler IPC valida `senderFrame`, frame principal, origem local exata,
  schema de entrada, tamanho e autorização da operação. Não existem canais
  genéricos como `execute`, `shell`, `readFile`, `writeFile`, `git` ou
  `supabase`.
- O build ativa fuses de produção, incluindo carregamento exclusivo do ASAR e
  validação de integridade quando suportada, e é assinado por plataforma.
  Atualizações automáticas, se adotadas, também exigem assinatura válida.

### 5. Filesystem, Git e importação

- Paths são resolvidos no processo principal a partir de raízes configuradas e
  comparados por `realpath`; traversal, path absoluto vindo do renderer,
  symlink que escape da raiz e arquivo especial são rejeitados.
- Escritas usam arquivo temporário na mesma raiz, `fsync` quando necessário e
  rename atômico. Diário, snapshots e credenciais auxiliares usam a permissão
  mais restrita suportada pelo sistema.
- Git é chamado por biblioteca ou processo com `shell: false` e argumentos em
  array. Texto, sigla, path ou mensagem oriundos do conteúdo nunca são
  interpolados em comando shell.
- Importação HTTP aceita apenas `http`/`https`, com allowlist por fonte. O
  processo principal bloqueia loopback, redes privadas/link-local, endpoint de
  metadados de nuvem e redirecionamentos para destinos proibidos; revalida DNS
  e destino em cada salto; limita tamanho, tempo, redirects e tipo de conteúdo.
- HTML/XML bruto é dado, nunca código: não é aberto em `BrowserWindow`, não
  executa scripts e não é inserido no DOM. Preview usa somente projeção
  sanitizada derivada da NormaAST.

### 6. Banco, API e superfícies públicas

- Grants e RLS são aplicados em conjunto. `anon` e `authenticated` não recebem
  escrita em tabelas normativas nem acesso a tabelas/editorial artifacts
  internos.
- `updates_legislativos`, `publicacoes`, registros de Block IDs, evidência de
  parsing e URIs de snapshots permanecem em schema privado ou sem grants da
  Data API.
- O SaaS lê views/RPCs explícitas que projetam somente colunas públicas e a
  versão apontada por `leis.versao_publicada_id`; não consulta tabelas
  editoriais base diretamente.
- Funções `SECURITY DEFINER`, quando inevitáveis, vivem fora de schemas
  expostos, usam `search_path = ''`, nomes totalmente qualificados, ownership
  dedicado e `EXECUTE` revogado de `PUBLIC`, `anon` e `authenticated`.
- A função privada de publicação valida a identidade do chamador server-side e
  não é invocável pelo cliente SaaS, renderer, usuário editorial comum ou
  worker.

### 7. Logs, auditoria e retenção

- Logs usam allowlist de campos. Tokens, cookies, Authorization headers,
  secrets, URLs assinadas, credenciais Git, HTML/XML bruto, AST completa e
  conteúdo de notas de usuários são sempre removidos.
- Erros de parser registram `sourceArtifactSha256`, `fragmentSha256`,
  identificadores e faixa de origem; trecho literal é acessível apenas por ação
  editorial autorizada, com tamanho limitado, não copiado para telemetria.
- Eventos de aprovação/publicação são append-only e incluem ator, papel,
  `publicationId`, digests, SHA, transições e resultado. O texto público do
  `UPDATE.md` não substitui a auditoria privada.
- Snapshots e logs possuem política explícita de retenção, acesso e descarte;
  crash reports passam pela mesma redação antes de sair da estação.

## Verificações obrigatórias

- XSS no preview não alcança IPC privilegiado, filesystem ou tokens.
- IPC forjado por frame/origem inválida é rejeitado.
- Tentativas de traversal, symlink escape e injeção de argumento Git falham.
- URLs para localhost, rede privada, metadata service e redirect proibido são
  bloqueadas.
- Renderer, usuário SaaS, Editor Jurídico e worker não conseguem escrever
  tabelas normativas diretamente.
- Commit/manifesto adulterado, aprovação de outro digest, replay, base obsoleta
  ou paths extras bloqueiam a promoção.
- Falha no meio da transação não muda `versao_publicada_id`.
- Logs, crash reports e DTOs IPC passam por teste automatizado de ausência de
  secrets e payloads proibidos.
- Build de produção confirma fuses, assinatura, CSP e preferências seguras da
  `BrowserWindow`.

## Consequências

**Positivas**

- Comprometer o renderer ou a estação não entrega automaticamente autoridade
  administrativa sobre o Supabase.
- Git protegido, aprovação server-side, manifesto e transação formam defesas
  independentes.
- Cada identidade tem privilégio verificável e testável.

**Trade-offs aceitos**

- Publicação passa a depender de um pequeno serviço server-side e de branch
  protegido.
- Operação exige gestão de roles, secrets, assinatura de builds e testes de
  segurança.
- O processo principal continua sendo privilegiado localmente; por isso
  isolamento Electron, validação IPC e proteção do filesystem permanecem
  obrigatórios mesmo sem a secret de produção.

## Referências

- Electron, `docs/tutorial/security.md` e `docs/tutorial/asar-integrity.md`.
- Supabase, guias “Securing your API”, “Row Level Security”, “Database
  Functions” e migração para secret keys.
