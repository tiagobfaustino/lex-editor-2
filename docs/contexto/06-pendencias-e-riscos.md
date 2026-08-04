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

## Feature 001 — o que falta para fechar

| Tarefa | Falta | Consequência |
|---|---|---|
| T001-08 | Playwright Electron e smoke test; a dependência nem está instalada | Nenhuma evidência automatizada de que a aplicação abre |
| T001-09 | Build empacotado, fuses/integridade ASAR e CI (`.github/workflows/` não existe) | RF-001-02 não demonstrado; nenhuma validação roda em push/PR |
| T001-10 | Executar todos os comandos, inspecionar o bundle e demonstrar os critérios de aceite | A feature não pode passar a `done` |

Nenhum dos cinco critérios de aceite da Feature 001 está marcado. Em especial,
o critério "bundle/DTOs não contêm AST, HTML bruto, paths ou secrets" exige a
inspeção prevista na T001-10 — hoje é uma afirmação de desenho, não uma
evidência.

Enquanto isso não fechar, a Feature 002 não pode ser ativada: a regra de
ativação exige dependências `done`.

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

- **`out/` está no disco** com um build antigo. Como não há garantia de que
  corresponde ao código atual, não serve de evidência de nada; a T001-09 deve
  regerar tudo.
- **Empacotamento não escolhido.** Não há `electron-builder` nem equivalente,
  então fuses, integridade ASAR e assinatura por plataforma — todos exigidos
  pelo critério de saída da Fase 0 do roadmap — continuam sem implementação.
- **`test:boundaries` fora do `npm test`.** O script existe e passa, mas não
  entra na suíte padrão; sem CI, ele só roda se alguém lembrar.
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

1. Fechar T001-08: instalar Playwright e escrever o smoke test sobre a
   aplicação empacotada ou configuração equivalente à produção, não sobre a
   página Vite isolada.
2. Fechar T001-09: escolher o empacotador, aplicar fuses e integridade ASAR, e
   criar a CI mínima de lint, typecheck, testes e fronteiras.
3. Fechar T001-10: executar tudo, inspecionar o bundle contra AST, HTML bruto,
   paths e secrets, e demonstrar os cinco critérios de aceite.
4. Marcar a Feature 001 como `done` no `FEATURE_INDEX.md` e só então ativar a
   Feature 002.
