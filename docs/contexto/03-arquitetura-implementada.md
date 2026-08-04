# Arquitetura Implementada

> O que existe em código hoje, não o que está planejado. Para o desenho
> completo do ecossistema, ver `../architecture/SYSTEM_ARCHITECTURE.md`.

## As cinco camadas e suas fronteiras

A fundação materializa cinco camadas com direção de dependência fixa. Um
import proibido é erro de lint, não convenção verbal.

| Origem | Pode importar | Não pode importar |
|---|---|---|
| `packages/legal-domain` | módulos internos e dependências puras aprovadas | Electron, React, Node, filesystem, rede, banco, qualquer `src/` |
| `src/shared/ipc` | módulos internos e bibliotecas de schema | domínio integral, main, preload, renderer, Node, Electron |
| `src/main` | domínio e contratos de `shared/ipc` | preload e renderer |
| `src/preload` | contratos de `shared/ipc` e APIs Electron da ponte | domínio, main, renderer |
| `src/renderer` | DTOs de `shared/ipc`, React e UI | domínio, main, preload, Node, Electron |

A matriz vive em [eslint.config.js](../../eslint.config.js), que gera as regras
`no-restricted-imports` por camada — inclusive a lista completa de builtins do
Node, nas duas grafias (`fs` e `node:fs`). O renderer não recebe a NormaAST por
conveniência: ele consome projeções DTO próprias.

[tests/config/eslint-boundaries.test.mjs](../../tests/config/eslint-boundaries.test.mjs)
executa o ESLint programaticamente sobre cinco casos proibidos e três
permitidos, provando que a regra existe *e* que ela não bloqueia o import
legítimo.

## Processo main

| Arquivo | Responsabilidade |
|---|---|
| [src/main/index.ts](../../src/main/index.ts) | Ciclo de vida: instala guardas antes do `whenReady`, nega permissões da sessão, remove o menu, registra IPC e abre a janela |
| [src/main/security.ts](../../src/main/security.ts) | `webPreferences` seguras, endurecimento de todo `WebContents` e negação de permissões |
| [src/main/window.ts](../../src/main/window.ts) | Criação da `BrowserWindow`, carregamento do renderer e erro local sem vazar ambiente |
| [src/main/renderer-location.ts](../../src/main/renderer-location.ts) | Resolve e valida a origem confiável do renderer |
| [src/main/ipc/register.ts](../../src/main/ipc/register.ts) | Allowlist de canais; devolve uma função de descarte |
| [src/main/ipc/validated-handler.ts](../../src/main/ipc/validated-handler.ts) | Pipeline de validação comum a toda capacidade |

### Preferências efetivas da janela

`createSecureWebPreferences` congela o objeto e fixa: `contextIsolation` e
`sandbox` ligados, `nodeIntegration`, `webviewTag`, `experimentalFeatures`,
`allowRunningInsecureContent`, `navigateOnDragDrop` e `spellcheck` desligados,
`webSecurity` ligado. `devTools` é a única chave condicional — habilitada
apenas fora do pacote, sem afetar as demais.

`hardenWebContents` cancela `will-attach-webview`, `will-navigate`,
`will-frame-navigate` e `will-redirect`, e nega toda abertura de janela. Isso é
instalado no evento `web-contents-created` do `app`, ou seja, vale para
qualquer `WebContents` criado, não só o principal.

`denyAllSessionPermissions` responde `false` a toda verificação e toda
solicitação de permissão da sessão padrão.

### Origem confiável

`resolveRendererLocation` produz uma união discriminada:

- **produção**: exige URL `file:` — qualquer outro protocolo lança;
- **desenvolvimento**: exige HTTP em loopback (`127.0.0.1`, `::1`,
  `localhost`), sem usuário ou senha embutidos, e guarda a origem exata.

`isTrustedRendererUrl` compara origem exata em desenvolvimento e href exato em
produção, tratando URL inválida como não confiável.

## Fronteira IPC

O fluxo de uma capacidade, em ordem:

```text
renderer  →  window.lexDesktop.app.getVersion()
preload   →  ipcRenderer.invoke('app:get-version', {})   [DTO congelado]
main      →  executeValidatedIpcHandler
             1. remetente confiável?  (webContents === janela principal,
                senderFrame vivo, é o mainFrame, URL confiável)
             2. payload serializável e dentro do limite?  (v8.serialize)
             3. schema de entrada aprova?  (zod strictObject)
             4. authorize(input) aprova?
             5. handle(input) executa
             6. schema de saída aprova?
             7. saída dentro do limite?
preload   →  revalida o resultado com o mesmo schema
renderer  →  recebe IpcResult<T> discriminado por `ok`
```

Qualquer falha vira um `DesktopErrorDto` redigido — `INVALID_INPUT`,
`PAYLOAD_TOO_LARGE`, `NOT_ALLOWED` ou `FAILED` — com mensagem fixa em
português e flag `retryable`. Exceção do handler é capturada e convertida em
`FAILED`: o erro nunca vaza stack, path ou ambiente para o renderer, e nunca é
convertido em sucesso.

O limite padrão é 16 KiB por direção; `app:get-version` reduz para 256 bytes
nos dois sentidos. O tamanho é medido com `node:v8.serialize`, que reflete o
custo real do canal estruturado do Electron.

[src/shared/ipc/desktop-api.ts](../../src/shared/ipc/desktop-api.ts) é a fonte
única do contrato: canal, versão da API, lista de capacidades, schemas zod e
tipos inferidos dos mesmos schemas — tipo e validação runtime nascem juntos,
conforme a regra 8 de `spec/DEVELOPMENT_RULES.md`.

A superfície exposta hoje é uma capacidade só:

```ts
window.lexDesktop = {
  version: 1,
  capabilities: ['app.getVersion'],
  app: { getVersion(): Promise<AppGetVersionResult> },
}
```

`ipcRenderer` não é exposto. Não existe canal genérico de execução, shell,
arquivo, Git ou banco — e a ausência é intencional: capacidades futuras entram
nomeadas, uma a uma.

## Renderer

[src/renderer/src/app.tsx](../../src/renderer/src/app.tsx) implementa o shell
previsto na Fase 0 do roadmap: navegação lateral (Importação, Preview,
Fila de Atualizações e Configuração de Fontes, as duas últimas desabilitadas),
painel de Importação com formulário inteiro em `disabled`, painel de Preview
vazio com legenda de estados jurídicos, e painel colapsável de Logs e validação
com legenda de severidades.

O componente consulta `app.getVersion()` uma vez e degrada para "Integração
indisponível" quando a ponte não existe ou o resultado não é `ok` — o shell
funciona no navegador puro sem quebrar.

Acessibilidade já considerada: skip link, `aria-label` nas regiões,
`aria-expanded`/`aria-controls` no colapso, `aria-disabled` nos itens
indisponíveis e cor sempre acompanhada de rótulo textual.

[src/renderer/src/styles.css](../../src/renderer/src/styles.css) define os
tokens em três famílias que não se misturam:

- **interface** — `--color-ink`, `--color-canvas`, `--color-surface`,
  `--color-brand`, `--color-accent`, `--color-focus`;
- **estado jurídico** — `--color-legal-active`, `-revoked`, `-vetoed`,
  `-amended`;
- **severidade** — `--color-severity-error`, `-warning`, `-info`.

Os valores são baseline substituível; a semântica dos nomes é o contrato.

## Content Security Policy

[electron.vite.config.ts](../../electron.vite.config.ts) injeta a CSP como meta
tag no `head`, antes de qualquer outra tag. A política de produção é
`default-src 'none'` com `script-src`, `style-src`, `img-src` e `font-src`
limitados a `'self'`; `connect-src`, `object-src`, `base-uri`,
`frame-ancestors` e `form-action` são bloqueados. Em desenvolvimento a única
diferença é `connect-src 'self' ws:`, necessária para o HMR do Vite.

O renderer também usa `assetsInlineLimit: 0`, para que nenhum asset vire data
URI e escape da política.

## Pacote de domínio

[packages/legal-domain/src/index.ts](../../packages/legal-domain/src/index.ts)
contém apenas `export {}` e um comentário. O pacote existe hoje para fixar o
ponto público (`exports` no `package.json`), o isolamento de compilação
(`types: []` no tsconfig, sem tipos do Node) e a regra de lint. O conteúdo
jurídico entra na Feature 002.

## Configuração TypeScript

Um `tsconfig.base.json` estrito, referenciado por três projetos compostos:

| Projeto | Módulo | Libs | Cobre |
|---|---|---|---|
| `tsconfig.node.json` | NodeNext | ES2022 | configs, `src/main`, `src/preload`, `src/shared`, `tests` |
| `tsconfig.renderer.json` | ESNext / Bundler | ES2022 + DOM | `src/renderer`, `src/shared` |
| `packages/legal-domain/tsconfig.json` | NodeNext | ES2022, `types: []` | domínio, único que emite `dist/` |

A separação garante que o renderer não enxergue tipos do Node e que o domínio
não enxergue nenhum ambiente.
