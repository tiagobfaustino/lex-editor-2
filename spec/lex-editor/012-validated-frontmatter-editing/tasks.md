# Tarefas — Feature 012

## Grupo 1 — Contratos e política de mutabilidade

- [x] T012-01 Normatizar a matriz de campos editoriais, identidade
  pré-publicação, proveniência, sistema e derivados; entregar projeção e schemas
  runtime sem patch genérico.
- [x] T012-02 Endurecer `set_law_metadata` para exigir a política contextual,
  motivo quando aplicável e rejeição de campo somente leitura inclusive em
  chamada direta e replay.
- [x] T012-03 Implementar validação completa de tipo, limites, datas, enums,
  URLs e regras cruzadas, mantendo Formatter e schema da AST equivalentes.

## Grupo 2 — Identidade e derivados

- [x] T012-04 Comprovar ausência de publicação pela porta autoritativa e
  bloquear sigla/tipo/número/ano quando houver versão ou a prova estiver
  indisponível.
- [x] T012-05 Tornar mudança pré-publicação de sigla/identidade atômica com
  reconciliação de Block IDs e regeneração de catálogo, layout e referências.
- [x] T012-06 Garantir que título e demais metadados afetados atualizem aliases,
  preview e validações derivadas sem reparsear ou modificar o texto legal.

## Grupo 3 — Persistência e integração desktop

- [x] T012-07 Integrar a intenção de metadados ao diário/checkpoint existentes,
  com revisão esperada, diff mínimo, escrita durável, replay e invalidação de
  aprovação.
- [x] T012-08 Expor IPC/preload específicos e DTOs limitados para ler e alterar
  metadados, testando remetente, payload extra, tamanho, conflito e ausência de
  AST/path.
- [x] T012-09 Provar que preview, exportação individual/em lote e publicação
  consomem a mesma revisão persistida, sem cache paralelo do formulário.

## Grupo 4 — Formulário acessível

- [x] T012-10 Implementar o painel de metadados com grupos, origem e motivo de
  bloqueio visíveis, controles adequados por tipo e campos sistêmicos somente
  leitura.
- [x] T012-11 Implementar validação inline, resumo de confirmação, cancelar,
  estado de salvamento e conflito preservando o draft para comparação.
- [x] T012-12 Cobrir abrir, editar, corrigir erro, confirmar, cancelar e voltar ao
  preview por teclado, com foco e anúncios acessíveis.

## Grupo 5 — Validação ponta a ponta e encerramento

- [x] T012-13 Testar matriz completa, identidade publicada, aplicação atômica,
  replay adulterado, crash/reabertura, offline e formulário obsoleto.
- [x] T012-14 Executar E2E de edição → validação → preview → exportação e de
  sigla pré-publicação versus identidade publicada bloqueada.
- [x] T012-15 Revalidar as três leis de referência nos perfis completo/vigente,
  executar checks aplicáveis, atualizar documentação e `graphify update .` e
  encerrar somente após todos os critérios de aceite.
