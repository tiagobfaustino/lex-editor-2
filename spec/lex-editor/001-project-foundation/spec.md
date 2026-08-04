# Feature 001 — Fundação do projeto

## Metadados

- `implementation_status`: in_progress
- `priority`: P0
- `owner`: não atribuído

## Objetivo

Entregar um workspace executável com shell Electron seguro, pacote de domínio
isolado, qualidade automatizada e um smoke test. A feature termina sem lógica
jurídica, mas deixa as fronteiras corretas prontas para recebê-la.

## Problema

Começar pelo parser dentro do renderer criaria acoplamento e autoridade
difíceis de remover. A fundação precisa tornar o caminho seguro o caminho
padrão antes da primeira funcionalidade real.

## Escopo

- Workspace TypeScript com `packages/legal-domain`, `src/main`,
  `src/renderer` e `src/shared/ipc`.
- Electron + Vite + React com desenvolvimento e build local.
- Preload com capacidades nomeadas e nenhum `ipcRenderer` exposto.
- Preferências de segurança, CSP, bloqueio de navegação/popup/permissões e
  DTOs mínimos.
- ESLint, Prettier, Vitest, Playwright e CI mínima.
- Shell com Importação, Preview e Logs ainda vazios.
- Tokens visuais essenciais, inclusive estados jurídicos.

## Fora do escopo

- Parser, NormaAST, Block IDs ou Formatter.
- Download de URL e leitura arbitrária de arquivos.
- Git, Supabase, autenticação editorial ou publicação.
- Acabamento visual definitivo.

## Dependências

- Nenhuma feature anterior.
- `../../../docs/architecture/ADR-007-fronteira-segura-publicacao.md`
- `../../../docs/architecture/SYSTEM_ARCHITECTURE.md`
- `../../../docs/lex-editor/ROADMAP.md`, Fase 0.

## Requisitos

- RF-001-01: `npm run dev` abre o shell sem conceder Node ao renderer.
- RF-001-02: `npm run build` produz pacote de desenvolvimento instalável.
- RF-001-03: IPC rejeita canal, origem, frame, schema ou tamanho inválido.
- RF-001-04: domínio compila sem importar Electron, React, filesystem ou rede.
- RF-001-05: lint, typecheck, testes e smoke E2E são comandos reproduzíveis.

## Invariantes

- Renderer é não confiável.
- Nenhum secret ou path real atravessa a ponte.
- Não existe canal IPC genérico de execução, shell, arquivo, Git ou banco.
- Falha de validação IPC é negação, nunca fallback permissivo.

## Cenários essenciais

### Inicialização

Dado um checkout limpo, quando dependências são instaladas e `npm run dev` é
executado, então o shell abre com as três áreas e sem erro crítico.

### IPC forjado

Dado um frame ou payload não autorizado, quando chama uma capacidade, então o
main rejeita a solicitação e não executa efeito privilegiado.

## Critérios de aceite

- [ ] Scripts de dev, build, lint, typecheck, unitário e E2E passam.
- [ ] Smoke test abre e fecha a aplicação.
- [ ] Teste confirma as preferências seguras da janela e a allowlist IPC.
- [ ] Bundle/DTOs não contêm AST, HTML bruto, paths ou secrets.
- [ ] Limites entre domínio, main, preload e renderer estão documentados.

## Validação mínima

- Risco: alto, por estabelecer fronteira de segurança.
- Automatizar smoke, IPC negativo, preferências da janela e imports proibidos.
- Validar manualmente o pacote gerado na plataforma de desenvolvimento.

## Riscos

- Template introduzir defaults inseguros: testar configuração efetiva.
- Overengineering visual: limitar UI ao shell necessário.
- Dependência circular entre camadas: usar regras de import no lint.
