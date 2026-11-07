# Plano — Feature 014

1. Estender o store para enumerar resumos a partir da recuperação validada,
   ordenados por última edição; aplicar busca e página no main. Não criar um
   índice paralelo que possa divergir do diário.
2. Adicionar capacidades `library.list` e `library.open` com schemas fechados,
   limites de página/bytes, validação de remetente e identificadores UUID.
3. Abrir por recovery do store; localizar snapshots pelos hashes da base
   persistida e verificar bytes dentro de sources. Preservar evidência de
   catálogo quando disponível. Gerar projeções da revisão recuperada sem
   reparsing. Falha não substitui a revisão válida nem escreve no diário.
4. Criar abas Edição/Minhas leis, painel separado com busca, paginação, estados
   vazio/erro/carregamento e abertura para o preview existente. Manter a edição
   montada ao alternar aba para preservar drafts.
5. Provar lista, negativos de armazenamento/IPC, recuperação de edição, perfil,
   idempotência e exportação bloqueada; E2E importar/editar/reiniciar/abrir.

Risco alto: persistência, recuperação e IPC. Nenhuma dependência nova.
