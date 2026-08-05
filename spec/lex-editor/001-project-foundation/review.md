# Revisão de Encerramento — Feature 001

Registro do que não se deduz do código nem do `plan.md`: desvios em relação a
recomendações externas, divergências com contrato superior, dívidas assumidas
conscientemente e a evidência que sustenta os critérios de aceite.

## Desvios com justificativa empírica

### `grantFileProtocolExtraPrivileges` fica ligado

A recomendação genérica do Electron é desligar esse fuse. Aqui ele permanece
ligado porque o renderer empacotado é carregado por `file://` de dentro do
ASAR; com o fuse desligado, a carga de `out/renderer/index.html` falha com
`ERR_FILE_NOT_FOUND`. A recomendação vale para aplicações que não usam
`file://`, o que não é o caso.

O `electron-builder.yml` já estava correto desde o início. Quem tinha a
expectativa errada era o `scripts/inspect-bundle.mjs`, que esperava o fuse
desligado e foi corrigido depois de um A/B no artefato.

### O smoke E2E não roda sobre o binário empacotado

O `plan.md` admite "aplicação empacotada **ou** configuração equivalente à
produção". Ficou a segunda: o smoke lança o diretório do aplicativo sobre o
bundle de `out/`, com `ELECTRON_RENDERER_URL` removido — o que faz o main
seguir exatamente o mesmo ramo de produção em `resolveRendererLocation`.

A razão não é ambiental, é estrutural, e foi demonstrada por A/B no binário
empacotado em 2026-08-05:

| Estado do binário | `_electron.launch` |
|---|---|
| Fuses de produção | timeout |
| Só `EnableNodeCliInspectArguments` ligado | conecta, título `Lex Editor` |

O launcher do Playwright sempre passa `--inspect=0` e espera a linha
`Debugger listening on ws://…` no stderr do processo. O fuse
`enableNodeCliInspectArguments: false` faz o Electron ignorar o argumento, a
linha nunca aparece e o launch expira. Nenhuma máquina vai conseguir dirigir o
pacote enquanto o fuse estiver correto — **e ele deve continuar desligado**.
Não trate isso como um bug a consertar ligando o fuse.

Consequência prática: o que o smoke prova sobre fuses é zero. Fuses só são
verificados no artefato, pelo `scripts/inspect-bundle.mjs`, no job `package`
da CI. As duas verificações são complementares e nenhuma substitui a outra.

## Divergência com contrato superior

A ADR-007 §4 exige que o build "é assinado por plataforma". Nada é assinado:
não há certificado, `signAndEditExecutable`, entitlements nem notarização em
`electron-builder.yml`, e a T001-09 pede apenas "fuses/integridade
aplicáveis". A distribuição prevista hoje é interna à equipe editorial, o que
torna a lacuna tolerável no curto prazo, mas ela **é** uma divergência com
especificação normativa e não foi sanada nesta feature. Precisa ser fechada
antes de qualquer distribuição fora da equipe, e obrigatoriamente antes de
adotar auto-update.

## Dívidas assumidas no encerramento

- **Integridade do ASAR é inócua no Linux.** O fuse
  `EnableEmbeddedAsarIntegrityValidation` está ligado e o script confere o bit
  gravado, mas o `package.json` dentro do `app.asar` não tem bloco
  `ElectronAsarIntegrity`: o electron-builder só emite esse metadado para
  macOS e Windows. Não há hash a validar na única plataforma empacotada até
  aqui. A ADR-007 pede validação "quando suportada", então a configuração está
  conforme — a proteção só passa a valer quando houver build de macOS ou
  Windows.
- **CI só constrói em `ubuntu-latest`.** Windows e macOS nunca foram
  empacotados; os alvos existem apenas como configuração. É o que mantém a
  dívida acima de pé.
- **`test:boundaries` fora do `npm test`.** A CI o executa como passo
  explícito, então o risco fica restrito à execução local.
- **Ações de CI em `@v4`.** O runner emite aviso de depreciação do Node 20.

## Evidência dos critérios de aceite

Todos os comandos reexecutados do zero em 2026-08-05, na estação de
desenvolvimento:

| Verificação | Resultado |
|---|---|
| `lint`, `format:check`, `typecheck` | passam |
| `test:unit` | 14 testes, 3 arquivos |
| `test:boundaries` | passa |
| `test:e2e` | 8 smoke Playwright/Electron |
| `build` completo + `inspect-bundle.mjs` | AppImage e `.deb` gerados; 350 entradas no ASAR, só `zod`, zero violações |
| `dev` | sobe main, preload e dev server |
| Binário empacotado | abre e permanece de pé, inclusive sem `--no-sandbox` |

CI: run `30964836909`, três jobs verdes na primeira execução.

O quarto critério — "bundle/DTOs não contêm AST, HTML bruto, paths ou secrets"
— é coberto em duas metades: o `inspect-bundle.mjs` cobre o pacote (source
maps, fonte TypeScript, material de projeto, `.env`, chaves, paths absolutos,
credenciais e tokens) e o smoke cobre o DTO que atravessa a ponte. O script
não busca AST nem HTML bruto por padrão próprio; hoje não há o que buscar,
mas quando a Feature 002 introduzir a NormaAST essa lacuna precisa ser
fechada no lado do pacote.
