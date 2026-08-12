# Plano de Implementação — Feature 006

## Abordagem

Representar correções como comandos tipados aplicados à AST de trabalho.
Persistir snapshot-base mais log de comandos/checkpoints, permitindo
revalidação e recuperação sem tornar Markdown editado a fonte.

## Componentes afetados

- `packages/legal-domain/src/editorial-commands/`
- `packages/legal-domain/src/validation/`
- `packages/legal-domain/src/changelog/`
- `src/main/projects/`: armazenamento e recuperação.
- `src/main/export/`: lote.
- `src/renderer/features/preview/editor/`
- `src/renderer/features/validacao/`

## Contratos e fluxo

Comando validado → cópia de trabalho → invariantes → diagnósticos →
reconciliação/Formatter. Aprovação referencia hash da revisão atual; qualquer
novo comando a invalida.

## Decisões locais

- Sem autosave invisível da UI: comandos confirmados entram no diário
  imediatamente e a tela mostra estado.
- Checkpoint reduz replay, mas o log continua auditável.
- Avisos confirmados são ligados ao código e hash da revisão.
- O hash de revisão é SHA-256 da forma JSON canônica produzida pelo schema da
  `IdentifiedNormaAST`; a função criptográfica é injetada para manter o pacote
  de domínio independente de Node e navegador.
- Cada entrada do diário referencia o hash esperado da revisão anterior e o
  hash resultante. Sequência, IDs de comando e cadeia de hashes são validados
  antes do replay, impedindo reordenação, duplicação e comando obsoleto.
- O checkpoint ancora uma sequência e um hash já registrados no diário. Se ele
  estiver ausente, inválido ou corrompido, a recuperação refaz o diário desde o
  snapshot-base; diário inválido falha fechado.
- Diário e checkpoint são gravados pelo processo principal em arquivo temporário
  restrito, sincronizados e promovidos por `rename` no mesmo diretório. Paths,
  arquivos e diretórios redirecionados por symlink são recusados.
- A validação incremental dá feedback somente aos nós afetados e nunca habilita
  aprovação. Aprovação e exportação exigem relatório completo da mesma revisão
  e da mesma sequência do diário.
- A aprovação local referencia hash e sequência; qualquer comando posterior,
  inclusive um comando sem mudança textual, torna a aprovação anterior inválida.
- O desktop pode identificar provisoriamente um nó de baixa confiança para
  exibi-lo no fluxo editorial, mas o diagnóstico `human_review_required`
  continua bloqueando aprovação e exportação até decisão explícita.
- O renderer recebe apenas projeções editoriais limitadas e IDs opacos. Correção,
  confirmação, validação e aprovação são capacidades IPC distintas; a AST e o
  diário permanecem no processo principal.
- O `UPDATE.md` é gerado de mudanças estruturadas (`included`, `amended`,
  `revoked`, `renumbered`), ordena publicações por `numero_publicacao` decrescente
  e Block IDs de forma lexical, e recebe data/versão explicitamente para não
  consultar relógio ou estado externo no domínio.
- A exportação em lote recebe apenas IDs opacos, mantém o destino real no
  processo principal e grava cada lei em staging próprio antes de promover a
  pasta canônica `leis/<nome-da-lei>/`. Falha de validação, colisão ou filesystem
  é devolvida por lei e não interrompe as demais.
- Reprocessamento com base idêntica reaplica o diário; base alterada sem comandos
  pode ser substituída. Se já houver correções, qualquer divergência da base
  produz `editorial_reprocessing_conflict` e preserva todos os command IDs para
  decisão explícita do editor.

## Erros e recuperação

- Comando inválido não altera cópia.
- O `main` confirma a escrita durável do comando antes de atualizar a projeção
  exibida como salva.
- Crash recupera até o último comando confirmado.
- Conflito após reparse exige escolha explícita, nunca descarte automático.

## Estratégia de validação

- Unitários por comando e regra.
- Propriedades de undo/replay quando suportado.
- Integração crash/reabertura e lote parcial.
- E2E de correção.

## Ordem

1. Modelo de comando/diário.
2. operações essenciais.
3. motor de validação.
4. UI de revisão.
5. changelog e lote.
6. recuperação/E2E.

## Não fazer

- Não permitir edição livre de YAML/Markdown como estado canônico.
- Não permitir override de erro bloqueante.
