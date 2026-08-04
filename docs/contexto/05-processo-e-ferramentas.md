# Processo e Ferramentas

> Como se trabalha neste repositório. A autoridade sobre o processo é
> `../../AGENTS.md`, `../../spec/README.md`, `../../spec/DEVELOPMENT_RULES.md` e
> `../../spec/TEST_STRATEGY.md`; esta página resume e explica.

## Antes de implementar qualquer coisa

O `AGENTS.md` da raiz define a sequência obrigatória:

1. ler `spec/README.md`, `spec/DEVELOPMENT_RULES.md` e `spec/TEST_STRATEGY.md`;
2. consultar `spec/FEATURE_INDEX.md`;
3. trabalhar somente na feature com `implementation_status: in_progress`;
4. ler integralmente `spec.md`, `plan.md` e `tasks.md` dessa feature.

Se nenhuma feature estiver `in_progress`, não se escolhe uma silenciosamente:
a próxima só é ativada quando o pedido do usuário autorizar implementação.

## Precedência de fontes

Quando dois documentos parecem incompatíveis:

```text
ADR aceito / spec normativa
  → DATA_MODEL, SYSTEM_ARCHITECTURE, UPDATE_PIPELINE
    → PRD
      → ROADMAP e USER_FLOWS
        → spec.md da feature
          → plan.md e tasks.md
```

Um contrato superior nunca é ajustado silenciosamente para fazer o código
passar. Conflito real interrompe a implementação e é relatado.

## Ciclo de vida de uma feature

```text
draft → ready → in_progress → review → done
                  ↘ blocked
draft/ready/in_progress → cancelled
```

IDs são permanentes: uma feature cancelada mantém o número. Para passar a
`in_progress` é preciso confirmar as dependências como `done`, revisar os três
arquivos, confirmar ausência de conflito com `docs/` e registrar a mudança no
`FEATURE_INDEX.md`.

Para passar a `done`: todos os critérios de aceite demonstrados, tarefas
refletindo o estado real, lint/typecheck/testes aplicáveis passando, contratos e
documentação atualizados, desvios registrados e nenhum caminho conhecido para
sucesso falso.

`review.md` só é criado no encerramento quando há decisão, desvio, dívida ou
evidência que mereça registro permanente — nunca como relatório cerimonial.

## Estratégia de testes: por risco, não por cobertura

| Nível | Consequência de uma falha | Validação mínima |
|---|---|---|
| Crítico | Publica texto jurídico incorreto, corrompe identidade, contorna autorização, perde histórico | Unitário/integrado obrigatório, caso negativo e evidência ponta a ponta |
| Alto | Perde dados, duplica publicação, quebra recuperação, atravessa fronteira de segurança | Teste automatizado da regra e da falha |
| Médio | Interrompe fluxo operacional de forma visível e reversível | Unitário ou integração seletiva |
| Baixo | Defeito visual reversível | Validação manual direcionada |
| Trivial | Código declarativo sem lógica própria | Sem teste específico |

Sempre se automatiza: parsing e hierarquia jurídica, invariantes da NormaAST,
Block IDs, Markdown canônico, validações bloqueantes, manifesto/idempotência/
concorrência/rollback, recuperação após falha parcial, IPC/CSP/SSRF/traversal/
symlink, grants e RLS — e qualquer regra que possa produzir sucesso falso.

Não se testa isoladamente: texto de botão, cor sem significado funcional,
wrapper sem decisão, getter trivial, comportamento da biblioteca externa.

Foi essa regra que colocou a fronteira IPC sob teste já na T001-05, antes mesmo
de a configuração de testes estar formalmente concluída na T001-07.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | electron-vite em modo desenvolvimento |
| `npm run build:app` | build dos três processos para `out/` |
| `npm run build:workspaces` | compila `packages/*` que tenham script `build` |
| `npm run preview` | executa o build gerado |
| `npm run lint` / `lint:fix` | ESLint com `--max-warnings 0` |
| `npm run format` / `format:check` | Prettier como única autoridade de formatação |
| `npm run check:pre-commit` | `lint && format:check` — é o que o hook roda |
| `npm test` / `test:unit` | Vitest sobre `tests/**/*.test.ts` |
| `npm run test:boundaries` | Verifica as regras de import do ESLint executando o próprio ESLint |
| `npm run typecheck` | Os três projetos: workspaces, node e renderer |

`npm run test:e2e` está previsto na Fase 0 do roadmap e na T001-08, mas ainda
não existe.

## Hooks de Git

`npm run prepare` executa [scripts/configure-git-hooks.mjs](../../scripts/configure-git-hooks.mjs),
que aponta `core.hooksPath` para `.githooks/` — versionado, ao contrário de
`.git/hooks/`. O script verifica antes se está em um checkout Git, para não
falhar em instalação fora de repositório.

`.githooks/pre-commit` roda `npm run check:pre-commit` com `set -eu`.

## Skills de agente

`.agents/skills/` guarda as skills consultadas durante o desenvolvimento. A
relevante para este projeto é **`lex-editor-electron`**, escrita para tratar
Electron como fronteira de segurança. Ela exige, antes de qualquer trabalho em
main, preload, IPC ou empacotamento: ler o `AGENTS.md`, ler os quatro documentos
de `spec/`, identificar a feature ativa, ler a ADR-007 e consultar a
documentação **atual** do Electron em vez de presumir que defaults antigos
continuam válidos. Suas referências cobrem capacidades IPC, arquitetura segura e
validação de empacotamento.

O `AGENTS.md` torna o uso dessa skill obrigatório em tarefas de Electron.

As demais skills instaladas (`vercel-*`, `web-design-guidelines`,
`writing-guidelines`) são de propósito geral e não carregam autoridade sobre os
contratos do projeto — ADRs e specs prevalecem sobre qualquer exemplo genérico.

## Origem da documentação inicial

[prompts/create-app-documentation.md](../../prompts/create-app-documentation.md)
é o prompt mestre usado para produzir a documentação de produto e arquitetura:
uma entrevista iterativa que consolida decisões, cria `docs/` e só depois propõe
a decomposição em specs. Fica registrado para que uma futura revisão saiba como
o material foi gerado.

## Material de referência jurídica

`exemplos/` guarda cinco normas reais em Markdown, escolhidas por cobrirem
estruturas diferentes: Constituição Federal de 1988 (maior profundidade
hierárquica), Código Penal (volume e dispositivos revogados), Lei 14.133,
Lei Maria da Penha e LINDB (caso curto, e a norma onde a divergência entre
página compilada e anotada motivou a ADR-009).

Essas leis são o material previsto para as fixtures das Features 003 e 004.
