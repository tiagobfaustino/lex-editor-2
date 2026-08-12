# Arquitetura Electron segura

Use esta referência ao alterar `BrowserWindow`, navegação, permissões, APIs
nativas ou integrações privilegiadas.

## Zonas de confiança

| Zona | Confiança | Responsabilidade |
| --- | --- | --- |
| Renderer | não confiável | apresentação, interação e DTOs seguros |
| Preload | fronteira mínima | adaptar capacidades explícitas |
| Main | privilegiada | autorização, validação e efeitos |
| Filesystem/rede/Git | externos | somente via serviços controlados do main |

Uma vulnerabilidade XSS no renderer não pode se transformar em leitura de
arquivo, execução de processo, acesso de rede arbitrário ou extração de
credenciais.

## Configuração mínima da janela

Defina as opções de segurança de forma explícita, mesmo quando coincidirem com
defaults atuais:

```ts
const window = new BrowserWindow({
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  },
});
```

Além disso:

- carregue somente o arquivo ou origem local esperada;
- bloqueie toda navegação inesperada em `will-navigate`;
- use `setWindowOpenHandler(() => ({ action: "deny" }))`;
- negue permissões por padrão com handlers de sessão;
- remova menus e atalhos de desenvolvimento do pacote de produção quando
  aplicável;
- não desabilite isolamento, sandbox ou `webSecurity` para contornar falhas.

Links externos devem passar por uma capacidade específica no main. Valide a
URL com `URL`, permita apenas protocolos e hosts definidos e só então use a
API do sistema. Não encaminhe uma string arbitrária para `shell.openExternal`.

## Filesystem

O renderer solicita uma intenção, não um caminho:

```text
renderer -> source:select-local({ kind: "document" })
main     -> diálogo nativo + registro interno
main     -> { sourceId, displayName, mediaType, size }
```

Mantenha no main o mapa entre ID opaco e caminho real. Antes de ler ou gravar:

1. valide o ID, o estado e a autorização;
2. derive o caminho somente de dados controlados pelo main;
3. normalize e resolva o caminho real;
4. confirme que permanece dentro da raiz permitida;
5. trate symlinks, traversal, troca de arquivo e limites de tamanho;
6. para gravação durável, use arquivo temporário, sincronização e rename
   atômico quando o filesystem suportar.

Não crie capacidades genéricas como `readFile(path)` ou `writeFile(path,
content)`.

## Rede

Faça requisições no main e aplique os controles do ADR-007:

- permita somente protocolos e destinos necessários;
- resolva e verifique DNS/IP contra redes privadas, loopback e destinos
  proibidos;
- revalide cada redirecionamento;
- limite tempo, tamanho, tipo e quantidade de respostas;
- não aceite proxy, headers ou credenciais arbitrários vindos do renderer;
- sanitize erros e metadados retornados.

## Git e processos

Use API de biblioteca ou `spawn`/`execFile` com `shell: false` e argumentos
separados. Restrinja repositório, comandos, refs e ambiente. Publique primeiro
em branch candidata e aplique os controles definidos pela feature ativa.

Nunca ofereça ao renderer uma capacidade `execute(command)` e nunca inclua
tokens, chaves SSH ou variáveis de ambiente sensíveis em DTOs.

## Fontes

- Contrato do projeto:
  `docs/architecture/ADR-007-fronteira-segura-publicacao.md`
- Electron Security:
  <https://www.electronjs.org/docs/latest/tutorial/security>
- Electron BrowserWindow:
  <https://www.electronjs.org/docs/latest/api/browser-window>
- Electron Session:
  <https://www.electronjs.org/docs/latest/api/session>
