# Plano

1. Entregar composição pura de atualização e operação replayable no domínio, com identidade/reconciliação/diff e testes de histórico, ausência e conflito.
2. Persistir proposta no store existente e coletar snapshots na mesma infraestrutura, mantendo artefatos antigos como historical_auxiliary no novo conjunto sem alterar bytes.
3. Entregar library.checkSource/applySourceUpdate com DTO fechado e limites; aplicar pelo serializador de mutações e hash esperado, revogar aprovação e recuperar fonte pelo checkId do diário.
4. Derivar ALTERACOES.md do diário replayado; ampliar exportação de pacote existente (inclusive uma lei) sem inventar publicação/versão. Relatório inclui dispositivos e artigos completos afetados.
5. Acrescentar revisão e ações no card da biblioteca, reusar carregamento de edição e exportação de pacote. Testar cortes reais no Electron e gates proporcionais.

Nenhuma dependência nova. Propostas persistidas e snapshots são evidências internas; a operação de diário é autoridade de adoção. Apenas a confirmação aplica. Conflitos locais exigem concordância separada. Sem migração destrutiva.
