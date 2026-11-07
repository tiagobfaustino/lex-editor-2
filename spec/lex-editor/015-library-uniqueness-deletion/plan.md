# Plano

1. Estender store existente com busca por identidade e marcador atômico de exclusão, respeitando caminhos seguros e diário como autoridade.
2. Reusar chave de identidade do domínio; pré-verificação na coleta e admissão serializada antes do diário; erro tipado de duplicata.
3. Adicionar library.delete com schemas fechados, revogação dos mapas/cursors/destinos e defesa contra abertura/processamento concorrente.
4. Confirmar exclusão no card, atualizar busca/página e limpar a revisão ativa; manter foco e mensagens acessíveis.
5. Provar duplicatas, legado, concorrência, exclusão/reinício/reaquisição e fronteiras; atualizar graphify.

Exclusão lógica preserva evidências e evita remoção de snapshots legados compartilhados. Sem migração automática nem exclusão de dados reais durante validação.
