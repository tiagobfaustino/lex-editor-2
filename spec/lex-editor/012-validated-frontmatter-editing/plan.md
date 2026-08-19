# Plano de Implementação — Feature 012

## Abordagem

Estender o fluxo editorial da Feature 006 em vez de criar um editor de YAML ou
um store paralelo. O domínio fornecerá uma projeção fechada de metadados e uma
política de mutabilidade dependente do estado autoritativo de publicação. O
processo principal transformará uma intenção IPC validada em comando editorial,
persistirá no diário e só então devolverá a nova projeção ao renderer.

A implementação separa correções comuns de mudanças de identidade. Correções
comuns atualizam a raiz da AST e passam pela validação completa existente.
Sigla, tipo, número e ano, quando ainda permitidos, executam uma transação
lógica mais ampla: reaplicação/reconciliação de Block IDs e regeneração dos
índices derivados. Qualquer falha descarta o conjunto inteiro.

## Componentes afetados

- `docs/architecture/DATA_MODEL.md`: explicitar a matriz normativa de origem e
  mutabilidade caso a implementação revele lacuna no mapeamento atual.
- `packages/legal-domain/src/editorial-commands/`: restringir o comando atual,
  separar política de campos e garantir aplicação atômica.
- `packages/legal-domain/src/formatter/` e validação canônica: consumir a mesma
  revisão e manter bytes determinísticos.
- `packages/legal-domain/src/block-id/` e `legal-reference/`: reconciliar
  mudanças de sigla/identidade anteriores à primeira publicação.
- `src/main/local-project-service.ts` e store editorial: projeção, comando,
  diário, checkpoint, replay e comprovação do estado publicado.
- `src/shared/ipc/`, `src/preload/` e `src/main/ipc/`: capacidades específicas,
  schemas fechados, limites e validação de remetente.
- `src/renderer/src/features/metadata/`: formulário, resumo de confirmação,
  erros inline, foco, teclado e estados de conflito/salvamento.
- publicação, exportação e testes E2E: prova de revisão única até os artefatos.

## Contratos e fluxo

```text
Projeto aberto
  → main carrega IdentifiedNormaAST + revisionHash + diário
  → consulta histórico autoritativo/cache comprovável de publicação
  → domínio projeta FrontmatterEditorState
      editável | prepublication_only | system_managed
  → renderer edita somente campos habilitados
  → UpdateLawMetadataIntent(expectedRevisionHash, changes, reason)
  → main valida remetente, tamanho, revisão e política de publicação
  → domínio aplica comando em cópia
      → identidade comum: valida AST
      → sigla/identidade: reconcilia IDs + catálogo + referências + layout
  → main persiste diário/checkpoint atomicamente
  → invalida validação/aprovação antiga
  → devolve DTO da nova revisão
  → preview/Formatter/exportação/publicação derivam dessa revisão
```

O DTO não será uma coleção arbitrária de chave/valor. Ele possuirá grupos
tipados para os campos editáveis e sistêmicos, junto a `revisionHash`, estado de
salvamento e códigos enumerados de bloqueio. O renderer envia somente a
allowlist de mudanças aceita pelo schema; ator, instante, estado publicado e
valores derivados são preenchidos ou comprovados no processo principal.

## Matriz local de mutabilidade

| Grupo | Campos | Regra |
|---|---|---|
| Editorial | `titulo`, `ramo`, `dataPublicacao`, `dataAtualizacaoLegal`, `legalStatus`, `tags`, `revogadaPor` | Editáveis; mudança jurídica exige motivo |
| Identidade pré-publicação | `sigla`, `tipoNorma`, `numero`, `ano` | Editáveis somente com prova de que nunca houve publicação; regeneram derivados |
| Proveniência | `fonte`, `fontesSecundarias` | Somente leitura; alteradas por importação/catálogo |
| Sistema | `dataFormatacaoVinculex`, `totalArtigos`, `versaoVinculex`, `publicationStatus` | Somente leitura; relógio, árvore ou publicação controlam |
| Derivados | `projection_profile`, aliases, `redacoesDadasPor`, `idsDepreciados` | Somente leitura; projeção, catálogo, dispositivos ou registro histórico controlam |

`tipo`, número e ano formam a chave canônica de identidade; `sigla` forma o
namespace dos Block IDs. Título não participa da igualdade jurídica, mas sua
mudança invalida aliases/layout derivados e dispara nova resolução.

## Decisões locais

- Reutilizar `EditorialCommand`, hash, diário e checkpoint existentes. Um
  segundo log de metadados criaria ordenação ambígua e recuperação parcial.
- Substituir a allowlist ampla atual por política explícita. O fato de um campo
  existir na AST não o torna editável pelo usuário.
- Não confiar apenas em `publicationStatus` da cópia local para liberar
  identidade. A porta de histórico precisa provar ausência de versão publicada;
  indisponibilidade mantém esses campos bloqueados.
- Mudanças de identidade usam cópia e promoção atômica. Não se registra primeiro
  a AST para depois tentar corrigir IDs ou referências.
- Título e identidade disparam regeneração dos derivados afetados; o texto legal
  e os spans detectados permanecem imutáveis.
- Toda alteração, inclusive tags, muda o hash completo da revisão e invalida
  aprovação. Não haverá hash “só normativo” para contornar o diário.
- Validação inline ajuda o formulário, mas somente validação completa da revisão
  atual habilita aprovação, exportação final e publicação.
- Cancelar descarta apenas o draft do renderer; confirmar grava um único comando
  com o diff mínimo e não envia o frontmatter inteiro de volta ao main.

## Erros e recuperação

- Campo desconhecido ou sistêmico: `metadata_field_not_editable`, sem comando.
- Identidade já publicada ou não comprovável: `published_identity_immutable`.
- Revisão mudou desde a abertura: `editorial_revision_conflict`; devolver estado
  atual e preservar o draft na UI para comparação manual.
- Reconciliação de ID/referência falha: descartar cópia e retornar diagnóstico
  localizado, mantendo diário e revisão anteriores.
- Escrita durável falha: não atualizar UI para “salvo”; reabertura recupera o
  último comando confirmado.
- Replay contém campo hoje proibido: falhar fechado e oferecer diagnóstico de
  migração; nunca ignorar silenciosamente a entrada histórica.
- Publicação remota indisponível: edições comuns continuam offline; identidade
  permanece bloqueada até a ausência de publicação ser comprovada.

## Estratégia de validação

- Unitários para cada campo/modo, limites, datas reais, enum, URLs, combinações,
  diffs mínimos e rejeição de payload extra.
- Propriedades de aplicação atômica e replay determinístico do comando.
- Integração com registro histórico de IDs, catálogo jurídico, layout e índice
  de referências para mudança de título/sigla/identidade.
- Integração main/store para conflito, crash, checkpoint, offline e invalidação
  de aprovação.
- Contratos IPC/preload com remetente forjado, DTO limitado e ausência de AST,
  paths ou valores internos.
- E2E de formulário completo por teclado, erro/foco, cancelamento, confirmação,
  preview, exportação e reabertura.
- Regressão nas Leis nº 9.099/1995, nº 9.605/1998 e nº 10.826/2003, incluindo
  `complete_with_history` e `current_only`.
- `lint`, `typecheck`, testes relacionados, `test:boundaries`,
  `check:data-model`, E2E e `graphify update .`.

## Ordem

1. Consolidar contrato, matriz de mutabilidade e códigos de erro.
2. Endurecer o comando de domínio e implementar efeitos de identidade.
3. Integrar diário, histórico publicado, recuperação e revisão única.
4. Expor IPC/preload e construir o formulário acessível.
5. Integrar preview, validação, exportação e publicação.
6. Executar regressão, E2E, documentação e encerramento.

## Não fazer

- Não parsear YAML enviado pelo renderer.
- Não aceitar `{ field: string, value: unknown }` nem patch JSON genérico.
- Não permitir editar proveniência ou derivados para fazer um teste passar.
- Não trocar sigla ou identidade publicada nem criar aliases automáticos para
  mascarar essa quebra.
- Não confirmar salvamento antes da promoção durável do diário.
- Não incluir RF-23, editor de conteúdo livre ou mudança do schema público do
  SaaS.
