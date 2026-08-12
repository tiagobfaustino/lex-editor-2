# Pendências e Riscos

> Levantado em 2026-08-04. Pendência é trabalho previsto e ainda não feito;
> dívida é algo que já está no repositório e precisa de correção; risco é o que
> pode dar errado adiante.

> Atualização em 2026-08-12: as Features 001–010 estão concluídas. As seções
> datadas abaixo permanecem como histórico; o estado operacional atual está no
> `spec/FEATURE_INDEX.md` e nos `review.md` de cada feature.

## Resolvido em 2026-08-04

Dois bloqueadores que este documento registrava foram corrigidos e ficam aqui
como histórico:

- **`format:check` travava o pre-commit.** O Prettier reprovava os cinco
  arquivos de `exemplos/` — textos legais que não devem ser reformatados. Como
  o hook roda `lint && format:check`, nenhum commit passava sem `--no-verify`.
  `exemplos/` entrou no `.prettierignore`.
- **Todo o código estava fora do controle de versão.** O histórico parava em
  `dbc1416`, uma entrega só de documentação. `src/`, `packages/`, `tests/`, as
  configurações, a ADR-009 e o realinhamento documental entraram em dez commits
  na `master`.

## Resolvido em 2026-08-05

A Feature 001 foi fechada: T001-08 a T001-10 concluídas e os cinco critérios
de aceite demonstrados.

- **T001-08** — smoke E2E com Playwright/Electron sobre o app compilado
  (8 testes, inclusive preferências seguras da janela e allowlist IPC).
- **T001-09** — `electron-builder` escolhido, fuses aplicados e conferidos no
  binário por `scripts/inspect-bundle.mjs`, e CI mínima em
  `.github/workflows/ci.yml` (validate, e2e e package), verde na primeira
  execução. O que o script prova é o bit gravado de cada fuse, incluindo
  `EnableEmbeddedAsarIntegrityValidation`; ele não prova que a validação de
  integridade seja exercida em runtime — veja a dívida sobre integridade do
  asar no Linux.
- **T001-10** — todos os comandos executados (locais e no CI), bundle
  inspecionado (350 entradas no asar, apenas `zod` embarcado, sem AST, HTML
  bruto, paths ou secrets) e pacote aberto manualmente na estação de
  desenvolvimento.

Divergência resolvida durante a T001-09: a inspeção inicial esperava o fuse
`GrantFileProtocolExtraPrivileges` desligado, mas um A/B empírico mostrou que o
renderer deste app é servido por `file://` dentro do asar e o fuse precisa
ficar ligado (`electron-builder.yml` já estava correto; o `inspect-bundle.mjs`
é que tinha a expectativa errada e foi corrigido).

## Feature 001 — o que falta para fechar

Nada. T001-08 a T001-10 estão concluídas, os cinco critérios de aceite estão
marcados no `spec.md` e a feature está `done` no `FEATURE_INDEX.md`. O que
ficou em aberto não bloqueava o fechamento e está no `review.md` da feature.

## Escopo concluído desde o levantamento

As Features 002–010 implementaram o domínio jurídico, parser, Block IDs,
Formatter, importação/preview/exportação, revisão editorial, publicação segura,
atualizações legislativas, projeções completa/vigente e referências jurídicas
navegáveis. Não há feature ativa nem tarefa parcial no índice atual.

## Dívidas menores

- **`test:boundaries` fora do `npm test`.** O script existe e passa, mas não
  entra na suíte padrão; o CI o executa explicitamente, então o risco de
  esquecimento local ficou coberto.
- **Integridade do asar não é exercida no Linux.** O fuse
  `EnableEmbeddedAsarIntegrityValidation` está ligado e o
  `scripts/inspect-bundle.mjs` confere o bit, mas o `package.json` dentro do
  `app.asar` não tem bloco `ElectronAsarIntegrity`: o electron-builder só
  emite esse metadado para macOS e Windows. Como o Linux é a única plataforma
  empacotada até aqui, não há hash a validar e o fuse é inócuo. A ADR-007 §4
  pede validação de integridade "quando suportada", então a configuração está
  conforme — o que falta é construir em macOS/Windows para que a proteção
  passe a valer, e então reconferir com o mesmo script.
- **Playwright não dirige o binário empacotado, e nunca vai dirigir.** Não é
  limitação da estação: o launcher passa `--inspect=0` e espera a linha
  `Debugger listening on ws://…`, que o fuse `enableNodeCliInspectArguments:
  false` impede de existir. Um A/B no artefato confirmou — ligando só esse
  fuse o launch conecta, desligando volta a expirar. O fuse deve continuar
  desligado, então o smoke roda sobre o app compilado com configuração
  equivalente à produção, conforme o `playwright.config.ts`. Detalhes e
  consequências no `review.md` da Feature 001.
- **Ações de CI ainda em `@v4`.** O runner emite aviso de deprecação do Node
  20 para `actions/checkout@v4` e `actions/setup-node@v4`; subir para `@v5`
  em limpeza futura.
- **Tokens visuais são baseline.** Os valores oficiais de marca do Vinculex
  precisam substituir as cores atuais antes de a UI ser considerada pronta. A
  semântica dos nomes não muda.
- **`.playwright-mcp/`** existe como diretório de ferramenta local e já está no
  `.gitignore`; não tem relação com a T001-08.

## Riscos adiante

### Regressão de parser (crítico)

É o maior risco técnico do projeto, reconhecido em `SYSTEM_ARCHITECTURE.md`. Um
erro de reconhecimento produz texto jurídico incorreto que chega ao estudante.
Mitigação já decidida: validar contra leis reais e complexas — não fixtures
sintéticas — com dispositivos revogados, vetados e redações dadas por leis
posteriores; e exigir revisão humana obrigatória para todo nó de baixa
confiança, que não pode chegar silenciosamente à fase `identified`.

### Ambiguidade entre fontes oficiais (crítico, mitigado)

A ADR-009 e as Features 008–009 implementam e testam a separação entre fonte
compilada vigente e página anotada/histórica. Conflitos continuam exigindo
decisão editorial explícita e permanecem um risco de regressão a ser coberto
pelas fixtures reais.

### Colisão e estabilidade de Block ID (crítico)

O ID precisa sobreviver a alteração de texto, revogação, renumeração e inserção
de dispositivo intermediário (`Art. 121-A` entre 121 e 122). Um ID instável
quebra links do Obsidian, notas e favoritos já ancorados no SaaS.

### Fronteira de segurança do Electron (alto)

Hoje a fronteira é mínima porque só existe uma capacidade. O risco cresce a
cada capacidade nova — importação por URL (SSRF, redirect), arquivo local
(traversal, symlink), Git (injeção de argumento). O contrato de validação
comum já está pronto para recebê-las; o risco é alguém contorná-lo criando um
canal genérico.

### Overengineering visual (baixo, já mitigado)

Registrado no `spec.md` da Feature 001 e mitigado limitando a UI ao shell
necessário.

## Próxima sequência

1. Manter a suíte e as fixtures reais das Features 001–010 verdes.
2. Tratar as dívidas menores acima sem misturá-las a uma nova feature.
3. Especificar e ativar a Feature 011 somente após definir seu resultado
   verificável e dependências no `FEATURE_INDEX.md`.
