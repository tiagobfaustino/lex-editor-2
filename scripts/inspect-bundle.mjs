// Inspeciona o artefato empacotado em vez da configuração de origem.
// Cobre o critério de aceite "bundle/DTOs não contêm AST, HTML bruto, paths ou
// secrets" da Feature 001 e a verificação de fuses exigida pela ADR-007 §4.
//
// Uso: node scripts/inspect-bundle.mjs [caminho/do/unpacked]
// Sai com código 1 na primeira violação encontrada.

import { extractAll, listPackage } from '@electron/asar';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { PRIVATE_PATH_PATTERNS, SENSITIVE_CONTENT_PATTERNS } from './scan-sensitive-output.mjs';

const unpackedDirectory = process.argv[2] ?? 'release/linux-unpacked';
const asarPath = join(unpackedDirectory, 'resources', 'app.asar');

const violations = [];
const notes = [];

const fail = (rule, detail) => {
  violations.push(`${rule}: ${detail}`);
};

// --- Conteúdo proibido no pacote -------------------------------------------

const forbiddenEntry = [
  { pattern: /\.map$/, rule: 'source map no pacote' },
  { pattern: /\.(ts|tsx)$/, rule: 'fonte TypeScript no pacote' },
  {
    pattern: /^\/(spec|docs|exemplos|tests|prompts|\.agents)\//,
    rule: 'material de projeto no pacote',
  },
  { pattern: /(^|\/)\.env/, rule: 'arquivo de ambiente no pacote' },
  { pattern: /\.(pem|key|p12|pfx|mobileprovision)$/, rule: 'material criptográfico no pacote' },
];

let entries = [];

try {
  statSync(asarPath);
  entries = listPackage(asarPath, { isPack: false });
} catch {
  console.error(`Artefato não encontrado: ${asarPath}`);
  console.error('Rode `npm run build:unpacked` antes da inspeção.');
  process.exit(1);
}

for (const entry of entries) {
  for (const { pattern, rule } of forbiddenEntry) {
    if (pattern.test(entry)) {
      fail(rule, entry);
    }
  }
}

// --- Conteúdo proibido dentro dos arquivos ---------------------------------

const forbiddenContent = [...SENSITIVE_CONTENT_PATTERNS, ...PRIVATE_PATH_PATTERNS];

const extractionRoot = mkdtempSync(join(tmpdir(), 'lex-bundle-'));

const walk = (directory) => {
  const found = [];

  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) {
      found.push(...walk(full));
    } else if (item.isFile()) {
      found.push(full);
    }
  }

  return found;
};

try {
  extractAll(asarPath, extractionRoot);

  for (const file of walk(extractionRoot)) {
    // Dependências de terceiros carregam exemplos e testes próprios; a regra de
    // conteúdo se aplica ao código do aplicativo.
    if (file.includes(`${extractionRoot}/node_modules/`)) {
      continue;
    }

    const text = readFileSync(file, 'utf8');

    for (const { pattern, rule } of forbiddenContent) {
      const match = pattern.exec(text);
      if (match) {
        fail(rule, relative(extractionRoot, file));
      }
    }
  }
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
}

// --- Fuses efetivamente gravados no binário --------------------------------

const requiredFuses = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // O renderer é servido por `file://` de dentro do ASAR, portanto os
  // privilégios extras do protocolo são necessários: desligá-los faz a carga
  // do `out/renderer/index.html` falhar com `ERR_FILE_NOT_FOUND`. A
  // recomendação do Electron de desativar este fuse vale só quando `file://`
  // não é usado; aqui ele é a forma de carregar a interface empacotada.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
};

const fuseNames = Object.fromEntries(
  Object.entries(FuseV1Options).map(([name, value]) => [String(value), name]),
);

const executable = readdirSync(unpackedDirectory).find((name) => name === 'lex-editor');

if (!executable) {
  fail('binário', `executável não encontrado em ${unpackedDirectory}`);
} else {
  const wire = await getCurrentFuseWire(join(unpackedDirectory, executable));

  // O fio guarda códigos ASCII: 48 é '0' (desligado) e 49 é '1' (ligado).
  // Comparar o número direto com '1' faria todo fuse parecer desligado e
  // deixaria passar justamente os que precisam estar desligados.
  const DISABLED = '0'.charCodeAt(0);
  const ENABLED = '1'.charCodeAt(0);

  for (const [option, expected] of Object.entries(requiredFuses)) {
    const actual = wire[option];

    if (actual === undefined) {
      notes.push(`fuse ${fuseNames[option]} não existe nesta versão do Electron`);
      continue;
    }

    if (actual !== ENABLED && actual !== DISABLED) {
      fail('fuse ilegível', `${fuseNames[option]} = ${String(actual)}`);
      continue;
    }

    const enabled = actual === ENABLED;

    if (enabled !== expected) {
      fail(
        'fuse divergente',
        `${fuseNames[option]} = ${enabled ? 'ligado' : 'desligado'}, esperado ${expected ? 'ligado' : 'desligado'}`,
      );
    }
  }
}

// --- Relatório -------------------------------------------------------------

console.log(`Artefato: ${asarPath}`);
console.log(`Entradas no asar: ${entries.length}`);

const packages = [...new Set(entries.filter((e) => /^\/node_modules\/[^/]+$/.test(e)))];
console.log(`Dependências embarcadas: ${packages.length ? packages.join(', ') : 'nenhuma'}`);

for (const note of notes) {
  console.log(`nota: ${note}`);
}

if (violations.length > 0) {
  console.error(`\n${violations.length} violação(ões):`);
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log('\nInspeção do bundle: sem violações.');
