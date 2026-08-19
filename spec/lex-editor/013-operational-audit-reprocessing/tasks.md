# Tarefas — Feature 013

## Grupo 1 — Contrato, redação e persistência append-only

- [x] T013-01 Implementar o pacote puro de eventos operacionais com envelope
  versionado, códigos/contextos discriminados, schemas runtime, limites e
  projeção segura, sem mapa arbitrário.
- [x] T013-02 Implementar redação por allowlist e testes que rejeitem secrets,
  headers, URLs assinadas, paths, stacks, HTML/XML, AST e conteúdo de usuário em
  emissão, persistência, consulta e erro.
- [x] T013-03 Implementar diário local append-only com sequência/cadeia de
  hashes, escrita durável, reabertura e detecção de truncamento/adulteração sem
  reparo silencioso.
- [x] T013-04 Acrescentar eventos privados append-only, projeções e grants
  mínimos para publisher, worker e catálogo onde os registros existentes não
  preservarem a sequência exigida; validar migrations em PostgreSQL descartável.

## Grupo 2 — Instrumentação e correlação ponta a ponta

- [x] T013-05 Emitir eventos correlacionados de importação, extração, parsing,
  identificação, validação e exportação no desktop, incluindo caminhos felizes,
  bloqueios, cancelamento e falha redigida.
- [x] T013-06 Instrumentar aprovação, release candidate, promoção, sync, retry e
  rollback no publisher sem duplicar terminal ou transformar tentativa em
  publicação concluída.
- [x] T013-07 Instrumentar detecção/revisão/reprocessamento legislativo e
  administração/saúde de fontes, preservando as autoridades e IDs existentes.

## Grupo 3 — Pesquisa federada e UI

- [x] T013-08 Implementar providers, merge determinístico, instante de corte,
  cursor composto opaco, filtros/limites e completude
  `complete | local_only | partial`, inclusive com relógios empatados e provider
  indisponível.
- [x] T013-09 Entregar contratos IPC/preload de consulta, detalhe e timeline com
  remetente/papel/schema/tamanho autorizados e respostas menores que o evento
  interno.
- [x] T013-10 Construir a tela acessível de Logs/Diagnóstico com filtros por lei,
  módulo, nível, período e categoria, paginação, estados parcial/offline e
  navegação por correlação.

## Grupo 4 — Incidentes e evidência restrita

- [x] T013-11 Correlacionar eventos de erro em incidentes append-only e derivar
  `incident_resolution_state`, causa/nota auditada e ações disponíveis sem
  `status` genérico.
- [x] T013-12 Implementar localizadores opacos e abertura autorizada de trecho
  limitado com hash/faixa, filesystem seguro ou provider remoto, descarte do
  estado volátil e auditoria do acesso.
- [x] T013-13 Integrar incidente a projeto, dispositivo, publicação e pendência
  por IDs opacos, com foco/teclado e sem deep link de protocolo, path ou URL
  privilegiada.

## Grupo 5 — Reprocessamento seguro

- [x] T013-14 Implementar intenção, lock, idempotência, workspace candidato e
  recuperação para os planos `from_source_snapshot` e
  `from_identified_revision`.
- [x] T013-15 Integrar verificação de snapshot, pipeline, reconciliação de Block
  IDs e replay editorial com conflito explícito; falha preserva integralmente a
  revisão corrente.
- [x] T013-16 Implementar validação e promoção local atômica, invalidação de
  aprovação, cancelamento seguro e recuperação de crash antes/depois do ponteiro.
- [ ] T013-17 Correlacionar a solicitação/claim/resultado do reprocessamento do
  worker existente, sem executar job remoto ou ampliar autoridade no Electron.

## Grupo 6 — Validação ponta a ponta e encerramento

- [x] T013-18 Testar matriz de schemas, redação, adulteração, paginação,
  completude, autorização, evidência, ambos os planos, conflito, crash, retry,
  concorrência e offline; executar migrations e checks de segurança/bundle.
- [x] T013-19 Executar E2E por teclado de pesquisa → incidente → evidência →
  reprocessamento → preview e localizar uma publicação real com até três
  filtros.
- [ ] T013-20 Reprocessar as Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003
  nos perfis completo/vigente, comprovar texto/IDs/Markdown canônicos, atualizar
  documentação e Graphify e encerrar somente sem aceite pendente. Reprocessamento
  e documentação feitos; **não encerrada** — T013-17 permanece pendente (ver
  `docs/contexto/06-pendencias-e-riscos.md`), então há aceite pendente e a
  feature continua `in_progress`.
