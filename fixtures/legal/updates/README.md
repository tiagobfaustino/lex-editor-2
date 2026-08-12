# Recortes legislativos de atualização

Estes arquivos são recortes textuais normalizados de páginas oficiais do
Planalto, mantidos localmente para que os testes de diff sejam determinísticos
e não dependam de rede. Eles não são cópias integrais das leis nem substituem o
artefato bruto que será capturado pelo worker.

Cada `manifesto.json` registra a URL oficial, a data de captura, o papel da
fonte e o SHA-256 de cada recorte. O teste `legislative-diff.test.ts` recalcula
esses hashes antes de processar os arquivos.

Os arquivos Markdown pessoais fornecidos como comparação não são fixtures
normativos. Tags HTML, realces, negrito e outras marcações editoriais desses
arquivos são ignorados; qualquer conclusão jurídica precisa ser confirmada na
fonte oficial registrada no manifesto.

- `l9099`: alteração de redação sem falsa revogação dos arts. 61 e 62;
- `l9605`: alteração, inclusão, revogação e renumeração explícita;
- `l10826`: fonte compilada para texto vigente e fonte anotada como evidência
  histórica auxiliar.
