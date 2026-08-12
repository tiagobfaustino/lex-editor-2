// Recria entrada.txt a partir de um snapshot já versionado, sem rede.
// Uso: node scripts/reextrair-fixture.mjs <snapshot.html> <entrada.txt>

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  decodificarHtmlPlanalto,
  extrairLinhas,
  juntarContinuacoes,
  reconhecer,
} from '@lex-editor/legal-domain';

const [snapshotPath, entryPath] = process.argv.slice(2);
if (snapshotPath === undefined || entryPath === undefined) {
  console.error('Uso: node scripts/reextrair-fixture.mjs <snapshot.html> <entrada.txt>');
  process.exit(2);
}

const bytes = readFileSync(snapshotPath);
const html = decodificarHtmlPlanalto(bytes);

const grammar = (line) => reconhecer(line.replace(/^~~|~~$/gu, '').trim());
const lines = juntarContinuacoes(
  extrairLinhas(html, {
    comecarEm: /^~?~?Art\.?\s*1[.º°o]/u,
    reconhecer: grammar,
  }),
  (line) => grammar(line) !== undefined,
);
const entry = `${lines.join('\n')}\n`;
writeFileSync(entryPath, entry, 'utf8');
console.log(
  `${entryPath}: ${createHash('sha256').update(entry).digest('hex')} (${String(lines.length)} linhas)`,
);
