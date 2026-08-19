# Feature 013 — Auditoria operacional, diagnóstico e reprocessamento

## Metadados

- `implementation_status`: in_progress
- `priority`: P2
- `owner`: não atribuído

## Objetivo

Permitir que o Administrador Técnico encontre, correlacione e investigue os
eventos de importação, parsing, Block IDs, validação, publicação, atualização e
catálogo por uma interface pesquisável. A partir de um incidente, ele deve
abrir somente a evidência restrita necessária e solicitar reprocessamento
seguro, sem perder a última revisão válida nem ampliar a autoridade do desktop.

## Problema

O painel atual mostra diagnósticos da revisão aberta, enquanto publisher,
worker e catálogo preservam registros próprios. Não existe uma consulta
unificada e durável que atenda ao RF-23, nem correlação ponta a ponta entre uma
falha, seu artefato, a tentativa de recuperação e o resultado.

O User Flow 7 também prevê reprocessar a lei a partir da fronteira correta.
Executar novamente o pipeline sobre o projeto corrente sem uma candidata
isolada poderia descartar correções editoriais, recalcular IDs publicados ou
deixar estado parcial após crash.

## Escopo

- Contrato versionado e redigido de eventos operacionais, com contextos
  discriminados por código e schemas runtime compartilháveis pelas workloads.
- Diário local append-only e verificável para eventos do desktop.
- Projeções append-only ou adaptadores seguros para publisher, worker de
  atualização e catálogo de fontes.
- Consulta federada, paginada e pesquisável por lei, módulo, nível, período,
  código/categoria e correlação, indicando completude das origens.
- Tela acessível de Logs/Diagnóstico com filtros, detalhe do evento, linha do
  tempo do incidente e links seguros para projeto, dispositivo ou tentativa.
- Abertura autorizada e auditada de trecho limitado de artefato restrito por
  localizador opaco, hash e faixa.
- Reprocessamento local pelos planos `from_source_snapshot` e
  `from_identified_revision`, com candidata isolada, reconciliação, replay,
  validação e promoção atômica.
- Integração da solicitação de reprocessamento já existente para pendências do
  worker, sem executar o worker dentro do Electron.
- Funcionamento offline para eventos e projetos locais, com estado parcial
  explícito quando as origens remotas não estiverem disponíveis.

## Fora do escopo

- Telemetria externa, SIEM, upload de crash report ou monitoramento de produto.
- Expor `console.log`, stack, filesystem, shell, SQL, HTML/XML bruto, AST ou
  snapshot integral ao renderer.
- Busca textual dentro de artefatos restritos ou exportação do audit log.
- Corrigir automaticamente parser, regra jurídica ou conflito editorial.
- Reprocessamento automático disparado por evento, publicação automática ou
  alteração da versão já publicada.
- Definir política de descarte dos eventos; a retenção inicial é indefinida
  conforme a ADR-014.
- Logs e analytics do Vinculex SaaS voltados ao usuário final.

## Dependências

- Features 005, 006, 007, 008, 011 e 012.
- `../../../docs/architecture/ADR-005-status-fields.md`.
- `../../../docs/architecture/ADR-007-fronteira-segura-publicacao.md`.
- `../../../docs/architecture/ADR-014-auditoria-operacional-e-reprocessamento.md`.
- `../../../docs/architecture/UPDATE_PIPELINE.md`, seção 9.
- `../../../docs/lex-editor/PRD.md`, RF-23, RNF-05 e RNF-12.
- `../../../docs/lex-editor/USER_FLOWS.md`, fluxo 7.

## Requisitos

- RF-013-01: definir envelope de evento versionado, união discriminada de
  contextos e schemas runtime que rejeitem módulo, código ou campo não
  permitido, sem objeto arbitrário atravessando processos.
- RF-013-02: emitir eventos correlacionados para importação, parsing,
  identificação, validação, publicação, atualização legislativa e catálogo,
  incluindo duração, contagens e hashes apenas quando previstos pela allowlist.
- RF-013-03: persistir eventos do desktop em diário append-only com sequência e
  cadeia de hashes; adulteração ou truncamento torna a origem incompleta e gera
  falha explícita, sem reparo silencioso.
- RF-013-04: projetar eventos autoritativos de publisher, worker e catálogo sem
  conceder ao desktop escrita em suas stores nem duplicar conteúdo restrito.
- RF-013-05: pesquisar eventos com filtros tipados, corte estável, cursor opaco,
  limites de intervalo/página e indicação `complete | local_only | partial`.
- RF-013-06: exibir lista, filtros, contadores e linha do tempo por correlação
  com teclado, foco, rótulos e estados vazio, carregando, parcial e erro.
- RF-013-07: relacionar falhas a um `incidentId` e derivar
  `incident_resolution_state` da sequência append-only, sem campo `status`
  genérico nem edição do evento original.
- RF-013-08: abrir trecho restrito somente por capacidade separada, papel
  administrativo comprovado, localizador opaco, faixa e tamanho limitados;
  registrar o acesso sem devolver path, URI ou snapshot integral.
- RF-013-09: iniciar reprocessamento local somente por plano nomeado, revisão
  esperada e motivo, com lock por projeto e idempotência por solicitação.
- RF-013-10: no plano `from_source_snapshot`, validar snapshots, construir
  candidata isolada, reconciliar IDs e reaplicar o diário; conflito preserva a
  revisão anterior e exige decisão humana.
- RF-013-11: no plano `from_identified_revision`, recalcular apenas derivados,
  Formatter e validação, sem alterar texto jurídico, identidade ou Block IDs.
- RF-013-12: promover a candidata local em gravação durável e atômica somente
  após validação integral, invalidando validação/aprovação anterior; crash ou
  cancelamento nunca deixam revisão híbrida.
- RF-013-13: solicitar reprocessamento remoto pelo contrato idempotente da fila
  da Feature 008 e refletir solicitação, claim e resultado na mesma correlação.
- RF-013-14: redigir eventos, erros, crash reports e DTOs por allowlist e
  impedir que renderer, editor comum ou worker ampliem leitura/escrita por IPC
  direto ou chamada de serviço.

## Invariantes

- Evento de auditoria confirmado é append-only e nunca é reescrito pela UI.
- Consulta parcial nunca aparece como histórico completo nem como prova de
  sucesso de publicação ou reprocessamento.
- Diagnóstico da revisão e evento operacional permanecem conceitos distintos.
- Evento, cursor e localizador não revelam path, URI interna ou conteúdo bruto.
- O ator e o papel vêm da autoridade que executa a ação, nunca do renderer.
- Reprocessamento não toca a versão publicada e não autoriza publicação.
- A revisão corrente só muda depois da promoção atômica da candidata válida.
- Block IDs publicados e correções editoriais confirmadas não são descartados
  silenciosamente por reprocessamento.
- Retry da mesma solicitação não duplica evento terminal nem promoção.

## Cenários essenciais

### Localizar uma publicação

Dada uma lei com importação, revisão e publicação concluídas, quando o
Administrador filtra pela lei, módulo de publicação e período, então encontra
em até três filtros a correlação completa da publicação, com SHA e resultado
redigidos, sem AST, path ou credencial.

### Investigar falha de parsing

Dado um parser que falhou sobre snapshot íntegro, quando o Administrador abre o
incidente, então vê código, etapa, hashes e faixa; após autorização explícita,
abre somente o trecho limitado correspondente e esse acesso entra na auditoria.

### Reprocessar a partir do snapshot

Dado um projeto com correções editoriais e uma nova versão do parser, quando o
Administrador solicita `from_source_snapshot`, então uma candidata é criada em
isolamento, as correções são reaplicadas e os Block IDs reconciliados; somente
o resultado válido substitui a revisão de trabalho e exige nova aprovação.

### Conflito e crash

Dado um comando editorial que não pode ser reaplicado ou um encerramento antes
da promoção, quando o projeto é reaberto, então a revisão anterior permanece
íntegra, o incidente registra a falha e retry não duplica eventos nem estado.

### Auditoria offline

Dado o aplicativo sem rede, quando o Administrador pesquisa um projeto local,
então recebe eventos locais pesquisáveis com completude `local_only`; eventos
remotos não são ocultados como inexistentes.

## Critérios de aceite

- [x] Amostras de todas as sete categorias usam envelope válido e contexto
  permitido, sem secrets, headers, conteúdo bruto, AST, paths ou stacks.
- [x] Eventos locais sobrevivem a reabertura, mantêm ordem/correlação e uma
  entrada adulterada é detectada sem truncar ou reescrever o diário.
- [x] Um Administrador localiza uma publicação de lei real com no máximo três
  filtros e percorre sua correlação por cursor estável. Verificado em
  `tests/e2e/audit-reprocessing-workflow.spec.ts` filtrando a importação da
  LINDB (lei real, não fixture sintética); não existe evento de publicação
  correlacionável localmente porque a origem `publisher` não é alcançável a
  partir do Electron (mesma raiz da pendência de T013-17).
- [x] Consulta offline/parcial identifica as origens indisponíveis; retomada de
  rede não duplica nem desloca a página em curso.
- [x] Incidente de parsing mostra código, etapa, hashes e faixa; trecho restrito
  exige autorização e não expõe path, URI ou snapshot integral.
- [x] Papel inadequado, IPC forjado, cursor/localizador adulterado e faixa ou
  intervalo excessivos falham com erro redigido e sem efeito.
- [x] `from_source_snapshot` preserva correções compatíveis e Block IDs; conflito
  ou falha mantém integralmente a revisão anterior.
- [x] `from_identified_revision` regenera preview/Markdown canônico sem mudar
  texto jurídico, identidade, Block IDs ou hash normativo.
- [x] Crash antes/durante/depois da gravação e retry concorrente comprovam
  atomicidade, recuperação e idempotência do reprocessamento.
- [ ] Reprocessar uma pendência do worker usa request/claim existentes, não
  publica e aparece na mesma linha do tempo de auditoria. **Pendente**: o
  contrato de correlação já existe no banco (Feature 008 + T013-04), mas
  nenhum código TypeScript o aciona e o Electron não tem conectividade com
  banco — ver `docs/contexto/06-pendencias-e-riscos.md`.
- [x] Fluxo E2E por teclado cobre filtrar, abrir incidente, consultar trecho,
  reprocessar, acompanhar resultado e voltar ao preview.
- [x] As Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003 permanecem canônicas
  nos perfis completo/vigente após ambos os planos sem mudança de fonte.

## Validação mínima

- Risco: crítico para fidelidade, Block IDs e prova de publicação; alto para
  persistência, autorização, retenção e recuperação; médio para pesquisa/UI.
- Testes unitários de schemas, redação, cadeia de hashes, filtros, merge,
  ordenação, cursor, completude, incidentes e planos de reprocessamento.
- Integração com diário local, publisher, worker, catálogo, snapshots, diário
  editorial, reconciliação, validação, Formatter e recuperação após crash.
- Testes negativos de IPC, papel, payload extra, cursor/localizador, faixa,
  tamanho, conteúdo proibido, replay, adulteração e concorrência.
- E2E desktop para pesquisa de publicação, incidente, trecho autorizado,
  reprocessamento local e estado offline/parcial.
- Regressão nas três leis reais e nos dois perfis de projeção.

## Riscos

- Contexto livre virar canal de exfiltração: união discriminada e allowlists
  por código, validadas na emissão, persistência, consulta e preload.
- Ordem federada instável: instante de corte e cursor composto mantidos no main.
- Relógios divergentes confundirem a linha do tempo: ordenar por instante e
  desempatar por origem/sequência, exibindo a origem ao usuário.
- Evento local adulterado parecer prova: cadeia de hashes, falha fechada e
  completude explícita.
- Reprocessamento apagar trabalho editorial: candidata isolada, replay com
  conflito e promoção atômica.
- Trecho restrito escapar pelo renderer: tamanho mínimo, ação administrativa,
  sem cache persistente e teste de payload/bundle.
- Retenção indefinida crescer: índices, paginação e projeções pequenas; descarte
  exige decisão arquitetural posterior.
