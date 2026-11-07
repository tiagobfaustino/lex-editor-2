# Entrega — 2026-10-08

A aba Minhas leis oferece Verificar alterações e Exportar lei e relatório. A conferência usa a URL importada; para arquivos locais, usa a fonte oficial dos metadados. O diálogo compara a revisão local com a proposta, permite cancelar e exige consentimento separado para substituir correções conflitantes. A aplicação abre Edição para nova validação e aprovação.

## Decisões de persistência e conteúdo

- A referência é a última fonte adotada localmente. O worker e a referência da publicação remota permanecem independentes.
- A operação apply_source_update é acrescentada ao diário existente. IDs, metadados, histórico e correções sem conflito são preservados; ausência nunca implica revogação. Tabelas guardam também as células da redação anterior.
- A proposta e os snapshots ficam no main; renderer recebe somente DTOs limitados. O checkId é vinculado ao projeto, hash da revisão e digest da proposta emitida na sessão. Após reiniciar é necessário conferir novamente antes de aplicar uma proposta não adotada.
- Recovery encontra a fonte adotada pelo checkId do último comando. Snapshots antigos são mantidos e copiados como evidência histórica para o conjunto novo; HTML e Markdown podem coexistir.
- A fila de mutações protege aplicação, exclusão e promoção de reprocessamento. Diário e checkpoints recusam artefatos acima do limite de leitura antes de comprometer a revisão recuperável.
- Exportação usa o pacote atômico existente. ALTERACOES.md registra conferências, fontes, hashes, IDs, antes/depois e artigos afetados completos, incluindo sua redação na revisão exportada. A extração dos artigos reutiliza o Formatter. UPDATE.md mantém o contrato de exportação existente; o relatório local não inventa publicação remota.

## Evidências

- `npm run test:unit -- --maxWorkers=2`: 833 testes em 83 arquivos passaram. Uma execução simultânea com lint/typecheck/graphify excedeu o timeout do teste pesado do Código Penal; a execução limitada passou sem alterar o timeout.
- `tests/e2e/local-source-updates.spec.ts`: consulta sem mudanças, cancelamento e foco, revisão antes/depois, aplicação, perda de aprovação, reinício, nova consulta e pacote real com lei integral/relatório.
- `tests/e2e/local-law-library.spec.ts` e smoke: biblioteca persistida, teclado, isolamento, CSP, ponte mínima e allowlist. Os 10 demais cenários passaram na execução conjunta; a expectativa da allowlist foi corrigida e o cenário correspondente passou na reexecução dirigida.
- Lint, typecheck, formatação, fronteiras, auditoria do modelo (26 interfaces, zero divergências), build dos workspaces/app e atualização AST do graphify executados.
- Integração cobre rede inválida, outra identidade, edição concorrente, proposta adulterada, aplicação simultânea, exclusão, replay sem checkpoint, snapshots mistos e exportação após recuperação. Domínio cobre ausência hierárquica, aliases, cosmética, conflito, revogação expressa e histórico de tabelas.

Nenhuma dependência adicionada. Testes usaram diretórios temporários e fontes controladas; dados reais do usuário não foram modificados. O pacote fica pronto para envio posterior ao Vinculex, sem publicação automática.
