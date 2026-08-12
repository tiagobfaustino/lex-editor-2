# Tarefas — Feature 007

## Protocolo e candidate

- [x] T007-01 Implementar manifesto, SemVer, número de publicação e chave
  idempotente com validação canônica.
- [x] T007-02 Implementar aprovação server-side ligada a ator, papel e digest.
- [x] T007-03 Implementar commit/push apenas no branch candidato e diário
  durável local.

## Autoridade server-side

- [x] T007-04 Criar serviço com autenticação, busca do SHA no Git e
  revalidação integral.
- [x] T007-05 Criar role/função SQL privada transacional com lock,
  concorrência e troca final do ponteiro.
- [x] T007-06 Implementar promoção do SHA e máquina de estados retomável.

## Operação editorial

- [x] T007-07 Implementar UI de confirmação, consulta, falha e retry sem
  sucesso falso.
- [x] T007-08 Implementar histórico, diff e rollback para frente.

## Validação crítica

- [x] T007-09 Injetar falha em cada estágio e provar idempotência/recuperação.
- [x] T007-10 Testar corrida, replay, manifesto adulterado, paths extras e
  permissões negativas.
- [x] T007-11 Executar E2E staging e varredura de bundle/logs por secrets.
  - Projeto Supabase e repositório Git privado exclusivos foram provisionados;
    a Edge Function final executou aprovação, candidate, promoção, transação,
    leitura anônima e retry idempotente reais. Bundle e log do staging passaram
    pela varredura sem violações.
