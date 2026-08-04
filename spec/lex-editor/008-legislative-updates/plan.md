# Plano de Implementação — Feature 008

## Abordagem

Executar worker com identidade própria e reutilizar bibliotecas do domínio.
Separar detecção, proposta, decisão editorial e publicação em estados e
autoridades diferentes.

## Componentes afetados

- `services/update-worker/`: scheduler, fetch seguro e detecção.
- `packages/legal-domain/src/normative-projection/`
- `packages/legal-domain/src/diff/`
- funções/RPCs privadas da fila.
- `src/main/updates/` e `src/renderer/features/atualizacoes/`

## Contratos e fluxo

Conjunto de snapshots atual → ParsedAST → projeção normativa/hash → comparação →
reconciliação/diff → pendência. Aprovação cria nova revisão e entra na Feature
007; rejeição/supersessão nunca altera conteúdo público.

## Decisões locais

- Hash bruto de cada artefato e hash normativo são persistidos separadamente.
- Chave de deduplicação inclui lei, base publicada e hash candidato.
- Scheduler aplica backoff/jitter e suspende fonte degradada.

## Erros e recuperação

- Falha de rede/parser atualiza a pendência/telemetria apropriada sem publicar.
- Nova divergência supersede proposta antiga incompatível.
- Retry com mesmos hashes não duplica.

## Estratégia de validação

- Fixtures antes/depois para cada tipo de mudança.
- Mudança cosmética e ambiguidade.
- Integração fila/revisão/permissões.
- E2E aprovação e rejeição.

## Ordem

1. Projeção/hash.
2. diff/reconciliação.
3. worker e deduplicação.
4. fila/RPCs.
5. UI de revisão.
6. integração com publicação e operação.

## Não fazer

- Não conceder ao worker função de publicação.
- Não avançar atualização somente por score de confiança.
