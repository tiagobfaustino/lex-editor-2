# Tarefas — Feature 011

## Grupo 1 — Contratos, dados e autoridade

- [x] T011-01 Normatizar em `DATA_MODEL.md` os contratos de
  `ProviderRevision`, `LawSourceBindingRevision`, ativação, saúde, evidência de
  teste e auditoria; entregar tipos e schemas runtime no pacote compartilhado.
- [x] T011-02 Criar migrations e repositórios para revisões imutáveis, ponteiro
  ativo, frequência, saúde e eventos append-only, com concorrência otimista e
  uma única revisão ativa por vínculo.
- [x] T011-03 Implementar funções/serviço server-side que derivem o ator,
  exijam papel `administrador` e concedam ao worker somente leitura/registro de
  saúde; provar grants e negações em PostgreSQL descartável.

## Grupo 2 — Registro de adaptadores e ingestão segura

- [x] T011-04 Criar o registro tipado de adaptadores instalados e o vocabulário
  declarativo limitado de origem/detecção, rejeitando regex, seletores,
  templates e opções desconhecidas.
- [x] T011-05 Extrair fetch e adaptador Planalto para a biblioteca Node
  compartilhada por main e worker, preservando SSRF, DNS/redirect, limites e
  snapshots separados sem regressão nas fixtures existentes.
- [x] T011-06 Implementar dry-run pelo caminho real de ingestão, com resultado
  por etapa, digest e redaction; bloquear ativação se adapter, revisão ou teste
  não forem válidos e atuais.

## Grupo 3 — Catálogo e importação desktop

- [x] T011-07 Implementar casos de uso de criar revisão, testar, ativar, pausar,
  arquivar e restaurar, preservando histórico e falhando fechado em conflito.
- [x] T011-08 Resolver a revisão ativa na importação por URL, selecionar o
  adaptador de modo determinístico e vincular IDs de configuração à evidência
  e aos snapshots sem vazar o catálogo para a NormaAST.
- [x] T011-09 Definir IPC/preload mínimos e paginados para leitura e intenção
  administrativa, com schemas, limites, autorização e testes de remetente,
  payload e resposta.

## Grupo 4 — Worker, agendamento e saúde

- [x] T011-10 Fazer o worker carregar somente vínculos ativos/devidos, capturar
  a revisão no job e coletar o conjunto completo de artefatos pelo mesmo
  registro de adaptadores da importação.
- [x] T011-11 Persistir frequência e saúde por vínculo, integrando sucesso,
  falha, backoff, jitter, suspensão temporária e recuperação sem misturar
  `sourceActivationState` e `sourceHealthState`.
- [x] T011-12 Implementar `Verificar agora` idempotente, deduplicado e sujeito
  aos mesmos limites/autoridade do scheduler; provar que pausa/arquivamento
  bloqueiam novos jobs sem invalidar execução já capturada.

## Grupo 5 — UI administrativa

- [x] T011-13 Substituir o placeholder por listagem acessível de provedores e
  vínculos, exibindo revisão, ativação, saúde, frequência, última verificação e
  ações permitidas sem expor dados internos.
- [x] T011-14 Implementar formulário orientado às capacidades do adapter e os
  fluxos de dry-run, ativação, pausa, arquivamento e restauração, com validação
  inline, confirmação, foco, teclado e tratamento de conflito.

## Grupo 6 — Validação ponta a ponta e encerramento

- [x] T011-15 Cobrir SSRF, IDNA/host semelhante, DNS rebinding, redirect, porta,
  MIME, tamanho, regra abusiva, autorização, concorrência e sucesso falso com
  testes automatizados offline.
- [x] T011-16 Demonstrar em integração/E2E que uma nova origem de teste
  compatível com o adapter Planalto é cadastrada pela UI e usada por importador
  e worker sem alteração de código.
- [x] T011-17 Revalidar offline as Leis nº 9.099/1995, nº 9.605/1998 e
  nº 10.826/2003 com funções/variantes corretas; executar lint, typecheck,
  testes, suíte SQL e acessibilidade aplicáveis.
- [x] T011-18 Atualizar documentação afetada, executar `graphify update .`,
  registrar evidências/desvios permanentes em `review.md` quando existirem e
  encerrar somente após todos os critérios de aceite.
