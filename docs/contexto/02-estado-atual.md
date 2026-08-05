# Estado Atual do Repositório

> Verificado em 2026-08-05, contra o working tree (branch `master`,
> último commit `f31eef6`).

## Situação em uma tabela

| Dimensão | Estado |
|---|---|
| Documentação de arquitetura | Completa e aceita (9 ADRs + 5 especificações) |
| Documentação de produto | Completa (PRD, roadmap e fluxos dos dois produtos) |
| Specs de implementação | 8 features especificadas; 001 e 002 `done`, 003 `review`, 004–008 `draft` |
| Código de aplicação | Shell Electron seguro, sem lógica jurídica |
| Código de domínio | NormaAST + pipeline vertical: parser, Block IDs, Formatter e CLI `lex process` |
| Testes | 80 unitários + 1 teste de fronteiras de lint + 8 smoke E2E (Playwright/Electron) |
| CI | GitHub Actions, 3 jobs verdes na primeira execução (2026-08-05) |
| Empacotamento | electron-builder + fuses + inspeção do asar (`scripts/inspect-bundle.mjs`) |
| Grafo de conhecimento | 819 nós, 1121 arestas, 81 comunidades — gerado, não versionado |
| Git | Tudo commitado em `master` e sincronizado com `origin` |

## Comandos e resultado verificado

Executados nesta ordem em 2026-08-05:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Passa (workspaces, node e renderer) |
| `npm run test:unit` | Passa — 6 arquivos, 80 testes |
| `npm run test:boundaries` | Passa |
| `npm run lint` | Passa com `--max-warnings 0` |
| `npm run format:check` | Passa |
| `npm run check:pre-commit` | Passa |
| `npm run test:e2e` | Passa — 8 smoke no Playwright/Electron (2026-08-04) |
| `npm run build` | Passa — AppImage e `.deb` em `release/`, além do `linux-unpacked` |
| `node scripts/inspect-bundle.mjs release/linux-unpacked` | Passa — 350 entradas, sem violações |
| `npm run check:data-model` | Passa — 21 interfaces conferidas, 0 divergências |

`format:check` reprovava os cinco arquivos de `exemplos/` até 2026-08-04, o que
travava o hook de pre-commit e manteve todo o código fora do Git. Era falha de
configuração, não de código: são textos legais de referência que não devem ser
reformatados. `exemplos/` entrou no `.prettierignore`, ao lado de `docs/` e
`spec/`, que já estavam lá pelo mesmo motivo.

## O que existe no disco

```text
docs/
  architecture/    9 ADRs + BLOCK_ID_SPEC, MARKDOWN_SPEC, DATA_MODEL,
                   SYSTEM_ARCHITECTURE, UPDATE_PIPELINE
  lex-editor/      PRD, ROADMAP, USER_FLOWS da ferramenta editorial
  vinculex/        PRD, ROADMAP, USER_FLOWS do SaaS
  contexto/        este registro
spec/
  README, DEVELOPMENT_RULES, TEST_STRATEGY, FEATURE_INDEX, templates/
  lex-editor/      001 a 008, cada uma com spec.md, plan.md e tasks.md
packages/
  legal-domain/    pacote puro; NormaAST em src/ast/ e o pipeline em
                   src/{source,parser,block-id,formatter,pipeline}
  cli/             comando `lex process`; única camada com fs, crypto e escrita
src/
  main/            ciclo Electron, janela, segurança, IPC
  preload/         ponte contextBridge, empacotada como CJS
  renderer/        shell React + tokens CSS
  shared/ipc/      contratos zod compartilhados pelos dois lados da ponte
fixtures/legal/    fixture do CP art. 121, manifesto e golden
tests/
  main/            3 suítes de fronteira
  domain/          contrato da NormaAST e pureza do pacote
  pipeline/        corte vertical da fixture ao Markdown canônico
  config/          verificação executável das regras de import do ESLint
exemplos/          CF/88, CP, Lei 14.133, Lei Maria da Penha e LINDB em Markdown
prompts/           prompt mestre usado para gerar a documentação inicial
scripts/           hooks do Git, inspeção do bundle e auditoria do DATA_MODEL
.agents/skills/    skills consultadas pelos agentes, incl. lex-editor-electron
out/               build de desenvolvimento gerado por electron-vite
graphify-out/      grafo de conhecimento gerado; não versionado
```

## Grafo de conhecimento

`graphify-out/` guarda um grafo de 819 nós e 1121 arestas sobre `docs/`,
`spec/`, `src/`, `packages/` e `tests/`. Os `spec/templates/` ficam de fora por
serem formulários em branco, sem conceito a extrair.

Eram 417 nós antes da Feature 002, quando o domínio era um módulo vazio.
Reextrair depois de mexer em código é `graphify update .`, sem custo de API.

O escopo vive em `.graphifyignore`: skills de agente de terceiros e os textos
legais de `exemplos/` ficam fora, porque descreveriam bibliotecas alheias e
legislação, não este projeto.

O grafo é derivado — reconstruível de `docs/` e do código — e por isso não é
versionado. `CLAUDE.md` traz o comando de reconstrução.

## Feature 001 — progresso real

Concluídas e validadas:

- **T001-01** workspace npm com `workspaces: ["packages/*"]`, scripts canônicos
  e `tsconfig.base.json` estrito (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, entre outros);
- **T001-02** `packages/legal-domain` isolado, com `exports` declarado e matriz
  de dependências entre camadas registrada no `plan.md`;
- **T001-03** ESLint flat config aplicando as fronteiras, Prettier como única
  autoridade de formatação e hook `pre-commit` via `core.hooksPath`;
- **T001-04** `BrowserWindow` endurecida e API `lexDesktop` v1 exposta por
  `contextBridge` com uma única capacidade;
- **T001-05** `executeValidatedIpcHandler` centralizando origem, frame, schema
  e limite de tamanho em ambos os sentidos;
- **T001-06** shell React com as três áreas previstas na Fase 0 do roadmap e
  tokens semânticos para estado jurídico e severidade;
- **T001-07** Vitest configurado e três suítes negativas de fronteira;
- **T001-08** Playwright Electron com 8 smoke tests sobre o app compilado;
- **T001-09** `electron-builder.yml` com fuses, `scripts/inspect-bundle.mjs`
  para conteúdo do asar e fuses gravados no binário, e CI mínima em
  `.github/workflows/ci.yml` (validate, e2e e package);
- **T001-10** todos os comandos executados, bundle inspecionado (350 entradas,
  apenas `zod` embarcado) e os cinco critérios de aceite demonstrados.

Pendentes:

- nenhum dentro da Feature 001.

Os cinco critérios de aceite da Feature 001 estão marcados no `spec.md` e a
feature está `done` no `FEATURE_INDEX.md`. O que sobrou dela está registrado no
`review.md`: a divergência aberta com a ADR-007 §4, que exige assinatura por
plataforma, e as dívidas de empacotamento em macOS e Windows.

## Feature 002 — o que foi entregue

`packages/legal-domain/src/ast/` traz os 14 tipos de nó do `DATA_MODEL.md` em
tipo e em schema de runtime, nas duas fases: `parsed` sem Block ID e
`identified` com Block ID em todo nó referenciável. A distinção vale em tempo de
compilação, não só em runtime.

- **T002-01 a T002-04** enums da ADR-005, erros com código estável e caminho,
  origem/evidência da ADR-009, históricos da ADR-006, e as famílias de nó
  construídas por uma fábrica instanciada uma vez por fase;
- **T002-05** validador estrutural iterativo: unicidade de id e de Block ID,
  ordem entre irmãos, hierarquia, ciclo, texto obrigatório e `totalArtigos`
  derivado;
- **T002-06 a T002-09** fixtures mínimas e completa, 43 testes de contrato e
  pureza, e conferência campo a campo contra o `DATA_MODEL.md`.

O `review.md` da feature registra o que não se deduz do código: por que os tipos
não são `z.infer` direto (limite TS7056), como a equivalência é provada em
compilação, e a descoberta de que a validação produz forma canônica de
serialização — útil para o `conteudo_sha256` da Feature 007.

## Feature 003 — o que foi entregue

Corte vertical completo, da fixture local ao Markdown canônico, acionado por
`lex process` e sem tocar rede, Electron ou banco. Duas execuções da CLI e o
golden compartilham um único SHA-256.

A feature está em `review`, não `done`: os cinco critérios de aceite estão
demonstrados, mas a T003-10 pede conferência do texto da fixture contra o
Planalto, que exige rede e revisor humano. O `review.md` registra isso como
divergência aberta — um golden estruturalmente perfeito sobre texto jurídico
errado é o risco que a própria spec nomeia.

## O que deliberadamente não existe

Estes vazios são decisão registrada, não esquecimento:

- cobertura de toda a legislação brasileira — Feature 004; o pipeline da 003
  suporta apenas os designadores presentes na sua fixture;
- download por URL e leitura arbitrária de arquivo — Feature 005;
- Git, Supabase, autenticação editorial e publicação — Feature 007;
- worker de atualização legislativa — Feature 008;
- acabamento visual definitivo — a paleta atual é baseline substituível,
  porque os valores oficiais de marca do Vinculex não estão no repositório.
