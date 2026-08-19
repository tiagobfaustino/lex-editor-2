# Pendências e Riscos

> Levantado em 2026-08-04. Pendência é trabalho previsto e ainda não feito;
> dívida é algo que já está no repositório e precisa de correção; risco é o que
> pode dar errado adiante.

> Atualização em 2026-08-14: as Features 001–012 estão concluídas e a Feature
> 013 está ativa como `in_progress`. As seções datadas abaixo permanecem como histórico; o
> estado operacional atual está no `spec/FEATURE_INDEX.md` e nos `review.md` das
> features encerradas.

## Resolvido em 2026-08-04

Dois bloqueadores que este documento registrava foram corrigidos e ficam aqui
como histórico:

- **`format:check` travava o pre-commit.** O Prettier reprovava os cinco
  arquivos de `exemplos/` — textos legais que não devem ser reformatados. Como
  o hook roda `lint && format:check`, nenhum commit passava sem `--no-verify`.
  `exemplos/` entrou no `.prettierignore`.
- **Todo o código estava fora do controle de versão.** O histórico parava em
  `dbc1416`, uma entrega só de documentação. `src/`, `packages/`, `tests/`, as
  configurações, a ADR-009 e o realinhamento documental entraram em dez commits
  na `master`.

## Resolvido em 2026-08-05

A Feature 001 foi fechada: T001-08 a T001-10 concluídas e os cinco critérios
de aceite demonstrados.

- **T001-08** — smoke E2E com Playwright/Electron sobre o app compilado
  (8 testes, inclusive preferências seguras da janela e allowlist IPC).
- **T001-09** — `electron-builder` escolhido, fuses aplicados e conferidos no
  binário por `scripts/inspect-bundle.mjs`, e CI mínima em
  `.github/workflows/ci.yml` (validate, e2e e package), verde na primeira
  execução. O que o script prova é o bit gravado de cada fuse, incluindo
  `EnableEmbeddedAsarIntegrityValidation`; ele não prova que a validação de
  integridade seja exercida em runtime — veja a dívida sobre integridade do
  asar no Linux.
- **T001-10** — todos os comandos executados (locais e no CI), bundle
  inspecionado (350 entradas no asar, apenas `zod` embarcado, sem AST, HTML
  bruto, paths ou secrets) e pacote aberto manualmente na estação de
  desenvolvimento.

Divergência resolvida durante a T001-09: a inspeção inicial esperava o fuse
`GrantFileProtocolExtraPrivileges` desligado, mas um A/B empírico mostrou que o
renderer deste app é servido por `file://` dentro do asar e o fuse precisa
ficar ligado (`electron-builder.yml` já estava correto; o `inspect-bundle.mjs`
é que tinha a expectativa errada e foi corrigido).

## Feature 001 — encerramento histórico

Nada. T001-08 a T001-10 estão concluídas, os cinco critérios de aceite estão
marcados no `spec.md` e a feature está `done` no `FEATURE_INDEX.md`. O que
ficou em aberto não bloqueava o fechamento e está no `review.md` da feature.

## Resolvido até 2026-08-12 — Features 002–010

O roadmap que este documento originalmente apresentava como futuro foi
implementado e validado. Em particular:

- **Feature 006 — revisão editorial e validação:** correções tipadas, diário e
  replay, validações bloqueantes, aprovação vinculada à revisão, exportação em
  lote e `UPDATE.md` determinístico;
- **Feature 007 — publicação segura:** release candidate, autoridade
  server-side, promoção por SHA, sincronização transacional, idempotência,
  recuperação e rollback para frente;
- **Feature 008 — atualizações legislativas:** worker sem autoridade de
  publicação, projeção e diff normativos, fila deduplicada e decisão editorial
  antes de encaminhar uma nova revisão à publicação.

As evidências e decisões permanentes estão nos respectivos `review.md`. As
Features 009–010 acrescentaram as projeções completa/vigente e as referências
jurídicas navegáveis.

## Resolvido em 2026-08-14 — Feature 011

A configuração e o catálogo de fontes oficiais deixaram de ser uma pendência.
O Administrador Técnico pode criar revisões imutáveis de provedor e vínculo,
testar pelo mesmo fetch/adaptador da ingestão real e só então ativar, pausar,
arquivar ou restaurar. Importador e worker capturam a mesma revisão ativa; os
estados de ativação e saúde permanecem separados.

A matriz offline cobre SSRF, IDNA/host semelhante, DNS rebinding, redirect,
porta, MIME, tamanho, regra abusiva, autorização, concorrência e sucesso falso.
O corte E2E cadastra pela UI uma origem Planalto compatível sem `www`, ativa-a
e a usa na importação. As Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003
foram revalidadas com funções e variantes explícitas.

## Escopo concluído desde o levantamento

As Features 002–012 implementaram o domínio jurídico, parser, Block IDs,
Formatter, importação/preview/exportação, revisão editorial, publicação segura,
atualizações legislativas, projeções completa/vigente e referências jurídicas
navegáveis, catálogo versionado de fontes oficiais e edição validada de
metadados. A Feature 013 está ativa e cobre o RF-23, diagnóstico de incidentes
e reprocessamento seguro.

## Dívidas menores

- **`test:boundaries` fora do `npm test`.** O script existe e passa, mas não
  entra na suíte padrão; o CI o executa explicitamente, então o risco de
  esquecimento local ficou coberto.
- **Integridade do asar não é exercida no Linux.** O fuse
  `EnableEmbeddedAsarIntegrityValidation` está ligado e o
  `scripts/inspect-bundle.mjs` confere o bit, mas o `package.json` dentro do
  `app.asar` não tem bloco `ElectronAsarIntegrity`: o electron-builder só
  emite esse metadado para macOS e Windows. Como o Linux é a única plataforma
  empacotada até aqui, não há hash a validar e o fuse é inócuo. A ADR-007 §4
  pede validação de integridade "quando suportada", então a configuração está
  conforme — o que falta é construir em macOS/Windows para que a proteção
  passe a valer, e então reconferir com o mesmo script.
- **Playwright não dirige o binário empacotado, e nunca vai dirigir.** Não é
  limitação da estação: o launcher passa `--inspect=0` e espera a linha
  `Debugger listening on ws://…`, que o fuse `enableNodeCliInspectArguments:
  false` impede de existir. Um A/B no artefato confirmou — ligando só esse
  fuse o launch conecta, desligando volta a expirar. O fuse deve continuar
  desligado, então o smoke roda sobre o app compilado com configuração
  equivalente à produção, conforme o `playwright.config.ts`. Detalhes e
  consequências no `review.md` da Feature 001.
- **Ações de CI em `@v4` (resolvido em 2026-08-12).** O workflow usa
  `actions/checkout@v5` e `actions/setup-node@v5`, compatíveis com o runtime
  atual dos runners hospedados.
- **Tokens visuais são baseline.** Os valores oficiais de marca do Vinculex
  precisam substituir as cores atuais antes de a UI ser considerada pronta. A
  semântica dos nomes não muda.
- **`.playwright-mcp/`** existe como diretório de ferramenta local e já está no
  `.gitignore`; não tem relação com a T001-08.

## Pendência aberta — T013-17 (correlação do reprocessamento do worker)

Levantado em 2026-08-19, durante o Grupo 5 da Feature 013. T013-17 pede para
correlacionar solicitação/claim/resultado do reprocessamento já existente do
worker de atualização legislativa. Investigação encontrou que **o contrato de
correlação já existe e já está completo**, só não em TypeScript:

- `supabase/migrations/20260811160000_legislative_update_queue.sql` (Feature
  008, anterior a esta sessão) já define
  `private.request_legislative_update_reprocess(p_update_id, p_actor_user_id)`
  e `private.claim_legislative_update_reprocess_requests(p_limit)` — um claim
  `SELECT ... FOR UPDATE SKIP LOCKED` — e ambos já inserem em
  `private.legislative_update_events` com `event_type` `reprocess_requested` /
  `reprocess_claimed`, chaveado por `update_id`.
- `supabase/migrations/20260815120000_operational_audit_projection.sql`
  (Feature 013, T013-04) já expõe essas linhas via
  `private.list_legislative_update_audit_events` /
  `get_legislative_update_audit_event`, com `update_id` como
  `correlation_id`.

O que falta é uma camada acima: **nenhum código TypeScript chama essas duas
funções SQL**. `services/update-worker/src/queue.ts` só tem
`InMemoryLegislativeUpdateQueue` (referência/teste); não existe um
`LegislativeUpdateQueue` de produção sobre Postgres. `src/main/index.ts` nunca
passa `updateCapabilities` para `registerIpcHandlers` — a capacidade
`reprocessUpdate` sempre cai no stub `unavailable` — e o processo principal do
Electron não tem hoje nenhuma conexão com Supabase/Postgres (`grep` por
`createClient`/`@supabase/supabase-js` em `src/main/` não encontra nada).

Construir essa camada (um `LegislativeUpdateQueue` de produção + a primeira
conexão do Electron a um banco) é uma decisão de arquitetura própria —
credencial, papel de acesso, política de rede — e não uma tarefa de "só
correlacionar eventos". Por isso T013-17 ficou registrada como pendência em
aberto em vez de fechada nesta sessão; ver `spec/lex-editor/013-operational-audit-reprocessing/tasks.md`.

## Riscos adiante

### Regressão de parser (crítico)

É o maior risco técnico do projeto, reconhecido em `SYSTEM_ARCHITECTURE.md`. Um
erro de reconhecimento produz texto jurídico incorreto que chega ao estudante.
Mitigação já decidida: validar contra leis reais e complexas — não fixtures
sintéticas — com dispositivos revogados, vetados e redações dadas por leis
posteriores; e exigir revisão humana obrigatória para todo nó de baixa
confiança, que não pode chegar silenciosamente à fase `identified`.

### Ambiguidade entre fontes oficiais (crítico, mitigado)

A ADR-009 e as Features 008–009 implementam e testam a separação entre fonte
compilada vigente e página anotada/histórica. Conflitos continuam exigindo
decisão editorial explícita e permanecem um risco de regressão a ser coberto
pelas fixtures reais.

### Colisão e estabilidade de Block ID (crítico)

O ID precisa sobreviver a alteração de texto, revogação, renumeração e inserção
de dispositivo intermediário (`Art. 121-A` entre 121 e 122). Um ID instável
quebra links do Obsidian, notas e favoritos já ancorados no SaaS.

### Fronteira de segurança do Electron (alto)

A fronteira agora inclui importação por URL e arquivo, estado editorial,
publicação, atualizações, catálogo de fontes e navegação jurídica. As
capacidades usam contratos nomeados, validação runtime, remetente/frame
autorizado e DTOs mínimos; os testes cobrem SSRF/redirect/DNS rebinding,
traversal/symlink, argumentos Git e ausência de paths, AST e secrets no
renderer. O risco residual é uma nova integração contornar esse padrão criando
canal ou executor genérico.

### Overengineering visual (baixo, já mitigado)

Registrado no `spec.md` da Feature 001 e mitigado limitando a UI ao shell
necessário.

## Próxima sequência

1. Manter a suíte e as fixtures reais das Features 001–012 verdes.
2. Executar a Feature 013 por grupos na ordem definida em `tasks.md`.
3. Tratar as dívidas menores acima sem misturá-las ao RF-23 ou ao
   reprocessamento seguro.
