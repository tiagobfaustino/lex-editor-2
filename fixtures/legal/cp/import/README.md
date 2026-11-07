# Regressão da importação do Código Penal

Snapshots oficiais preservados pelo aplicativo na importação relatada em
2026-10-08, sem editar ou reformatar os bytes. Não substituem o golden jurídico
anterior em `fixtures/legal/cp/`.

| Arquivo | URL | SHA-256 dos bytes |
|---|---|---|
| `compiled.html` | https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm | `d14583ff04a18790bf3f5d870d2e1037193b92c3b4c97e7f210683607a68a18d` |
| `annotated.html` | https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848.htm | `85950d750c2787072b920e64f306df8efd5dc9423628970d65f14d081eae1bf6` |

A anotada fecha `body` e `html` após o preâmbulo, antes dos dispositivos.
O teste de extração exige recuperar essa cauda sem modificar o snapshot.
A padronização do Defuddle fundia parágrafos da compilada; o teste conserva
artigos e divisões separados. A anotada também contém rubricas sem marcação;
reconhecer o HTML não equivale a validar sua mesclagem jurídica.
