// Regenera o Markdown canônico dentro de uma pasta do vault do Obsidian e
// falha se divergir do golden versionado.
//
// Uso: node scripts/testar-no-vault.mjs <pasta-do-vault>
//      LEX_VAULT_DIR=<pasta-do-vault> npm run test:vault
//
// O golden que vale é sempre o do repositório. A cópia no vault existe para o
// que a suíte não alcança: conferir no próprio Obsidian se os callouts da §6.5
// renderizam, se as âncoras `^bloco` resolvem como block reference e se o
// aninhamento sobrevive ao outline. Por isso o script compara contra
// `fixtures/legal/<nome>/esperado.md` e trata o vault apenas como destino.
//
// A pasta não é criada: um caminho errado tem de falhar alto, e não espalhar
// arquivo solto dentro de um vault sincronizado.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const destino = process.argv[2] ?? process.env.LEX_VAULT_DIR;

if (destino === undefined) {
  console.error(
    'Informe a pasta do vault:\n' +
      '  node scripts/testar-no-vault.mjs <pasta-do-vault>\n' +
      '  LEX_VAULT_DIR=<pasta-do-vault> npm run test:vault',
  );
  process.exit(2);
}

if (!existsSync(destino)) {
  console.error(`Pasta inexistente: ${destino}`);
  process.exit(2);
}

// A CLI é o adaptador que lê manifesto e grava arquivo; o domínio não toca
// filesystem (regra 6). Importar o build por caminho relativo porque o pacote
// não exporta esse subcaminho.
const adaptador = new URL('../packages/cli/dist/processar-arquivo.js', import.meta.url);

if (!existsSync(adaptador)) {
  console.error('CLI não compilada. Rode `npm run build:workspaces` antes.');
  process.exit(2);
}

const { CODIGO_DE_SAIDA, executarProcess } = await import(adaptador.href);

const FIXTURES = fileURLToPath(new URL('../fixtures/legal/', import.meta.url));
const OBRIGATORIOS = ['entrada.txt', 'manifesto.json', 'esperado.md'];

const casos = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .filter((nome) => OBRIGATORIOS.every((arquivo) => existsSync(join(FIXTURES, nome, arquivo))))
  .sort();

if (casos.length === 0) {
  console.error('Nenhuma fixture com golden em fixtures/legal/.');
  process.exit(2);
}

const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');

let divergencias = 0;

for (const nome of casos) {
  const saida = join(destino, `${nome}.md`);
  const resultado = executarProcess({
    entrada: join(FIXTURES, nome, 'entrada.txt'),
    manifesto: join(FIXTURES, nome, 'manifesto.json'),
    saida,
  });

  if (resultado.codigo !== CODIGO_DE_SAIDA.ok) {
    divergencias += 1;

    console.log(`✗ ${nome}: pipeline falhou (código ${String(resultado.codigo)})`);

    for (const problema of resultado.relatorio.ok ? [] : resultado.relatorio.problemas) {
      console.log(`    ${problema.etapa}/${problema.codigo}`);
    }

    continue;
  }

  const golden = readFileSync(join(FIXTURES, nome, 'esperado.md'), 'utf8');
  const gerado = resultado.markdown ?? '';

  if (gerado === golden) {
    console.log(`✓ ${nome}: idêntico ao golden — ${saida}`);
    continue;
  }

  // A saída divergente fica gravada de propósito: é ela que se abre no Obsidian
  // ao lado do golden para entender o que mudou.
  divergencias += 1;

  console.log(`✗ ${nome}: divergiu do golden`);
  console.log(`    golden ${sha256(golden)}`);
  console.log(`    gerado ${sha256(gerado)}`);
  console.log(`    gravado em ${saida}`);
}

console.log(
  divergencias === 0
    ? `\n${String(casos.length)} fixture(s) conferida(s), nenhuma divergência.`
    : `\n${String(divergencias)} de ${String(casos.length)} fixture(s) divergiram.`,
);

process.exit(divergencias === 0 ? 0 : 1);
