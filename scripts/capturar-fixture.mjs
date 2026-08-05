// Captura uma norma do Planalto e grava a fixture (Feature 004, T004-07).
//
// Uso: node scripts/capturar-fixture.mjs <url> <destino/entrada.txt>
//
// Grava também o HTML bruto ao lado, como snapshot: a ADR-009 §5 exige que o
// artefato original seja preservado antes de qualquer limpeza, e o texto
// extraído é projeção, não evidência.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { extrairLinhas, juntarContinuacoes, reconhecer } from '@lex-editor/legal-domain';

const [url, destino] = process.argv.slice(2);

if (url === undefined || destino === undefined) {
  console.error('Uso: node scripts/capturar-fixture.mjs <url> <destino/entrada.txt>');
  process.exit(2);
}

const resposta = await fetch(url, {
  headers: {
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  },
});

if (!resposta.ok) {
  console.error(`A fonte respondeu ${String(resposta.status)}.`);
  process.exit(2);
}

// O Planalto serve cp1252 na maioria das páginas e nem sempre declara. Tentar
// utf-8 estrito e cair para latin1 é mais confiável que ler o cabeçalho: o
// decodificador falha alto em vez de produzir texto corrompido em silêncio.
const bytes = Buffer.from(await resposta.arrayBuffer());
let html;

try {
  html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
} catch {
  html = new TextDecoder('windows-1252').decode(bytes);
}

const pasta = dirname(destino);

mkdirSync(pasta, { recursive: true });
writeFileSync(join(pasta, 'snapshot.html'), bytes);

const linhas = juntarContinuacoes(
  extrairLinhas(html, { comecarEm: /^Art\.?\s*1[.º°o]/u }),
  (linha) => reconhecer(linha) !== undefined,
);

writeFileSync(destino, `${linhas.join('\n')}\n`, 'utf8');

const sha = createHash('sha256').update(bytes).digest('hex');

console.log(`URL:            ${url}`);
console.log(`SHA-256 do HTML: ${sha}`);
console.log(`snapshot:       ${join(pasta, 'snapshot.html')} (${String(bytes.length)} bytes)`);
console.log(`entrada:        ${destino} (${String(linhas.length)} linhas)`);

const naoReconhecidas = linhas.filter((linha) => reconhecer(linha) === undefined);

console.log(`linhas sem designador: ${String(naoReconhecidas.length)}`);

for (const linha of naoReconhecidas.slice(0, 15)) {
  console.log(`  ? ${linha.slice(0, 110)}`);
}
