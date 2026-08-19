# Plano de Implementação — Feature 013

## Abordagem

Construir uma camada de auditoria federada, e não substituir os stores
autoritativos existentes por um logger central. Um pacote puro define o
envelope interno e a política de redação; cada workload emite e persiste apenas
os eventos de sua autoridade. O processo principal adapta essas origens para
um DTO seguro, executa filtros, merge e paginação e expõe capacidades pequenas
ao renderer.

Reprocessamento reaproveita snapshots, pipeline, reconciliador, diário
editorial e validação existentes. O resultado é sempre uma candidata isolada.
Somente depois de replay, reconciliação, Formatter e validação completos o
store promove a candidata por gravação atômica; nenhum passo intermediário
altera o projeto visível.

## Componentes afetados

- `docs/architecture/ADR-014-auditoria-operacional-e-reprocessamento.md`:
  contrato superior de autoridade, consulta, evidência e promoção.
- Novo pacote puro `packages/operational-audit/`: schemas internos, códigos,
  contextos, redação, cadeia de hashes e projeção segura; sem Electron, fs,
  rede ou banco e sem nova dependência de produção além das já aprovadas.
- `src/main/audit/`: diário local, providers federados, merge, cursor, incidentes
  e autorização de evidência.
- `src/main/projects/` e `local-project-service.ts`: emissão local,
  reprocessamento candidato, lock, replay e promoção durável.
- `services/publisher/`, `services/update-worker/` e
  `packages/source-ingestion/`: emissão/projeção append-only e correlação.
- `supabase/migrations/`: eventos privados que ainda não possuam trilha
  append-only, funções de consulta fechadas, índices e grants mínimos.
- `src/shared/ipc/audit.ts`, `src/main/ipc/`, `src/preload/` e
  `desktop-api.ts`: filtros, páginas, detalhe, evidência e intenções de
  reprocessamento com schemas fechados e limites.
- `src/renderer/src/features/audit/`: pesquisa, filtros, timeline, detalhe,
  evidência temporária e acompanhamento do reprocessamento.
- Testes de domínio, main, serviços, migrations, preload, renderer e E2E.

## Contratos e fluxo

### Emissão e consulta

```text
workload executa etapa
  → cria evento tipado com ator/correlação derivados localmente
  → aplica allowlist + limites + redação
  → persiste append-only na store de sua autoridade

Administrador abre Logs/Diagnóstico
  → renderer envia AuditQueryIntent com filtros limitados
  → main valida remetente, papel, janela temporal e paginação
  → fixa queryCutoff e abre providers autorizados
      desktop journal | publisher | update worker | source catalog
  → cada provider devolve projeção redigida + cursor próprio
  → main faz merge estável, guarda cursor composto e calcula completude
  → preload revalida AuditPageDto
  → renderer exibe resultados e origens indisponíveis
```

O evento interno é uma união discriminada por `eventCode`. O DTO de lista é
menor: IDs opacos, instante, nível, módulo, código, mensagem, correlação e
indicadores de ações disponíveis. Contexto detalhado só vem por capacidade de
detalhe, também tipada por categoria. Isso reduz exposição e custo de páginas.

O cursor composto nunca é serializado com posições dos providers. O main
guarda um registro efêmero associado a UUID imprevisível, usuário, filtros,
instante de corte e expiração; alterar filtros inicia nova consulta.

### Evidência restrita

```text
evento possui evidenceLocatorId + hash + faixa permitida
  → Administrador solicita abrir evidência
  → main/serviço revalida sessão, papel, evento, hash, faixa e tamanho
  → provider lê o artefato na autoridade de origem
  → devolve trecho texto-plano limitado + numeração + hash
  → acesso gera evento append-only
  → renderer mantém somente estado volátil e descarta ao fechar o detalhe
```

Não haverá capacidade para escolher path, URI, bucket, tabela ou intervalo
arbitrário. Artefato local passa por raiz autorizada, `realpath`, verificação de
symlink e hash; artefato remoto é resolvido server-side.

### Reprocessamento local

```text
RequestReprocess(projectId, plan, expectedRevisionHash, reason, requestId)
  → main valida papel, projeto, revisão, lock e idempotência
  → registra requested na correlação do incidente
  → cria workspace candidato fora do projeto corrente
  → plan = from_source_snapshot
      verifica snapshots → extrai → parseia → reconcilia IDs
      → reaplica diário editorial com detecção de conflitos
    plan = from_identified_revision
      copia revisão corrente sem alterar AST jurídica
  → recalcula referências/projeções → Formatter → validação completa
  → grava journal/checkpoint/artefatos candidatos em transação local
  → promove ponteiro da revisão de trabalho atomicamente
  → invalida validação/aprovação antiga e emite completed
```

Se o processo cair antes da promoção, o workspace candidato é recuperado para
retry ou descartado após conferir que nunca virou revisão corrente. Se cair
depois da troca de ponteiro, a reabertura conclui o evento terminal a partir do
registro durável, sem promover novamente.

## Decisões locais

- Criar pacote puro para o contrato interno porque main, publisher, worker e
  catálogo não devem depender entre si nem duplicar enum/schema. DTOs do
  renderer permanecem em `src/shared/ipc` e deliberadamente menores.
- Reaproveitar stores autoritativos existentes. Uma tabela universal exigiria
  role ampla e converteria contexto livre em superfície de segurança.
- Manter o audit journal separado do diário editorial: o primeiro descreve
  execução; o segundo é fonte da revisão e participa do replay jurídico.
- Usar cadeia de hashes no diário local para detectar alteração acidental ou
  adulteração; não apresentá-la como assinatura criptográfica de uma estação
  comprometida.
- Consultas federadas não bloqueiam o uso offline, mas sempre declaram
  completude e falha individual por origem.
- Exibir mensagem redigida e códigos estáveis; localização e detalhes técnicos
  vêm de campos tipados, nunca de parsing da mensagem.
- Não permitir escolher uma etapa interna arbitrária. Dois planos cobrem as
  fronteiras seguras definidas na ADR-014 e evitam estado híbrido.
- Reprocessamento do worker continua assíncrono por request/claim. A UI apenas
  correlaciona e acompanha os eventos.

## Erros e recuperação

- Evento inválido ou contexto extra: rejeitar antes de persistir e registrar
  falha mínima no sink seguro da workload, sem ecoar o payload.
- Diário local com quebra de hash/ordem: marcar provider como indisponível por
  integridade, preservar bytes para investigação e nunca truncar sozinho.
- Provider remoto indisponível/timeout: devolver a página das demais origens
  com `partial` ou `local_only` e erro enumerado; retry começa nova consulta.
- Cursor expirado, de outro usuário ou de filtros diferentes:
  `audit_cursor_invalid`, sem revelar estado interno.
- Localizador ausente, adulterado ou fora da faixa: `evidence_not_available` ou
  `evidence_not_allowed`, sem path ou motivo interno.
- Projeto/revisão obsoleta: `reprocess_revision_conflict`, sem criar candidata.
- Lock ocupado: devolver operação corrente e permitir acompanhar, não iniciar
  segunda execução.
- Snapshot sem hash válido: falhar antes do parser e manter revisão corrente.
- Replay editorial conflita: preservar candidata para decisão diagnóstica,
  não descartar comando nem aplicar parcialmente.
- Crash pré-promoção: revisão atual continua apontada; retry reutiliza
  `requestId` e workspace confirmado.
- Crash pós-promoção: recuperação deriva o terminal do commit local e não
  repete promoção.
- Cancelamento é cooperativo antes da promoção; durante a gravação atômica ele
  aguarda o resultado e informa o estado real.

## Estratégia de validação

- Unitários para envelope/contextos, limites, redação, cadeia de hashes,
  correlação, estado derivado, merge, desempate, corte e cursor.
- Testes de contrato entre pacote, migrations, providers e DTOs IPC.
- Integração de emissão em todas as workloads e consulta por `publicationId`,
  `updateId`, projeto e lei.
- Testes de banco para append-only, índices, grants/RLS, papel inadequado,
  paginação e ausência de DML amplo.
- Integração de evidência com traversal, symlink, hash divergente, range,
  tamanho, sessão/papel e conteúdo proibido.
- Matriz de reprocessamento: ambos os planos, replay compatível/conflitante,
  ID publicado, validação, atomicidade, crash em fronteiras, cancelamento,
  concorrência, idempotência e offline.
- E2E Electron por teclado para filtrar publicação, abrir incidente/evidência,
  reprocessar e retornar ao preview; cenário parcial/offline explícito.
- Fixtures das Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003 nos perfis
  `complete_with_history` e `current_only`.
- `lint`, `typecheck`, testes relacionados e completos, migrations PostgreSQL,
  `test:boundaries`, `check:data-model`, `test:e2e`, build/inspeção de bundle,
  `check:sensitive-output` e `graphify update .`.

## Ordem

1. Entregar contrato, diário local, redação e modelo append-only remoto.
2. Instrumentar desktop e workloads com eventos/correlação essenciais.
3. Implementar providers, consulta federada, IPC e tela pesquisável.
4. Implementar incidentes e evidência restrita sob autorização.
5. Implementar candidata, planos e recuperação do reprocessamento.
6. Executar E2E, regressão real, segurança, documentação e encerramento.

## Não fazer

- Não encaminhar `console.*`, exceção ou contexto arbitrário para a auditoria.
- Não criar endpoint, canal IPC, SQL ou executor genérico de diagnóstico.
- Não devolver path, stack, AST, snapshot ou credencial em lista, detalhe,
  evidência ou erro.
- Não marcar consulta como completa se um provider falhou.
- Não usar audit log como fonte da revisão jurídica ou como substituto do Git.
- Não promover candidata parcialmente nem apagar workspace antes de confirmar
  o ponteiro durável.
- Não recalcular Block IDs publicados a partir do texto atual.
- Não executar worker, publicação ou correção automática pelo renderer.
