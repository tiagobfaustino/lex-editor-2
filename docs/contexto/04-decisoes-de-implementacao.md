# Decisões de Implementação

> Consolida o "porquê" que hoje está espalhado entre ADRs, `plan.md` da Feature
> 001 e o próprio código. Decisão arquitetural duradoura vira ADR; o que está
> aqui é registro de contexto, não nova autoridade.

## Decisões de método

### Documentação antes de código

Nenhuma linha de aplicação foi escrita antes de a arquitetura, o modelo de
dados e as ADRs estarem aceitos. O motivo é o risco central do produto: um erro
de reconhecimento jurídico se propaga silenciosamente até o estudante que usa o
SaaS. Contratos escritos primeiro permitem que uma implementação errada seja
identificada como violação, e não como opinião.

### Features verticais, não camadas horizontais

O roadmap tem 9 fases sequenciais por camada (parser → AST → IDs → formatter).
As specs reorganizaram isso em 8 features onde a **003 corta as Fases 1 a 4
inteiras** sobre uma fixture pequena. A alternativa — construir o parser
completo, depois a AST completa, depois os IDs — adiaria para muito tarde a
descoberta de incompatibilidade entre AST, IDs e serialização.

### Uma feature `in_progress` por vez

`spec/README.md` permite exceção só por decisão explícita no `FEATURE_INDEX.md`.
Isso evita que uma fundação incompleta seja consumida por código jurídico que
depois precise ser reescrito.

### Segurança como ponto de partida, não como endurecimento posterior

A Feature 001 entrega uma janela já endurecida antes de existir qualquer
funcionalidade. `spec.md` registra o motivo: começar pelo parser dentro do
renderer criaria acoplamento e autoridade difíceis de remover depois.

## Decisões de produto e domínio

### Git como fonte canônica, banco como cópia de leitura

ADR-003. Leis mudam raramente e exigem auditoria: quem alterou, quando e por
quê. Git dá diff textual, histórico, revisão por PR e rollback trivial. O
Supabase nunca é editado diretamente — ele reflete o que está no Git.

### Block ID marca posição jurídica, não redação

ADR-001. O ID de um dispositivo sobrevive à mudança de texto, à revogação e à
renumeração; IDs publicados formam um namespace append-only. O valor é
persistido sem `^`; o Formatter acrescenta o prefixo ao gerar a âncora
Obsidian.

### Proibição do campo genérico `status`

ADR-005 e regra 9 de `DEVELOPMENT_RULES.md`. Um `status` genérico acumularia
significados incompatíveis (estado do dispositivo, da publicação, da pendência)
no mesmo nome. Cada contexto usa um nome próprio — `deviceStatus` para o
dispositivo, com oito valores fechados.

### Duas fases de AST no tipo, não em convenção

ADR-002. `ParsedNormaAST` proíbe Block IDs; `IdentifiedNormaAST` os exige em
todo nó referenciável, e é a única fase aceita por Formatter, persistência e
publicação. A distinção é estrutural para que o compilador impeça publicar uma
árvore não identificada.

### Conjunto de fontes, não fonte única

ADR-009, a decisão mais recente (2026-07-31). Descoberta ao estudar as fontes
reais em `exemplos/`: o Planalto publica página compilada *e* página anotada
para a mesma norma, e nenhuma das duas basta sozinha. A compilada dá a redação
vigente; a anotada dá o histórico. Consequência prática que a ADR fixa: a
ausência de um dispositivo na compilada **não** prova revogação — a
reconciliação precisa considerar a última versão publicada e os marcadores
oficiais.

### Nenhuma autoridade de produção no Electron

ADR-007. O renderer é não confiável; o processo main não possui a secret
administrativa do Supabase; a estação só pode empurrar para
`releases/{publicationId}`. Só o Serviço de Publicação server-side promove o
SHA ao branch protegido. Uma estação comprometida não consegue publicar.

## Decisões de toolchain

Registradas no `plan.md` da Feature 001 conforme a regra 11 — nenhuma
dependência entra sem finalidade e alternativa registradas.

| Escolha | Motivo | Alternativa rejeitada |
|---|---|---|
| `typescript@6.0.2` | Verificador compartilhado do workspace | Confiar só no transpiler do Vite (não verifica contratos); TS 7 está fora da faixa suportada pelo `typescript-eslint@8.65.0` |
| `@types/node@22.20.1` | Alinhado à linha Node 22 usada em dev e no main | Tipos da versão mais nova declarariam APIs ausentes no runtime real |
| Node `>=22.15.0`, npm `>=10.9.0` | Baseline validada no ambiente de desenvolvimento | Mudança de linha principal exigiria revalidar Electron e toolchain |
| ESLint 10 flat config + `typescript-eslint` estrito com tipos | Enforcement das fronteiras entre camadas com informação de tipo | Lint sem análise tipada não detecta usos inseguros dependentes do tipo resolvido |
| `prettier@3.9.6` separado do lint | Uma única autoridade de formatação | Duplicar regras estilísticas no ESLint |
| `zod@4.4.3` | Schemas fechados nos dois lados da ponte, tipo inferido do schema | Validação manual duplicaria contratos e divergiria do tipo |
| `electron@43.2.0` fixo | Chromium e APIs nativas não mudam silenciosamente | Faixa aberta de versão |
| `electron-vite@5` + `vite@7.3.6` | Build dos três processos | Vite 8 está fora da peer range do electron-vite 5; scaffold pronto traria permissões e APIs genéricas não revisadas |
| `vitest@4.1.10` antecipado em T001-05 | A fronteira IPC é de risco alto e não podia ficar sem evidência automatizada | Adiar todo teste para o fim da feature |
| React 19 em vez de DOM manual | O placeholder manual não sustentaria as áreas e estados incrementais das próximas features | Manter manipulação direta do DOM |
| npm scripts como interface canônica | Alinhados ao roadmap já escrito | Task runner adicional |

### Preload em CommonJS

Decisão específica e não óbvia: o pacote raiz é `"type": "module"`, mas o
preload é empacotado como `.cjs`. Preloads associados a um renderer *sandboxed*
não executam em contexto ESM. A escolha foi gerar o formato compatível — não
reduzir o isolamento da janela.

### Tamanho de payload medido com `v8.serialize`

O limite de IPC podia ser estimado por `JSON.stringify`. `node:v8.serialize` foi
preferido porque reflete o custo real do algoritmo de clonagem estruturada que
o Electron usa, e porque falha de forma detectável em valores não
serializáveis — que viram `INVALID_INPUT` em vez de passar adiante.

### Erro redigido com mensagem fixa

Toda falha da ponte devolve um dos quatro códigos com mensagem pré-escrita.
Nenhuma mensagem é construída a partir da exceção original. Isso implementa a
regra 15 (erro não vira sucesso) e o invariante de que nem path, nem ambiente,
nem stack atravessam a fronteira.

### Tokens visuais como baseline explicitamente substituível

Os valores oficiais de marca do Vinculex não estão no repositório. O `plan.md`
registra que as cores atuais são baseline e que o contrato real são os **nomes**
dos tokens — interface, severidade e estado jurídico separados, e cor nunca
carregando significado sem rótulo textual ao lado.
