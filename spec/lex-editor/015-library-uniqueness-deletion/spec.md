# Feature 015 — Importação única e exclusão local

- `implementation_status`: done
- `priority`: P1

## Escopo

Pedido explícito: uma importação por lei, aviso de duplicata e exclusão em Minhas leis.
Identidade usa o contrato existente tipo/número normalizado/ano, independentemente de URL, variante ou título. Identidade ausente usa hash da fonte para evitar confundir documentos distintos.
Verificar antes de salvar snapshots quando possível e novamente antes de persistir a revisão, serializando a admissão. Nunca sobrescrever uma revisão existente.
Duplicatas legadas permanecem visíveis até exclusão individual pelo usuário.
Exclusão lógica local confirmada retira a revisão da biblioteca e revoga capacidades da sessão; um marcador durável impede recuperação e escritas futuras. Snapshots compartilhados e evidência de auditoria são preservados. Não altera publicações remotas ou arquivos exportados.

## Contratos e risco

Dependências 005 e 014 done. ADR-007 e identidade canônica do domínio prevalecem. IPC fechado por UUID, remetente e tamanho. Risco alto: concorrência, persistência e invalidação de capacidades. Sem dependência nova.

## Aceite

- [x] Importação repetida local/URL e variantes avisa sem criar segunda revisão, inclusive após reinício.
- [x] Importações concorrentes admitem somente uma revisão; reiniciar processamento não sobrescreve edição.
- [x] Exclusão exige confirmação; cancelar preserva dados; confirmar atualiza lista e limpa edição da lei aberta.
- [x] Exclusão persiste após reinício, revoga abrir/exportar/editar, permite nova importação e preserva outras leis/evidências.
- [x] Payload extra, remetente inválido, UUID externo e symlink são negados.
- [x] Testes relacionados, Electron, tipo, lint e build passam.
