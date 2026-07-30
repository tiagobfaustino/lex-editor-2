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

## Decisões locais

- npm scripts permanecem canônicos para alinhar o roadmap existente.
- ESLint aplica restrições de import entre camadas.
- O smoke E2E testa aplicação empacotada ou configuração equivalente à
  produção, não apenas página Vite isolada.

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
