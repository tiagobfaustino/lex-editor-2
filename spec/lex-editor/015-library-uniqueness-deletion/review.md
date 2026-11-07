# Encerramento — Feature 015

## Decisões

- Reuso de `legalNormIdentityKey`: tipo/número/ano. Título e URL/variante não são identidade; número sem identificação usa hash da fonte. Tanto a identidade original como a editada são verificadas no diário recuperado.
- Pré-verificação antes dos snapshots e verificação serializada antes do diário impedem duplicatas, incluindo duas admissões simultâneas. `LAW_ALREADY_EXISTS` tem mensagem sanitizada; restart de source já processada não sobrescreve edição.
- Exclusão lógica pelo marcador atômico `deleted.json`. A biblioteca ignora a entrada, recovery e novas escritas recusam o ID. A sessão revoga projetos, fontes, destinos, cursores e referências. Não há purge de evidências: snapshots podem ser compartilhados por legados e a auditoria permanece preservada. Publicação remota e exportações existentes não são alteradas.
- UI usa confirmação modal nativa, foco em Cancelar, Escape e retorno ao botão. Sucesso atualiza página/busca e limpa a edição ativa. Nenhum dado real foi excluído durante validação. Smoke usa armazenamento temporário para não depender da base do usuário.
- Duplicatas anteriores continuam listadas; podem ser excluídas individualmente. Armazenamento indisponível impede verificação de identidade e bloqueia nova admissão, em vez de assumir base vazia.

## Provas

- `rtk npm run test:unit -- --maxWorkers=4`: 819 testes, 81 arquivos, verdes. Últimos ajustes no estilo das asserções foram revalidados por `tests/main/local-law-library.test.ts`: 14 verdes.
- `rtk npm run test:e2e:only -- tests/e2e/local-law-library.spec.ts tests/e2e/metadata-form-accessibility.spec.ts tests/e2e/smoke.spec.ts`: 11 verdes. Cobre retomada, duplicata, cancelamento, confirmação, limpeza da edição, reinício e reimportação.
- Typecheck completo, lint completo, formato, fronteiras, build e diff check passaram.
- Testes negam traversal, UUID externo, symlink, remetente inválido e payload extra; provam abertura/exclusão concorrentes sem ressurreição e preservação de outra lei.
- Um teste sob carga expirou na espera por uma fixture extensa. A fixture agora usa outra identidade LINDB e a espera tem limite explícito. O teste de perfil aguarda confirmação da persistência antes de encerrar o Electron. A suíte final passou.
- Graphify atualizado via AST; avisos habituais de manifests JSON sem nós e labels antigas não bloqueiam execução.

## Limites

Exclusão é da biblioteca local; os arquivos editoriais originais ficam inacessíveis pelo marcador e são retidos como evidência interna. Não há restauração/purge exposta nem migração automática de duplicatas. Uma base adulterada precisa ser tratada antes de novas importações. A unicidade usa o processo main único do aplicativo; não cria coordenação de múltiplas instalações sobre uma raiz compartilhada.
