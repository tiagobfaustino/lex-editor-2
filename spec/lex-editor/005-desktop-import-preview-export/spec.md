# Feature 005 — Importação, preview e exportação desktop

## Metadados

- `implementation_status`: draft
- `priority`: P1
- `owner`: não atribuído

## Objetivo

Permitir que o editor importe uma fonte por arquivo ou URL, acompanhe o
processamento, revise um preview seguro e exporte o Markdown validado sem sair
do Electron.

## Problema

O pipeline em biblioteca/CLI não é uma ferramenta editorial. A UI precisa
orquestrá-lo sem transferir rede, filesystem, HTML ou autoridade ao renderer.

## Escopo

- Arquivo local `.html`/`.md` por diálogo nativo.
- URL Planalto por capacidade do main com controles de SSRF e limites.
- Snapshot imutável, Defuddle quando aplicável e pipeline da Feature 004.
- DTO de progresso, resumo, árvore de preview e diagnósticos.
- Preview sanitizado de frontmatter, callouts, hierarquia, históricos e IDs.
- Navegação interna e origem por dispositivo.
- Exportação atômica de arquivo único para destino escolhido.

## Fora do escopo

- Correção estrutural manual da AST.
- Exportação em lote e `UPDATE.md`.
- Git, Supabase ou publicação.
- LexML.

## Dependências

- Features 001 e 004.
- `../../../docs/architecture/ADR-007-fronteira-segura-publicacao.md`
- `../../../docs/architecture/MARKDOWN_SPEC.md`
- `../../../docs/lex-editor/USER_FLOWS.md`

## Requisitos

- RF-005-01: URL e arquivo equivalentes produzem resultado semântico igual.
- RF-005-02: renderer recebe somente projeção sanitizada e limitada.
- RF-005-03: origem proibida, redirect indevido ou arquivo fora da seleção é
  rejeitado antes da leitura.
- RF-005-04: diagnósticos navegam até o dispositivo correspondente.
- RF-005-05: exportação usa bytes produzidos pelo Formatter, sem reformatar.

## Invariantes

- HTML bruto nunca é renderizado.
- Renderer não escolhe path por string arbitrária.
- Link wiki não abre navegação externa.
- Cancelamento ou falha não substitui exportação válida anterior.

## Cenários essenciais

### Importar e exportar

Dada uma fonte válida, quando o editor importa, revisa e exporta, então o
arquivo é idêntico ao resultado da biblioteca.

### Fonte maliciosa

Dada URL privada/redirect proibido ou HTML com script, quando importado, então
rede/preview bloqueiam o ataque sem executar conteúdo.

## Critérios de aceite

- [ ] Fluxo arquivo → preview → exportação passa em E2E.
- [ ] Fluxo URL Planalto válido produz resultado equivalente.
- [ ] SSRF, XSS e IPC forjado têm testes negativos.
- [ ] Preview navega em lei extensa sem travar o renderer.
- [ ] Falhas exibem mensagem específica e preservam estado recuperável.

## Validação mínima

- Risco: alto.
- Integração main/preload/renderer, E2E essencial e testes de segurança.
- Validação manual de usabilidade com uma lei extensa.

## Riscos

- Payload grande atravessar IPC: paginar/projetar dados.
- Preview divergir do Markdown: derivar ambos da mesma AST, sem parser paralelo.
