# Plano de Implementação — Feature 001

## Abordagem

Criar workspace npm com configurações compartilhadas e quatro fronteiras:
domínio, main, preload/IPC e renderer. Partir de uma janela mínima já
endurecida, em vez de adicionar segurança depois.

## Componentes afetados

- `package.json` e configs raiz: scripts e workspaces.
- `packages/legal-domain/`: pacote puro inicialmente vazio.
- `src/main/`: ciclo Electron e criação segura da janela.
- `src/preload/`: API mínima versionada.
- `src/shared/ipc/`: schemas e DTOs permitidos.
- `src/renderer/`: shell e tokens visuais.
- `.github/workflows/`: lint, typecheck e testes.

## Contratos e fluxo

Renderer solicita uma capacidade declarada no preload; preload envia DTO
validado; main revalida origem/frame/schema e retorna DTO seguro. Nenhuma
referência do Electron entra no pacote de domínio.

### Matriz de dependências entre camadas

| Origem | Pode importar | Não pode importar |
|---|---|---|
| `packages/legal-domain` | módulos internos e dependências puras aprovadas | Electron, React, Node, filesystem, rede, banco e qualquer `src/` |
| `src/shared/ipc` | módulos internos e bibliotecas de schema aprovadas | domínio integral, main, preload, renderer, Node e Electron |
| `src/main` | domínio e contratos de `shared/ipc` | preload e renderer |
| `src/preload` | contratos de `shared/ipc` e APIs Electron necessárias à ponte | domínio, main e renderer |
| `src/renderer` | contratos DTO de `shared/ipc`, React e bibliotecas de UI | domínio, main, preload, Node, Electron e recursos privilegiados |

Imports relativos não podem atravessar a raiz de uma camada. O renderer recebe
projeções DTO próprias; ele não reutiliza a NormaAST por conveniência. O pacote
de domínio expõe somente seu ponto público declarado em `exports`.

`T001-02` estabelece este contrato e o isolamento estrutural do pacote.
`T001-03` o transforma em restrições automatizadas do ESLint para todas as
camadas, quando os respectivos diretórios existirem.

## Decisões locais

- npm scripts permanecem canônicos para alinhar o roadmap existente.
- ESLint aplica restrições de import entre camadas.
- O smoke E2E testa aplicação empacotada ou configuração equivalente à
  produção, não apenas página Vite isolada.
- Os nomes dos tokens distinguem interface, severidade e estado jurídico; as
  cores não carregam significado sem rótulo textual. Como os valores oficiais
  de marca do Vinculex não constam no repositório, os valores visuais da
  fundação são uma baseline substituível sem alterar a semântica dos tokens.

## Dependências da toolchain

- `typescript@6.0.2`: compilador e verificador de tipos compartilhado. A
  alternativa de depender apenas do transpiler do Vite foi rejeitada porque
  não verifica todos os contratos do workspace. A versão 7 foi avaliada e
  rejeitada nesta etapa porque ainda está fora da faixa oficialmente suportada
  pelo `typescript-eslint@8.65.0`.
- `@types/node@22.20.1`: tipos alinhados à linha Node 22 usada no
  desenvolvimento e no processo main. A alternativa de usar os tipos da
  versão corrente mais nova foi rejeitada para não declarar APIs ausentes no
  runtime suportado.
- Node `>=22.15.0` e npm `>=10.9.0`: baseline inicial do workspace, compatível
  com o ambiente de desenvolvimento validado. Uma mudança de linha principal
  exige revalidar Electron e a toolchain.
- `eslint@10.8.0`, `@eslint/js@10.0.1` e `typescript-eslint@8.65.0`: lint em
  flat config, regras estritas com informação de tipos e enforcement das
  fronteiras. A alternativa sem análise tipada não detectaria usos inseguros
  que dependem do tipo resolvido.
- `prettier@3.9.6`: formatação determinística separada do lint. Regras
  estilísticas duplicadas no ESLint foram evitadas para manter uma única
  autoridade de formatação.
- `eslint-plugin-react-hooks@7.1.1` e
  `eslint-plugin-react-refresh@0.5.3`: regras específicas do renderer React e
  do HMR do Vite. Adiar essas regras até existir UI deixaria o primeiro código
  React nascer fora do baseline.
- `globals@17.8.0`: conjuntos explícitos de globais Node e browser por camada,
  em vez de habilitar ambientes implicitamente.
- `electron@43.2.0`: runtime desktop. A versão acompanha a baseline Node 22 e
  será fixada no lockfile para que Chromium e APIs nativas não mudem
  silenciosamente. Como essa distribuição expõe o download do runtime pelo
  binário `install-electron`, o script raiz `postinstall` o executa também em
  instalações limpas.
- `electron-vite@5.0.0`, `vite@7.3.6` e `@swc/core@1.15.47`: build e
  desenvolvimento dos três processos. Vite 8 foi rejeitado porque está fora
  da faixa de peer dependency do electron-vite 5; um scaffold gerado foi
  evitado para não importar permissões ou APIs genéricas não revisadas.
- `zod@4.4.3`: schemas fechados para entradas, saídas e erros IPC, usados nos
  dois lados da ponte. Validação manual foi rejeitada porque duplicaria
  contratos e facilitaria divergência entre tipo e runtime.
- `vitest@4.1.10`: introduzido antecipadamente em `T001-05` para os testes
  negativos obrigatórios da fronteira IPC e completado em `T001-07` com o
  comando canônico `npm test`, allowlist de registro e guardas de
  janela/sessão. Adiar todo teste deixaria uma fronteira de alto risco sem
  evidência automatizada.
- `react@19.2.8`, `react-dom@19.2.8`, `@types/react@19.2.18` e
  `@types/react-dom@19.2.4`: camada declarativa do shell renderer, inicializada
  por `createRoot` e verificada em modo estrito. Manipulação manual do DOM foi
  usada apenas no placeholder inicial e foi substituída porque não oferece uma
  base adequada para as áreas e estados incrementais das próximas features.
- O preload é empacotado como CommonJS (`.cjs`). Preloads associados a um
  renderer sandboxed não executam em contexto ESM, ainda que o pacote raiz use
  `"type": "module"`; manter o sandbox e gerar o formato compatível foi
  preferido a reduzir o isolamento da janela.

## Erros e recuperação

- Falha de inicialização mostra erro local sem expor ambiente.
- IPC inválido retorna erro tipado/redigido e registra evento mínimo.
- Falha de build/test encerra CI; não há etapa permissiva.

## Estratégia de validação

- Unitário das funções de configuração e schemas IPC.
- Integração negativa de frame/origem/payload.
- Smoke Playwright Electron.
- Inspeção do bundle por padrões proibidos.

## Ordem

1. Workspace e configs.
2. Domínio vazio com regra de imports.
3. Main/preload/IPC seguro.
4. Shell renderer.
5. testes, build e CI.

## Não fazer

- Não adicionar importação real, parser ou filesystem genérico.
- Não relaxar sandbox para facilitar desenvolvimento.
