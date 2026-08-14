# Review — Feature 011

## Resultado

A feature encerra com um catálogo versionado de fontes oficiais no qual
configuração permanece dado e adaptadores permanecem código instalado. O
Administrador Técnico cria revisões imutáveis, executa o dry-run pelo caminho
real de ingestão e somente então pode ativar, pausar, arquivar ou restaurar um
vínculo. Importador e worker resolvem e capturam a mesma revisão ativa, sem
transportar o catálogo para a NormaAST e sem entregar autoridade administrativa
ao renderer ou ao worker.

## Decisões permanentes

- Uma origem configurável é restrita a esquema, host exato, porta permitida e
  prefixo de caminho. Regex, seletores, templates, headers arbitrários e código
  executável não fazem parte do contrato.
- O dry-run usa o mesmo registro de adaptadores, fetch seguro, detecção e
  extração da ingestão real. Falha em qualquer etapa produz evidência de falha e
  nunca habilita ativação.
- Jobs capturam as revisões de provedor e vínculo no início. Ativação ou
  restauração concorrente afeta somente jobs posteriores.
- O harness do catálogo existe apenas para E2E offline. Ele exige opt-in
  explícito em desenvolvimento, é recusado quando `app.isPackaged` e seu módulo
  compilado fica fora do bundle e do ASAR.
- Navegação interna do renderer pode alterar somente o fragmento da mesma URL
  local. Query, origem ou arquivo diferente continuam sendo remetentes não
  confiáveis para IPC.
- `defuddle` permanece externalizado no processo main para preservar o consumo
  CommonJS de `linkedom`; o runtime JSX de desenvolvimento entra na otimização
  inicial do Vite para evitar o recarregamento que deixava a janela vazia.

## Evidências de segurança e integração

- A matriz automatizada offline cobre SSRF, loopback e redes privadas,
  IDNA/host semelhante, DNS rebinding, redirecionamento proibido, porta não
  permitida, MIME inesperado, resposta excessiva, regras declarativas abusivas,
  autorização, concorrência otimista e bloqueio de sucesso falso.
- `tests/e2e/smoke.spec.ts` cadastra pela UI a origem exata
  `https://planalto.gov.br`, executa o dry-run, ativa, pausa e restaura pelo
  teclado e importa a Lei nº 9.099/1995 pela configuração recém-ativada até o
  preview.
- `tests/services/source-catalog-end-to-end.test.ts` atravessa
  UI/IPC, catálogo, resolvedor, importador e worker e comprova a mesma revisão,
  adapter, função, variante e evidência nos dois consumidores.
- `tests/main/source-catalog-e2e-harness.test.ts`, a inspeção de
  `release/linux-unpacked` e a busca por saída sensível comprovam que harness,
  fixtures E2E e credencial administrativa não entram no aplicativo empacotado.
- `tests/source-ingestion/node-planalto-adapter.test.ts` revalida offline:
  Lei nº 9.099/1995 e Lei nº 9.605/1998 como `primary_current`/`annotated`; Lei
  nº 10.826/2003 compilada como `primary_current`/`compiled` e anotada como
  `historical_auxiliary`/`annotated`.

## Validações de encerramento

- `npm run typecheck` e `npm run lint` aprovados.
- `npm run test:unit` — 522 testes aprovados em 60 arquivos.
- `npm run test:e2e` — 14 cenários Electron/Playwright aprovados.
- `npm run test:publication-db`, `npm run test:boundaries` e
  `npm run check:data-model` aprovados.
- `npm run build:unpacked` e
  `node scripts/inspect-bundle.mjs release/linux-unpacked` aprovados.
- `npm run check:sensitive-output`, `npm run format:check` e
  `git diff --check` aprovados.

Não permaneceram critérios de aceite ou tarefas abertas na Feature 011.
