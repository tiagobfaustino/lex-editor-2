# Encerramento — Feature 014

## Resultado

A nova aba Minhas leis lista as revisões duráveis deste computador, com busca
por título/sigla, páginas de 25 itens, variante da fonte, contagem de artigos,
úmero de alterações e datas. Importações repetidas mantêm IDs separados.
Abrir retoma a última revisão por checkpoint/replay, preservando metadados,
interpretações confirmadas e perfil de leitura, sem rede nem parser. As abas
mantêm a edição montada e suportam navegação por teclado; a abertura transfere
o foco ao preview somente depois do commit do React.

## Persistência e fronteiras

O store existente enumera resumos recuperados, sem índice paralelo de ASTs.
Novas importações persistem `source.json`, que liga o ID da origem ao projeto;
o diário e os snapshots continuam nos formatos existentes. Essa associação
contém o resumo validado, sem caminhos. Dados legados são recuperados pelos
hashes das referências da base. Somente diretórios UUID dentro de sources,
arquivos regulares e bytes verificados por SHA-256 são aceitos. A evidência de
catálogo é preservada e validada contra os artefatos e seus papéis.

Se fontes legadas com bytes iguais tiverem configurações divergentes, a
abertura falha fechada por falta de associação comprovável; não inventa uma
configuração nem migra dados. Diário inválido aparece como indisponível;
snapshot ausente/adulterado ou armazenamento inseguro impede abertura e
preserva o documento válido anterior. A leitura não modifica o diário.
Aberturas simultâneas da mesma importação compartilham a recuperação e não
criam comandos. Aprovação/validação da sessão anterior não são recuperadas:
exportação exige nova validação e aprovação explícitas.

`library.list` e `library.open` são as únicas capacidades novas. Ambos os
lados validam schemas fechados; main valida remetente, limites e UUIDs.
Renderer recebe resumos paginados e IDs, nunca AST, caminhos ou HTML bruto.
Nenhuma dependência foi adicionada.

## Provas

- 811 testes unitários em 81 arquivos. A regressão mínima falhou antes da
  implementação e passou depois dela. Casos cobrem lista/busca/página,
  duplicadas, reinício, replay/diário intacto, idempotência concorrente, dados
  legados, snapshot adulterado/symlink, ID externo e payload extra.
- Os dois snapshots reais do CP reabrem após editar ramo/tags; AST e revisão
  são idênticas às persistidas. Conjunto URL com bytes iguais mantém dois
  snapshots/papéis distintos para publicação.
- 11 E2Es de biblioteca/metadados/smoke no Electron atualizado: importar,
  editar título, alterar perfil, reiniciar, buscar e abrir por teclado; preview
  e metadados recuperados, exportação bloqueada. Verificação visual em 1280×800.
- Consulta de leitura aos dados locais existentes encontrou 21 importações;
  as duas do Código Penal reabriram sem escrita nos diários/snapshots.
- Typecheck, lint, formato, fronteiras, auditoria das 26 interfaces sem
  divergências, build do app e `git diff --check` passaram. Graphify atualizado
  por AST. Sem commit, publicação remota ou exclusão/migração de dados locais.

## Limites

A biblioteca é local. Lista somente importações que chegaram ao diário
identificado; falhas anteriores de download/parsing não são leis formatadas.
Não restaura aprovação antiga nem sincroniza projetos da nuvem. A listagem
lê os diários sequencialmente; uma coleção muito grande pode exigir um índice
validado no futuro, sem necessidade dessa nova camada para o conjunto atual.
