# Pendências e Riscos

> Levantado em 2026-08-04. Pendência é trabalho previsto e ainda não feito;
> dívida é algo que já está no repositório e precisa de correção; risco é o que
> pode dar errado adiante.

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
- **T001-09** — `electron-builder` escolhido, fuses aplicados, integridade do
  asar verificada por `scripts/inspect-bundle.mjs` e CI mínima em
  `.github/workflows/ci.yml` (validate, e2e e package), verde na primeira
  execução.
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

Nada. T001-08 a T001-10 estão concluídas e os cinco critérios de aceite estão
marcados no `spec.md`. Falta apenas o ato administrativo de promover a feature
para `done` no `FEATURE_INDEX.md` e, só então, ativar a Feature 002.

## Pendências de escopo já previstas

Não são atrasos; são o roadmap.

- domínio jurídico (`packages/legal-domain` está vazio) — Feature 002;
- parser, Block IDs e Formatter sobre fixture pequena — Feature 003;
- gramática normativa completa e as três leis de referência — Feature 004;
- importação real, preview e exportação no Electron — Feature 005;
- correção editorial, validação bloqueante e `UPDATE.md` — Feature 006;
- release candidate, Serviço de Publicação e rollback — Feature 007;
- worker de atualização legislativa — Feature 008.

## Dívidas menores

- **`test:boundaries` fora do `npm test`.** O script existe e passa, mas não
  entra na suíte padrão; o CI o executa explicitamente, então o risco de
  esquecimento local ficou coberto.
- **`chrome-sandbox` sem setuid na estação de desenvolvimento.** O binário
  empacotado só abre localmente com `--no-sandbox`; em `.deb`/AppImage o
  electron-builder trata isso, mas vale registrar como nota de ambiente.
- **Playwright não conecta no binário empacotado nesta estação** (timeout no
  launch). O smoke roda sobre o app compilado com configuração equivalente à
  produção, conforme decisão registrada no `playwright.config.ts`.
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

### Ambiguidade entre fontes oficiais (crítico)

A ADR-009 resolveu o desenho, mas a implementação ainda precisa provar que o
adaptador separa com segurança texto vigente, texto superado e nota editorial
na página anotada do Planalto, e que ausência na compilada nunca é tratada como
revogação.

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

## Sugestão de sequência

1. ~~Fechar T001-08~~ — feito em 2026-08-05.
2. ~~Fechar T001-09~~ — feito em 2026-08-05.
3. ~~Fechar T001-10~~ — feito em 2026-08-05.
4. Marcar a Feature 001 como `done` no `FEATURE_INDEX.md` e só então ativar a
   Feature 002.
