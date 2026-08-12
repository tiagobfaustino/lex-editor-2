# ADR-012: Projeções completa e somente vigente

## Status

Aceito em 2026-08-11. Implementação planejada para a Feature 009.

## Contexto

As páginas oficiais anotadas do Planalto misturam a redação atual com redações
anteriores riscadas, dispositivos revogados, notas de alteração e, em alguns
casos, tabelas ou anexos superados. Esse histórico é indispensável à auditoria
e ao estudo, conforme a ADR-006, mas há também uma necessidade legítima de
consulta: gerar uma lei contendo somente o texto com eficácia atual.

Tratar essas necessidades como duas importações independentes criaria duas
fontes da verdade e permitiria que correções editoriais ou Block IDs
divergissem. Excluir o histórico durante a importação também destruiria
evidência que não pode ser recuperada com segurança a partir de uma página
compilada.

## Decisão

1. **A importação é sempre completa e preserva o conjunto de fontes.** O
   sistema captura a página oficial anotada/completa, com alterações e trechos
   riscados. Quando houver página oficial compilada, captura-a separadamente
   para comparação e aplica a precedência da ADR-009: compilada como
   `primary_current` e anotada como `historical_auxiliary`. Quando não houver
   compilada, a página anotada pode ser `primary_current`, com diagnósticos para
   ambiguidades.
2. **Existe uma única NormaAST autoritativa.** Redações anteriores,
   dispositivos sem eficácia e suas proveniências permanecem armazenados nela.
   Alternar a saída nunca altera, apaga nem reimporta essa árvore.
3. **O sistema oferece duas projeções determinísticas de preview/exportação:**
   - `complete_with_history`: inclui a redação atual, todas as
     `redacoesAnteriores` e dispositivos `revoked`, `vetoed` ou `suspended`,
     com a sinalização prevista na ADR-006 e no `MARKDOWN_SPEC.md`;
   - `current_only`: inclui a redação atual dos dispositivos com
     `deviceStatus` `active`, `included`, `amended` ou `renumbered`, omite
     `redacoesAnteriores` e omite subárvores `revoked`, `vetoed` ou
     `suspended`.
4. **Estado desconhecido não é descartado silenciosamente.** Um nó
   `deviceStatus: unknown` bloqueia a projeção `current_only` até decisão
   editorial. Ausência em página compilada, isoladamente, também não autoriza a
   exclusão, conforme a ADR-009.
5. **A projeção não muda identidade.** Dispositivos mantidos preservam seus
   Block IDs. IDs omitidos da saída `current_only` continuam reservados no
   registro histórico. Divisões estruturais que ficariam vazias após a
   filtragem são omitidas dessa saída derivada.
6. **A publicação canônica continua completa.** `complete_with_history` é o
   padrão do Formatter e a materialização versionada usada como evidência. A
   saída `current_only` é derivada da mesma revisão aprovada e deve identificar
   explicitamente seu perfil; ela não constitui uma segunda revisão jurídica.
7. **Referências editoriais pessoais não são fonte normativa nem golden.** Ao
   comparar Markdown de estudo, testes ignoram tags HTML (`span`, `mark`,
   `strong` e equivalentes), negrito, realces coloridos, Block IDs pessoais e
   outras decorações. O tachado só tem significado histórico quando confirmado
   pelo snapshot oficial; o texto e os estados esperados vêm das fontes
   oficiais versionadas.

## Consequências

### Positivas

- O histórico completo permanece auditável e disponível para estudo.
- O usuário pode obter uma leitura limpa sem texto superado ou sem eficácia.
- Preview, exportação e futuras projeções do SaaS partem da mesma revisão e dos
  mesmos Block IDs.
- Uma fonte compilada melhora a decisão sobre vigência sem apagar a evidência
  da página anotada.

### Trade-offs aceitos

- O Formatter passa a ter um perfil explícito de projeção, mantendo
  `complete_with_history` como padrão retrocompatível.
- A saída `current_only` exige validação bloqueante de estados desconhecidos.
- Golden tests precisam distinguir o arquivo canônico completo da projeção
  derivada vigente.

## Verificação

Os testes essenciais usam snapshots oficiais versionados e não dependem da
rede em CI:

- Lei nº 9.099/1995: redações anteriores e atuais dos arts. 61 e 62 aparecem
  juntas na saída completa; somente as redações atuais aparecem em
  `current_only`;
- Lei nº 9.605/1998: a página anotada única alimenta texto atual, histórico e
  revogações sem pressupor uma contraparte compilada;
- Lei nº 10.826/2003: a página compilada determina o texto vigente e a página
  anotada enriquece histórico; ambas geram uma única NormaAST e duas saídas;
- trocar o perfil de saída não altera a NormaAST, os hashes dos snapshots nem
  os Block IDs;
- `unknown` bloqueia `current_only`, e ausência na compilada sem evidência de
  revogação não remove dispositivo.

## Referências

- `./ADR-005-status-fields.md`
- `./ADR-006-historico-redacoes-no-corpo.md`
- `./ADR-009-fontes-compiladas-e-historicas.md`
- `./MARKDOWN_SPEC.md`
- `../lex-editor/PRD.md`

