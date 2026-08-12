import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  validateVincuLexPackage,
  type ResultadoValidacao,
  type VincuLexPackage,
  type VincuLexPackageCrypto,
} from '@lex-editor/legal-domain';

interface AtomicFileHandle {
  writeFile(content: string, options: { encoding: 'utf8' }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

interface AtomicStats {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface VincuLexAtomicFileSystem {
  lstat(path: string): Promise<AtomicStats>;
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<unknown>;
  open(path: string, flags: string, mode?: number): Promise<AtomicFileHandle>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  realpath(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

const nodeFileSystem: VincuLexAtomicFileSystem = {
  lstat,
  mkdir,
  open: (path, flags, mode) => open(path, flags, mode),
  readFile,
  realpath,
  rename,
  rm,
};

export interface WriteVincuLexPackageOptions extends VincuLexPackageCrypto {
  readonly fileSystem?: VincuLexAtomicFileSystem;
  readonly createOperationId?: () => string;
}

export interface VincuLexPackageWriteReceipt {
  /** Uso exclusivo do processo principal; não deve integrar DTO de renderer. */
  readonly targetDirectory: string;
  readonly filesWritten: number;
}

const failure = (message: string): ResultadoValidacao<never> => ({
  ok: false,
  problemas: [
    {
      codigo: 'pacote_vinculex_invalido',
      caminho: ['package'],
      mensagem: message,
    },
  ],
});

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;

const statIfExists = async (
  fileSystem: VincuLexAtomicFileSystem,
  path: string,
): Promise<AtomicStats | undefined> => {
  try {
    return await fileSystem.lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
};

const closeQuietly = async (handle: AtomicFileHandle | undefined): Promise<void> => {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    // O erro original da escrita/persistência é mais informativo.
  }
};

const writeFileDurably = async (
  fileSystem: VincuLexAtomicFileSystem,
  path: string,
  markdown: string,
): Promise<void> => {
  let handle: AtomicFileHandle | undefined;
  try {
    handle = await fileSystem.open(path, 'wx', 0o600);
    await handle.writeFile(markdown, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
  } finally {
    await closeQuietly(handle);
  }
};

const removeQuietly = async (fileSystem: VincuLexAtomicFileSystem, path: string): Promise<void> => {
  try {
    await fileSystem.rm(path, { recursive: true, force: true });
  } catch {
    // Limpeza best effort de diretório gerado e validado por esta operação.
  }
};

/**
 * Escreve em staging, reconfere os bytes e só então promove o diretório.
 * Um pacote anterior é movido para backup e restaurado se a promoção falhar.
 */
export const writeVincuLexPackageAtomically = async (
  authorizedRoot: string,
  packageInput: unknown,
  options: WriteVincuLexPackageOptions,
): Promise<ResultadoValidacao<VincuLexPackageWriteReceipt>> => {
  const validation = validateVincuLexPackage(packageInput, { sha256: options.sha256 });
  if (!validation.ok) return validation;
  const pkg: VincuLexPackage = validation.valor;
  if (!isAbsolute(authorizedRoot)) return failure('A raiz autorizada precisa ser absoluta.');

  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const operationId = (options.createOperationId ?? randomUUID)();
  if (!/^[a-zA-Z0-9-]{1,100}$/u.test(operationId)) {
    return failure('O identificador interno da operação é inválido.');
  }

  let rootReal: string;
  try {
    const rootStats = await fileSystem.lstat(resolve(authorizedRoot));
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return failure('A raiz autorizada deve ser um diretório real, não um link simbólico.');
    }
    rootReal = await fileSystem.realpath(resolve(authorizedRoot));
  } catch {
    return failure('Não foi possível validar a raiz autorizada.');
  }

  const target = join(rootReal, pkg.rootDirectory);
  const staging = join(rootReal, `.${pkg.rootDirectory}.${operationId}.staging`);
  const backup = join(rootReal, `.${pkg.rootDirectory}.${operationId}.backup`);
  let stagingOwned = false;
  let previousMoved = false;

  try {
    if ((await statIfExists(fileSystem, staging)) !== undefined) {
      return failure('O staging da operação já existe.');
    }
    if ((await statIfExists(fileSystem, backup)) !== undefined) {
      return failure('O backup da operação já existe.');
    }
    const previous = await statIfExists(fileSystem, target);
    if (previous !== undefined && (!previous.isDirectory() || previous.isSymbolicLink())) {
      return failure('O destino VincuLex existente não é um diretório seguro.');
    }

    await fileSystem.mkdir(staging, { recursive: false, mode: 0o700 });
    stagingOwned = true;
    for (const file of pkg.files) {
      const outputPath = join(staging, file.relativePath);
      const relativeToStaging = relative(staging, outputPath);
      if (relativeToStaging.startsWith('..') || isAbsolute(relativeToStaging)) {
        throw new Error('PATH_ESCAPE');
      }
      const parent = dirname(outputPath);
      await fileSystem.mkdir(parent, { recursive: true, mode: 0o700 });
      await writeFileDurably(fileSystem, outputPath, file.markdown);
      if ((await fileSystem.readFile(outputPath, 'utf8')) !== file.markdown) {
        throw new Error('STAGING_CONTENT_MISMATCH');
      }
    }

    if (previous !== undefined) {
      await fileSystem.rename(target, backup);
      previousMoved = true;
    }
    try {
      await fileSystem.rename(staging, target);
      stagingOwned = false;
    } catch (error) {
      if (previousMoved) {
        await fileSystem.rename(backup, target);
        previousMoved = false;
      }
      throw error;
    }

    if (previousMoved) {
      await removeQuietly(fileSystem, backup);
      previousMoved = false;
    }
    return {
      ok: true,
      valor: Object.freeze({ targetDirectory: target, filesWritten: pkg.files.length }),
    };
  } catch {
    if (stagingOwned) await removeQuietly(fileSystem, staging);
    if (previousMoved && (await statIfExists(fileSystem, target)) === undefined) {
      try {
        await fileSystem.rename(backup, target);
        previousMoved = false;
      } catch {
        return failure('A promoção falhou e o pacote anterior exige recuperação manual.');
      }
    }
    return failure('Falha ao escrever ou promover o pacote VincuLex.');
  }
};
