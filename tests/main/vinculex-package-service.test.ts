import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createLegalNormCatalog,
  createVincuLexPackage,
  detectLegalReferences,
  identifiedMinima,
} from '@lex-editor/legal-domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  writeVincuLexPackageAtomically,
  type VincuLexAtomicFileSystem,
} from '../../src/main/vinculex-package-service.js';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const packageOrThrow = () => {
  const catalog = createLegalNormCatalog([{ ast: identifiedMinima }], { sha256 });
  const index = detectLegalReferences(identifiedMinima, { sha256 });
  if (!catalog.ok || !index.ok) throw new Error('Fixture de pacote inválida.');
  const pkg = createVincuLexPackage(
    {
      catalog: catalog.valor,
      documents: [{ ast: identifiedMinima, referenceIndex: index.valor }],
      profile: 'complete_with_history',
    },
    { sha256 },
  );
  if (!pkg.ok) throw new Error(JSON.stringify(pkg.problemas));
  return pkg.valor;
};

const realFileSystem = (): VincuLexAtomicFileSystem => ({
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
});

describe('promoção atômica do pacote VincuLex', () => {
  it('escreve em staging, valida os bytes e promove somente o lote completo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lex-vinculex-'));
    roots.push(root);
    const pkg = packageOrThrow();
    const result = await writeVincuLexPackageAtomically(root, pkg, {
      sha256,
      createOperationId: () => 'success',
    });

    expect(result.ok).toBe(true);
    const file = pkg.files[0];
    if (file === undefined) throw new Error('Pacote sem arquivo.');
    expect(await readFile(join(root, 'VincuLex', file.relativePath), 'utf8')).toBe(file.markdown);
    await expect(lstat(join(root, '.VincuLex.success.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('restaura o pacote anterior quando a promoção do staging falha', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lex-vinculex-rollback-'));
    roots.push(root);
    await mkdir(join(root, 'VincuLex'), { mode: 0o700 });
    await writeFile(join(root, 'VincuLex', 'anterior.md'), 'conteúdo anterior\n', 'utf8');
    const base = realFileSystem();
    const failing: VincuLexAtomicFileSystem = {
      ...base,
      async rename(from, to) {
        if (from.endsWith('.staging') && to === join(root, 'VincuLex')) {
          const error = new Error('falha injetada') as Error & { code: string };
          error.code = 'EIO';
          throw error;
        }
        await rename(from, to);
      },
    };

    const result = await writeVincuLexPackageAtomically(root, packageOrThrow(), {
      sha256,
      fileSystem: failing,
      createOperationId: () => 'rollback',
    });

    expect(result.ok).toBe(false);
    expect(await readFile(join(root, 'VincuLex', 'anterior.md'), 'utf8')).toBe(
      'conteúdo anterior\n',
    );
    await expect(lstat(join(root, '.VincuLex.rollback.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(lstat(join(root, '.VincuLex.rollback.backup'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejeita pacote adulterado antes de tocar no filesystem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lex-vinculex-invalid-'));
    roots.push(root);
    const pkg = packageOrThrow();
    const first = pkg.files[0];
    if (first === undefined) throw new Error('Pacote sem arquivo.');
    const result = await writeVincuLexPackageAtomically(
      root,
      { ...pkg, files: [{ ...first, markdown: `${first.markdown}adulterado` }] },
      { sha256, createOperationId: () => 'invalid' },
    );

    expect(result.ok).toBe(false);
    await expect(lstat(join(root, 'VincuLex'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('não remove staging ou backup preexistente quando há colisão de operação', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lex-vinculex-collision-'));
    roots.push(root);
    const backup = join(root, '.VincuLex.collision.backup');
    await mkdir(backup, { mode: 0o700 });
    await writeFile(join(backup, 'recuperacao.md'), 'preservar\n', 'utf8');

    const result = await writeVincuLexPackageAtomically(root, packageOrThrow(), {
      sha256,
      createOperationId: () => 'collision',
    });

    expect(result.ok).toBe(false);
    expect(await readFile(join(backup, 'recuperacao.md'), 'utf8')).toBe('preservar\n');
  });
});
