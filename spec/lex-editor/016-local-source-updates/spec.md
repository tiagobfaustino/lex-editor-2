# Feature 016 — Conferência manual e atualização local

- `implementation_status`: done
- `priority`: P1

## Objetivo

Integrar em Minhas leis: Verificar alterações na URL da própria lei, revisar dispositivos antes/depois, confirmar atualização local e exportar lei integral e relatório para envio posterior ao Vinculex. A referência desta conferência é a última fonte local adotada, não uma publicação remota. Não muda o worker nem publica automaticamente.

## Regras

- Reusar coleta segura/seleção manual da URL, parser, reconciliação e diff estrutural. HTML cosmético não cria alteração jurídica.
- Preservar identidade, namespace histórico, metadados editoriais e correções em dispositivos não alterados pela fonte. Conflito de edição exige concordância explícita para substituição; redação anterior fica no histórico.
- Ausência na fonte nunca implica revogação. Preservar dispositivo/ID, indicar ausência e exigir revisão editorial. Revogação explícita conserva texto anterior.
- Conferência não modifica revisão vigente. Aplicação vinculada ao hash revisado e à proposta persistida, sem AST/paths vindos do renderer. Base obsoleta, outra lei, truncamento ou falha bloqueiam aplicação.
- Diário mantém toda a sequência de comandos e a nova operação de adoção de fonte; snapshots anteriores imutáveis e reutilizados como evidência histórica. A raiz do diário original não é descartada. Checkpoint e diário usam o store atômico existente; recovery encontra a fonte da última operação adotada.
- Aplicação invalida aprovação. Exportação requer validação/aprovação da revisão atual, usa pacote atômico existente e inclui lei completa, UPDATE.md inicial quando pertinente e ALTERACOES.md como relatório local com before/after, IDs, datas/hashes e artigos afetados completos. Relatório não simula publicação nem incrementa versão remota.
- Importações locais com URL oficial em metadados podem ser conferidas; URL ausente/não permitida produz erro explícito. Sem rede no renderer, sem dependências novas, sem exclusão de dados reais.

## Dependências e fontes

005, 006, 008, 009, 014, 015 concluídas. ADR-001/006/007/009/012, DATA_MODEL e UPDATE_PIPELINE prevalecem. IPC fechado e limitado. Risco crítico: texto jurídico, persistência e identidade.

## Aceite

- [x] Conferência mostra nenhuma alteração ou diff antes/depois sem alterar diário.
- [x] Aplicação confirmada preserva IDs/histórico/metadados/correções; conflitos e ausências ficam explícitos.
- [x] Rede/fonte inválida, identidade diferente, edição concorrente, exclusão e proposta adulterada são negadas sem perder revisão.
- [x] Reinício recupera lei atualizada e sequência anterior; a próxima conferência compara com a última fonte adotada.
- [x] Exportação aprovada contém lei integral e relatório local dos artigos alterados da mesma revisão; cancelamento/falha não produz pacote parcial.
- [x] UI acessível e IPC validado, testes/gates/Electron e grafo atualizados.
