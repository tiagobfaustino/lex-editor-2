---
name: lex-editor-electron
description: Implementa, revisa e depura a camada desktop Electron do Lex Editor com fronteiras seguras entre main, preload e renderer. Use em tarefas de BrowserWindow, IPC, contextBridge, acesso a arquivos, rede, Git, APIs nativas, empacotamento ou hardening. Não use para regras puramente jurídicas, domínio sem integração desktop ou estilização isolada do renderer.
---

# Lex Editor Electron

Trate Electron como uma fronteira de segurança, não apenas como um contêiner
para a interface. Preserve os contratos do Lex Editor e exponha ao renderer
somente capacidades pequenas, nomeadas e validadas.

## Preparar o trabalho

1. Leia `AGENTS.md` na raiz.
2. Leia `spec/README.md`, `spec/DEVELOPMENT_RULES.md`,
   `spec/TEST_STRATEGY.md` e `spec/FEATURE_INDEX.md`.
3. Identifique a feature ativa e leia integralmente seus `spec.md`, `plan.md`
   e `tasks.md`. Não implemente uma feature futura silenciosamente.
4. Leia `docs/architecture/ADR-007-fronteira-segura-publicacao.md`.
5. Consulte a documentação atual do Electron antes de usar ou alterar APIs da
   biblioteca. Não presuma que exemplos ou defaults antigos continuam válidos.

ADRs e especificações do projeto prevalecem sobre qualquer exemplo genérico
desta skill. Relate um conflito real em vez de enfraquecer o contrato.

## Escolher a referência

- Leia [references/secure-architecture.md](references/secure-architecture.md)
  para criar janelas, controlar navegação/permissões ou integrar filesystem,
  rede e Git.
- Leia [references/ipc-capabilities.md](references/ipc-capabilities.md) para
  desenhar ou revisar preload, canais IPC, DTOs e validação de remetente.
- Leia
  [references/packaging-validation.md](references/packaging-validation.md)
  para empacotamento, assinatura, fuses, testes e revisão de segurança.

Carregue apenas as referências necessárias à tarefa.

## Aplicar os invariantes

### Janela e renderer

- Configure explicitamente `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` e `webSecurity: true`.
- Carregue apenas o bundle local controlado pelo aplicativo.
- Negue por padrão novas janelas, navegação, permissões e conteúdo remoto.
- Não use `webview`, execução dinâmica de código ou conteúdo remoto com
  privilégios Node/Electron.

### Preload e IPC

- Exponha capacidades específicas e versionáveis com `contextBridge`.
- Nunca exponha `ipcRenderer`, eventos Electron, filesystem, rede, shell, Git
  ou um executor genérico diretamente ao renderer.
- Faça callbacks entregarem somente DTOs serializáveis; descarte o argumento
  de evento e retorne uma função de cancelamento.
- No processo main, valide remetente e frame, esquema, tamanho, autorização e
  estado para toda chamada. Trate payloads do renderer como hostis.

### Dados e efeitos privilegiados

- Faça o renderer trafegar IDs opacos e metadados seguros, nunca caminhos
  reais, HTML bruto, AST interno, segredos ou credenciais.
- Escolha arquivos e destinos no main por APIs nativas e mantenha o
  mapeamento de IDs para caminhos fora do renderer.
- Restrinja filesystem a raízes autorizadas; resolva caminho real e rejeite
  traversal, symlinks inesperados e mudanças fora da raiz.
- Execute rede no main com protocolos, hosts, redirecionamentos, DNS, tamanho
  e tempo limitados conforme o ADR-007.
- Execute Git sem shell, com argumentos separados e branch candidata; nunca
  encaminhe credenciais protegidas ao renderer.
- Retorne erros tipados e sanitizados. Registre detalhes sensíveis apenas no
  lado privilegiado e de forma apropriada.

## Validar proporcionalmente ao risco

Siga `spec/TEST_STRATEGY.md`. Para mudanças na fronteira Electron, teste no
mínimo o caminho feliz e as negações relevantes: payload inválido, remetente
forjado, navegação/janela/permissão bloqueada, XSS sem escalada de privilégio,
traversal/symlink, SSRF e ausência de segredos no renderer ou pacote.

Inclua tipo, validação runtime e testes essenciais na mesma tarefa. Em
mudanças de empacotamento, verifique também o artefato produzido e os fuses.

## Limitar o escopo

Não adicione auto-update, deep links, tray, protocolo customizado ou outra API
nativa apenas porque Electron a oferece. Implemente essas capacidades somente
quando uma feature ativa exigir e especificar seus limites.

## Navegar no repositório

Este repositório exige orientação via graphify (ver `CLAUDE.md` e os hooks
`PreToolUse` em `.claude/settings.json`). Quando `graphify-out/graph.json`
existir, comece por `graphify query "<pergunta>"` antes de grep ou leitura
ampla, e rode `graphify update .` depois de alterar código. Leia diretamente os
arquivos que precisar citar ou editar.

---

Esta adaptação parte da skill MCP Market `desktop-framework-electron` e usa os
contratos do Lex Editor. Origem versionada:
`.agents/skills/lex-editor-electron/`.
