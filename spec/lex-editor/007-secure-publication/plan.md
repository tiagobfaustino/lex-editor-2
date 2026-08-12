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

- Staging usa um projeto Supabase e um repositório Git privado exclusivos. A
  workload hospedada é uma Supabase Edge Function: mantém credenciais fora do
  Electron, recebe apenas comandos fechados e conecta diretamente ao Postgres.
  Um job protegido de CI seria suficiente para ensaios, mas não ofereceria a
  API autenticada exigida pelo fluxo editorial.
- O papel persistido `curador`, definido em `DATA_MODEL.md`, é mapeado pelo
  publisher para a função editorial `editor_juridico` registrada na aprovação.
  Não se cria um quarto valor incompatível em `usuarios_perfil.papel`.
- O bundle da Edge Function reutiliza o serviço TypeScript existente. `esbuild`
  é dependência direta apenas de desenvolvimento para produzir esse artefato;
  copiar a lógica para Deno criaria duas autoridades de validação divergentes.
- `postgres` é a dependência runtime mínima da workload para usar a conexão
  `SUPABASE_DB_URL` fornecida pela própria plataforma. A Data API foi rejeitada
  porque exigiria expor o schema privado do publisher ao PostgREST.
- API recebe `publicationId` e SHA, não conteúdo confiado do cliente.
- Publisher busca artefatos diretamente no Git.
- Função SQL bloqueia a lei e verifica base/ID de idempotência.
- O manifesto usa JSON canônico compacto, com chaves ordenadas
  lexicograficamente, sem BOM, espaços ou quebra final. O digest SHA-256 é
  calculado sobre esses bytes UTF-8; qualquer representação JSON equivalente,
  mas não canônica, é rejeitada na leitura do release.
- `publicationId` identifica a tentativa auditável e `idempotencyKey`
  identifica a publicação lógica. Ambos são UUIDs gerados uma única vez e
  persistidos no manifesto; retry não os regenera.
- O release commit preserva também a `IdentifiedNormaAST` canônica em
  `.vinculex/releases/{numero}-{versao}.ast.json` e cada snapshot bruto em
  `.vinculex/sources/{sha256}.snapshot`. Os paths são derivados pelo serviço,
  nunca aceitos da requisição. Isso permite revalidar hashes, projeção e
  evidência sem reconstruir domínio a partir do Markdown nem buscar conteúdo
  fornecido pela estação.
- O manifesto carrega o impacto SemVer e a entrada estruturada do changelog.
  O publisher recalcula o diff contra a versão pública e recompõe o
  `UPDATE.md`; digest aprovado isoladamente não substitui essa validação.
- `versoes_lei` preserva os campos de rastreabilidade da raiz da AST. IDs
  internos dos nós continuam sendo dados da AST; UUIDs de `dispositivos` são
  atribuídos somente na projeção server-side.
- A role `lex_publisher` recebe apenas `USAGE` no schema privado e `EXECUTE`
  nas funções fechadas. As funções usam `SECURITY DEFINER`, `search_path = ''`,
  nomes qualificados e revogação explícita de `PUBLIC`, `anon` e
  `authenticated`.

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
