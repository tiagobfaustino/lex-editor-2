# ADR-014: Auditoria operacional federada e reprocessamento seguro

## Status

Aceito em 2026-08-14. Implementação planejada para a Feature 013.

## Contexto

O Lex Editor já apresenta diagnósticos da importação e da validação corrente,
e os serviços de publicação, atualização legislativa e catálogo preservam
parte de suas decisões em registros próprios. Esses dados, porém, ainda não
formam a auditoria pesquisável exigida pelo RF-23: o Administrador Técnico não
consegue consultar, pela mesma interface, eventos por lei, módulo, nível e
período nem seguir um incidente até o artefato e a execução que o originaram.

Diagnóstico corrente e auditoria não são o mesmo conceito. O primeiro explica
o estado atual de uma revisão e pode desaparecer quando ela é recalculada; a
segunda precisa sobreviver a reabertura, falha, retry e publicação. Também não
é seguro resolver a lacuna copiando HTML, AST, paths, stacks e mensagens livres
para uma tabela ou para o renderer.

O fluxo 7 de `USER_FLOWS.md` acrescenta outra exigência: depois de investigar
uma falha, o administrador precisa reprocessar a lei a partir de uma fronteira
conhecida sem perder correções editoriais, Block IDs publicados ou a última
revisão válida.

## Decisão

### 1. Evento operacional é um contrato versionado

Todo evento pesquisável usa um envelope fechado e validado em runtime com, no
mínimo:

- `eventId`, versão do schema e instante UTC;
- nível `info | warn | error` e módulo de origem enumerado;
- código estável do evento e mensagem redigida para exibição;
- origem autoritativa (`desktop`, `publisher`, `update_worker` ou
  `source_catalog`);
- IDs opacos aplicáveis de lei, projeto, execução, publicação, atualização e
  incidente;
- `correlationId` para ligar as etapas da mesma execução;
- duração, contagens, hashes e faixas de origem somente quando previstos pelo
  schema específico daquele código.

O contexto não é um mapa livre na fronteira entre processos. Cada código de
evento possui uma união discriminada com allowlist e limites próprios. Stack,
path, HTML/XML bruto, AST, credencial, header, URL assinada e nota de usuário
não integram o evento.

Diagnósticos editoriais continuam ligados à revisão corrente. Quando
necessário, eles apontam para um evento por ID; não são promovidos
automaticamente a audit log nem substituem a validação.

### 2. A auditoria é federada por autoridade

Não haverá um cliente privilegiado universal nem uma tabela genérica gravável
por todas as workloads.

- O desktop grava seus eventos em diário local append-only, ao lado do estado
  operacional do projeto, com sequência, hash anterior e hash do evento.
- O Serviço de Publicação projeta eventos append-only de aprovação, tentativa,
  promoção e sincronização a partir de sua autoridade server-side.
- O worker e o catálogo mantêm eventos nas stores privadas que já governam
  seus respectivos fluxos.

Um serviço de consulta no processo principal normaliza as projeções seguras e
mescla resultados. O renderer nunca acessa filesystem, banco, Git, worker ou
artefato diretamente. Ausência de conectividade não transforma consulta
parcial em completa: toda página informa `complete`, `local_only` ou `partial`
e quais origens ficaram indisponíveis.

### 3. Pesquisa possui corte e cursor estáveis

A consulta aceita somente filtros tipados por lei, módulo, nível, período,
código/categoria e correlação. Texto livre procura apenas código e mensagem
redigida; não alcança artefatos restritos.

Ao iniciar uma pesquisa, o processo principal fixa um instante de corte. O
cursor opaco guarda, no lado privilegiado, a posição de cada provedor e expira
em prazo curto. Assim, eventos novos não duplicam nem deslocam resultados de
uma paginação em curso. Limite de página, intervalo máximo e rate limit são
obrigatórios.

### 4. Incidente é uma correlação, não um status genérico

Um evento de erro pode iniciar um `incidentId`. Investigação, solicitação de
reprocessamento, nova falha e resolução acrescentam eventos à mesma correlação;
nada reescreve o evento original. Quando a UI precisar resumir o andamento,
usa o campo semanticamente nomeado `incident_resolution_state`, derivado da
sequência, com valores `open | reprocessing | resolved`.

O incidente registra código, etapa, hashes, faixa e resultado técnico. Causa
raiz ou justificativa humana entra por comando auditado e limitado, nunca em
telemetria automática ou mensagem de exceção não redigida.

### 5. Artefato restrito é aberto sob demanda

O evento pode carregar apenas um localizador opaco associado a hash e faixa.
Uma capacidade separada, autorizada para Administrador Técnico, resolve esse
localizador no processo que detém o artefato e devolve somente um trecho de
texto com tamanho máximo, numeração de linhas e hash conferível.

O trecho não é persistido no evento, cache do renderer, clipboard automático
ou crash report. A abertura gera outro evento de auditoria. Path, URI interna e
snapshot integral nunca atravessam IPC.

### 6. Reprocessamento usa planos nomeados e promoção atômica

O renderer não escolhe função, etapa arbitrária, arquivo ou comando. Ele
solicita um dos planos fechados:

- `from_source_snapshot`: verifica os hashes dos snapshots imutáveis e refaz
  extração, parsing, identificação, referências, formatação e validação;
- `from_identified_revision`: conserva a `IdentifiedNormaAST` corrente e
  recalcula somente referências, projeção, Markdown e validação.

O primeiro plano constrói uma candidata isolada, reconcilia Block IDs contra o
registro publicado e reaplica o diário editorial pelo mecanismo já definido na
Feature 006. Comando obsoleto ou ambíguo produz conflito explícito. O segundo
plano não recalcula identidade nem altera texto jurídico.

Somente uma candidata integralmente válida substitui a revisão de trabalho em
uma gravação durável e atômica. Falha preserva a revisão, o diário, a aprovação
publicada e os artefatos anteriores. Qualquer promoção local invalida validação
e aprovação editorial da revisão substituída; jamais publica automaticamente.

Reprocessamento de pendência legislativa continua sendo uma solicitação à fila
do worker, com claim idempotente. O desktop não executa o worker nem recebe sua
credencial.

### 7. Retenção, acesso e integridade

No primeiro corte, eventos de auditoria são retidos por tempo indeterminado e
nunca recebem `UPDATE` ou `DELETE` pela aplicação. Crescimento é controlado por
paginação, índices e projeções pequenas; eventual política de descarte exige
nova decisão versionada e não pode remover eventos de aprovação, publicação,
rollback ou decisão legislativa.

O acesso é limitado ao Administrador Técnico, exceto diagnósticos da revisão
corrente já necessários ao Editor Jurídico. Exportar o audit log, integrar
SIEM/telemetria externa e enviar crash report ficam fora desta decisão.

O diário local é verificado ao abrir o projeto. Quebra de sequência ou hash
produz incidente de integridade, torna aquela origem incompleta e impede usar
seus eventos como prova de sucesso; os arquivos não são corrigidos ou
truncados silenciosamente.

## Consequências

### Positivas

- O RF-23 pode ser atendido sem concentrar credenciais ou dados brutos.
- Eventos de diferentes workloads mantêm a autoridade e retenção próprias,
  mas aparecem em uma pesquisa coerente.
- Falha de rede, paginação ou integridade nunca é apresentada como auditoria
  completa.
- Reprocessar deixa de ser sinônimo de sobrescrever: a revisão anterior só é
  substituída após prova integral da candidata.

### Negativas

- A consulta federada exige cursor composto, indicação de completude e testes
  de ordenação entre relógios diferentes.
- Alguns fluxos existentes precisarão emitir eventos adicionais ou ganhar
  projeções append-only.
- Retenção indefinida aumenta o volume e exigirá monitoramento; particionamento
  ou descarte futuro dependerão de nova decisão.

## Alternativas rejeitadas

### Um arquivo ou tabela de log genérico para todo o sistema

Rejeitado porque daria autoridade de escrita ampla às workloads, misturaria
retenção e poderia transformar contexto livre em canal de exfiltração.

### Consultar `console.log` ou arquivos de texto pela UI

Rejeitado porque não oferece schema, correlação, integridade, paginação segura
nem redação confiável.

### Enviar o artefato ou a stack completa ao renderer

Rejeitado pela ADR-007. Um XSS não pode ganhar acesso a snapshots, paths ou
detalhes internos apenas porque a tela de diagnóstico está aberta.

### Reprocessar sobrescrevendo o projeto em cada etapa

Rejeitado porque crash, erro de parser ou conflito editorial deixariam estado
parcial e poderiam destruir a última revisão válida.

## Verificação

- Contratos rejeitam código, módulo, contexto ou campo extra não permitido.
- Amostras de importação, parsing, Block ID, validação, publicação, atualização
  e catálogo são JSON válidos e não contêm payload proibido.
- Consulta federada mantém ordem e cursor estáveis e declara corretamente
  `complete`, `local_only` ou `partial`.
- Evento local adulterado é detectado e nunca usado como prova de sucesso.
- IPC forjado, ator sem papel e tentativa de ampliar faixa/artefato falham.
- Crash durante cada plano de reprocessamento mantém a revisão anterior; retry
  idempotente não duplica promoção nem evento terminal.
- As três leis de referência preservam texto, Block IDs, diário e Markdown
  canônico após reprocessamento sem mudança de fonte.

## Referências

- `./ADR-005-status-fields.md`
- `./ADR-007-fronteira-segura-publicacao.md`
- `./UPDATE_PIPELINE.md`, seção 9
- `../lex-editor/PRD.md`, RF-23, RNF-05 e RNF-12
- `../lex-editor/USER_FLOWS.md`, fluxo 7
