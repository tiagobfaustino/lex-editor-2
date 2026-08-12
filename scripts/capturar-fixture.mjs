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

import {
  decodificarHtmlPlanalto,
  extrairLinhas,
  juntarContinuacoes,
  reconhecer,
} from '@lex-editor/legal-domain';

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

// O Planalto serve Windows-1252 e nem sempre declara. O adaptador usa mapa
// próprio para não variar conforme a versão de ICU embutida no Node.
const bytes = Buffer.from(await resposta.arrayBuffer());
const html = decodificarHtmlPlanalto(bytes);

const pasta = dirname(destino);

mkdirSync(pasta, { recursive: true });
writeFileSync(join(pasta, 'snapshot.html'), bytes);

const semRisco = (linha) => linha.replace(/^~~|~~$/gu, '').trim();
const gramatica = (linha) => reconhecer(semRisco(linha));

const linhas = juntarContinuacoes(
  extrairLinhas(html, { comecarEm: /^~?~?Art\.?\s*1[.º°o]/u, reconhecer: gramatica }),
  (linha) => gramatica(linha) !== undefined,
);

writeFileSync(destino, `${linhas.join('\n')}\n`, 'utf8');

const sha = createHash('sha256').update(bytes).digest('hex');

console.log(`URL:            ${url}`);
console.log(`SHA-256 do HTML: ${sha}`);
console.log(`snapshot:       ${join(pasta, 'snapshot.html')} (${String(bytes.length)} bytes)`);
console.log(`entrada:        ${destino} (${String(linhas.length)} linhas)`);

// Contar linhas sem designador **depois** de juntar seria vácuo: a junção
// absorve toda linha não reconhecida na anterior, então o número seria sempre
// zero. O sinal honesto é quantos artigos saíram — comparável com a norma real
// — e rodar o pipeline em seguida.
const artigos = linhas.filter((linha) => /^~?~?Art\.?\s*\d/u.test(linha)).length;

console.log(`artigos reconhecidos: ${String(artigos)}`);
console.log('Rode `lex process` sobre a entrada: é ele que revela o que sobrou.');
