# Feature 014 — Biblioteca local de leis

## Metadados

- `implementation_status`: done
- `priority`: P1

## Objetivo e escopo

Por pedido explícito do usuário, criar a aba **Minhas leis** para consultar
importações já formatadas e retomar a revisão depois de reiniciar o aplicativo.
Listar título, sigla, tipo, número, ano, artigos, origem/variante e datas;
buscar por título ou sigla, paginar e abrir pelo identificador local.
Importações repetidas ficam separadas. Abrir carrega a última revisão durável,
metadados, decisões editoriais, perfil de projeção e snapshots existentes.
Não reimporta, não refaz o parser e não exige rede. Aprovação local não é
restaurada automaticamente: validar e aprovar novamente antes de exportar.

## Dependências e contratos

Features 005, 006, 009, 012 e 013 concluídas. ADR-007, DATA_MODEL e contratos
de diário/checkpoint permanecem vigentes. Renderer recebe apenas resumos
paginados e IDs; caminhos, AST e snapshots continuam no main. Usar o store
existente, com verificação de diário, replay, hashes e caminhos seguros.
Dados legados devem funcionar sem migração destrutiva.

## Fora do escopo

Excluir/importar em lote, sincronizar nuvem, renomear identidade, migrar IDs,
restaurar aprovação, instalar dependências ou alterar textos jurídicos.

## Critérios de aceite

- [x] Aba acessível lista e busca importações persistidas, incluindo repetidas.
- [x] Abrir após reinício recupera edição e perfil sem rede/reparse.
- [x] Abrir a mesma importação é idempotente e não duplica o diário.
- [x] Falha preserva a revisão aberta e informa indisponibilidade, sem sucesso falso.
- [x] Diretório/arquivo adulterado, symlink, hash incorreto e payload extra são negados.
- [x] Preview, metadados e exportação permanecem na mesma revisão; aprovação exige nova validação.
- [x] Testes relacionados, E2E de reinício, tipos, lint, formato e fronteiras passam.
