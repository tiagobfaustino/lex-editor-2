// Gera, sem rede, um vault mínimo com o pacote real NLLC + CF/1988 para
// conferência interativa no Obsidian.
//
// Uso: node scripts/prepare-vinculex-review.mjs <pasta-vazia-do-vault>

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  createLegalNormCatalog,
  createVincuLexPackage,
  detectLegalReferences,
  processar,
  resolveLegalReferences,
  validateVincuLexPackage,
} from '@lex-editor/legal-domain';

const destination = process.argv[2];
if (destination === undefined) {
  console.error('Uso: node scripts/prepare-vinculex-review.mjs <pasta-vazia-do-vault>');
  process.exit(2);
}

const vault = resolve(destination);
const packageRoot = join(vault, 'VincuLex');
if (existsSync(packageRoot)) {
  console.error(`Destino já existe; nada foi sobrescrito: ${packageRoot}`);
  process.exit(2);
}

const fixtures = resolve('fixtures/legal');
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const law = (name) => {
  const metadata = JSON.parse(readFileSync(join(fixtures, name, 'manifesto.json'), 'utf8'));
  const content = readFileSync(join(fixtures, name, 'entrada.txt'), 'utf8');
  const artifactHash = sha256(content);
  const result = processar({
    conteudo: content,
    referenciaBase: {
      sourceType: metadata.sourceType,
      sourceRole: metadata.sourceRole,
      sourceVariant: metadata.sourceVariant,
      sourceUrl: metadata.fonte,
      sourceArtifactSha256: artifactHash,
      fragmentSha256: artifactHash,
    },
    hashDaLinha: sha256,
    metadados: metadata,
  });
  if (!result.relatorio.ok || result.arvore === undefined) {
    throw new Error(JSON.stringify(result.relatorio.problemas));
  }
  return result.arvore;
};

const nllc = law('nllc');
const constitution = law('cf1988');
const catalogResult = createLegalNormCatalog(
  [
    { ast: nllc, aliases: ['Lei nº 14.133/2021', 'NLLC'] },
    { ast: constitution, aliases: ['Constituição Federal', 'CF', 'CF/88'] },
  ],
  { sha256 },
);
if (!catalogResult.ok) throw new Error(JSON.stringify(catalogResult.problemas));
const catalog = catalogResult.valor;
const index = (ast) => {
  const detected = detectLegalReferences(ast, { sha256 });
  if (!detected.ok) throw new Error(JSON.stringify(detected.problemas));
  const resolved = resolveLegalReferences(
    { sourceAst: ast, index: detected.valor, catalog },
    { sha256 },
  );
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.problemas));
  return resolved.valor;
};
const packageResult = createVincuLexPackage(
  {
    catalog,
    documents: [
      { ast: nllc, referenceIndex: index(nllc) },
      { ast: constitution, referenceIndex: index(constitution) },
    ],
    profile: 'complete_with_history',
  },
  { sha256 },
);
if (!packageResult.ok) throw new Error(JSON.stringify(packageResult.problemas));
const validation = validateVincuLexPackage(packageResult.valor, { sha256 });
if (!validation.ok) throw new Error(JSON.stringify(validation.problemas));

mkdirSync(join(vault, '.obsidian'), { recursive: true, mode: 0o700 });
writeFileSync(join(vault, '.obsidian', 'app.json'), '{"livePreview":false}\n', 'utf8');
for (const file of validation.valor.files) {
  const output = join(vault, validation.valor.rootDirectory, file.relativePath);
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, file.markdown, { encoding: 'utf8', mode: 0o600 });
  if (readFileSync(output, 'utf8') !== file.markdown) {
    throw new Error(`Bytes divergentes após escrita: ${output}`);
  }
  console.log(`${file.canonicalKey} -> ${output}`);
}
console.log(`Pacote validado: ${String(validation.valor.files.length)} arquivos em ${packageRoot}`);
