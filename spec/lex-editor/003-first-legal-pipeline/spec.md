# Feature 003 — Primeiro pipeline jurídico vertical

## Metadados

- `implementation_status`: done
- `priority`: P0
- `owner`: não atribuído

## Objetivo

Provar o domínio ponta a ponta com uma fixture local pequena e representativa:
entrada imutável → parsing → `ParsedNormaAST` → Block IDs →
`IdentifiedNormaAST` → Markdown canônico, acionado por CLI.

## Problema

Implementar todas as camadas horizontalmente adiaria o primeiro feedback de
integração. Este corte deve revelar cedo incompatibilidades entre AST, IDs e
serialização sem depender de Electron, rede, Git ou banco.

## Escopo

- Fixture oficial local com artigo, parágrafo, inciso, alínea, pena e um caso
  revogado ou vetado.
- Snapshot e SHA-256 do arquivo local.
- Parser mínimo apenas para os padrões presentes na fixture.
- Geração inicial de Block IDs sem histórico anterior.
- Formatter do subconjunto, frontmatter e callouts obrigatórios.
- CLI `lex process <entrada> --output <arquivo>`.
- Golden file e relatório de validação.

## Fora do escopo

- Cobertura de toda a legislação brasileira.
- Download por URL, Defuddle ou UI Electron.
- Reconciliação com versão publicada, aliases ou renumeração ambígua.
- Publicação Git/Supabase.

## Dependências

- Feature 002.
- `../../../docs/architecture/ADR-009-fontes-compiladas-e-historicas.md`
- `../../../docs/architecture/BLOCK_ID_SPEC.md`
- `../../../docs/architecture/MARKDOWN_SPEC.md`
- `../../../docs/architecture/DATA_MODEL.md`

## Requisitos

- RF-003-01: a mesma entrada e parâmetros produzem os mesmos bytes.
- RF-003-02: cada etapa valida sua entrada e não recebe estrutura parcial.
- RF-003-03: valores de domínio de Block ID não contêm `^`.
- RF-003-04: o Formatter aceita somente `IdentifiedNormaAST`.
- RF-003-05: erro aponta etapa, nó/fragmento e motivo sem emitir saída final.

## Invariantes

- Snapshot é criado antes de qualquer limpeza.
- Relógio não é consultado pelo Formatter; datas entram como parâmetro.
- Texto jurídico não é alterado para “facilitar” o parser.
- Falha intermediária não deixa um Markdown apresentado como válido.

## Cenários essenciais

### Pipeline nominal

Dada a fixture aprovada, quando a CLI processa, então gera o golden Markdown,
um relatório sem erros bloqueantes e hashes reproduzíveis.

### Entrada estruturalmente inválida

Dada uma variante com inciso órfão, quando processada, então falha antes do
Formatter e não grava saída final como sucesso.

## Critérios de aceite

- [x] Comando ponta a ponta funciona sem Electron ou rede.
- [x] Golden file é idêntico byte a byte em duas execuções.
- [x] Todos os nós referenciáveis da fixture recebem ID válido e único.
- [x] Frontmatter e corpo passam nas validações normativas aplicáveis.
- [x] Caso inválido demonstra falha segura e acionável.

## Validação mínima

- Risco: crítico.
- Testes por etapa, integração ponta a ponta, golden e caso negativo.
- Revisão manual da fixture contra a fonte oficial.

## Riscos

- Subconjunto virar regra geral por acidente: marcar regras suportadas.
- Golden mascarar erro jurídico: revisar conteúdo, não apenas snapshot.
