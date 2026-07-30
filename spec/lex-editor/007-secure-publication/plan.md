# Plano de Implementação — Feature 007

## Abordagem

Separar cliente editorial e autoridade de produção. O Electron prepara e envia
candidate; um serviço isolado valida e executa promoção/sync. Modelar a
publicação como máquina de estados idempotente.

## Componentes afetados

- `src/main/publication/`: manifesto, Git candidato e diário.
- `src/shared/ipc/publication.ts`: intenção e resumo.
- `src/renderer/features/publicacao/`
- `services/publisher/`: API autenticada, validação, Git e banco.
- migrations/funções privadas Supabase.
- testes de integração com repositório e banco de staging.

## Contratos e fluxo

```text
revisão validada → aprovação do digest → candidate SHA
→ publisher revalida → promove SHA → transação → ponteiro público
```

Estados seguem `publication_attempt_status`; cada transição exige evidência do
estágio anterior.

## Decisões locais

- API recebe `publicationId` e SHA, não conteúdo confiado do cliente.
- Publisher busca artefatos diretamente no Git.
- Função SQL bloqueia a lei e verifica base/ID de idempotência.

## Erros e recuperação

- Diário persiste chave, bytes, SHA e estágio comprovado.
- Retry consulta estado remoto antes de repetir efeito.
- Git promovido com sync pendente continua explícito e retomável.
- Base obsoleta invalida artefatos e aprovação.

## Estratégia de validação

- Testes de manifesto/SemVer/paths/hashes.
- Integração com falha injetada em cada estágio.
- Concorrência, replay, adulteração e permissões negativas.
- E2E staging e varredura de secrets.

## Ordem

1. Manifesto e máquina local.
2. candidate Git.
3. aprovação server-side.
4. publisher e função SQL.
5. retry/concorrência.
6. rollback, UI e testes de ataque.

## Não fazer

- Não colocar secret administrativa no Electron.
- Não tratar commit/push como publicação concluída.
