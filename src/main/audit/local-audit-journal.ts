import { createHash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';

import { z } from 'zod';

import {
  operationalAuditEventSchema,
  serializeCanonicalAuditJson,
  type OperationalAuditEvent,
} from '@lex-editor/operational-audit';

const MAX_AUDIT_JOURNAL_BYTES = 64 * 1024 * 1024;
const ZERO_HASH = '0'.repeat(64);
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const journalEntrySchema = z.strictObject({
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  previousHash: z.string().regex(/^[0-9a-f]{64}$/u),
  entryHash: z.string().regex(/^[0-9a-f]{64}$/u),
  event: operationalAuditEventSchema,
});

export type LocalAuditJournalEntry = z.infer<typeof journalEntrySchema>;

export type LocalAuditJournalErrorCode =
  | 'invalid_project_id'
  | 'invalid_event'
  | 'unsafe_storage'
  | 'journal_too_large'
  | 'invalid_schema'
  | 'invalid_sequence'
  | 'previous_hash_mismatch'
  | 'entry_hash_mismatch'
  | 'truncated_entry';

export class LocalAuditJournalError extends Error {
  constructor(
    readonly code: LocalAuditJournalErrorCode,
    message: string,
    readonly compromisedSequence: number | null = null,
  ) {
    super(message);
  }
}

export type LocalAuditJournalReadResult = Readonly<{
  entries: readonly LocalAuditJournalEntry[];
  nextSequence: number;
  lastEntryHash: string;
}>;

export type LocalAuditJournalStore = Readonly<{
  append(projectId: string, candidate: unknown): Promise<LocalAuditJournalEntry>;
  read(projectId: string): Promise<LocalAuditJournalReadResult>;
  listProjectIds(): Promise<readonly string[]>;
}>;

const journalLocks = new Map<string, Promise<void>>();

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const calculateEntryHash = (
  entry: Pick<LocalAuditJournalEntry, 'sequence' | 'previousHash' | 'event'>,
): string =>
  sha256(
    serializeCanonicalAuditJson({
      sequence: entry.sequence,
      previousHash: entry.previousHash,
      event: entry.event,
    }),
  );

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};

const assertPrivateDirectory = async (path: string): Promise<void> => {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new LocalAuditJournalError(
      'unsafe_storage',
      'O diário de auditoria não usa um diretório privado seguro.',
    );
  }
};

const prepareProjectDirectory = async (storageRoot: string, projectId: string): Promise<string> => {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new LocalAuditJournalError(
      'invalid_project_id',
      'O identificador do projeto de auditoria é inválido.',
    );
  }
  const journalsRoot = join(storageRoot, 'audit-journals');
  await mkdir(journalsRoot, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(journalsRoot);
  const journalsRootReal = await realpath(journalsRoot);

  const projectDirectory = join(journalsRootReal, projectId);
  await mkdir(projectDirectory, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(projectDirectory);
  const projectDirectoryReal = await realpath(projectDirectory);
  if (!isInside(journalsRootReal, projectDirectoryReal)) {
    throw new LocalAuditJournalError(
      'unsafe_storage',
      'O diário de auditoria escapa da raiz configurada.',
    );
  }
  return projectDirectoryReal;
};

const assertSafeJournalPath = async (path: string): Promise<boolean> => {
  try {
    const info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      info.size > MAX_AUDIT_JOURNAL_BYTES
    ) {
      throw new LocalAuditJournalError(
        info.size > MAX_AUDIT_JOURNAL_BYTES ? 'journal_too_large' : 'unsafe_storage',
        'O arquivo do diário de auditoria não é seguro.',
      );
    }
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
};

const verifyJournalBytes = (bytes: Buffer, projectId: string): LocalAuditJournalReadResult => {
  if (bytes.byteLength === 0) {
    return { entries: [], nextSequence: 1, lastEntryHash: ZERO_HASH };
  }
  if (bytes.at(-1) !== 0x0a) {
    throw new LocalAuditJournalError(
      'truncated_entry',
      'O diário de auditoria termina com uma entrada incompleta.',
    );
  }

  const entries: LocalAuditJournalEntry[] = [];
  const lines = bytes.toString('utf8').slice(0, -1).split('\n');
  let expectedSequence = 1;
  let expectedPreviousHash = ZERO_HASH;
  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      throw new LocalAuditJournalError(
        'invalid_schema',
        'O diário de auditoria contém JSON inválido.',
        expectedSequence,
      );
    }
    const parsed = journalEntrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new LocalAuditJournalError(
        'invalid_schema',
        'O diário de auditoria contém uma entrada fora do contrato.',
        expectedSequence,
      );
    }
    const entry = parsed.data;
    if (entry.sequence !== expectedSequence) {
      throw new LocalAuditJournalError(
        'invalid_sequence',
        'A sequência do diário de auditoria foi quebrada.',
        entry.sequence,
      );
    }
    if (entry.previousHash !== expectedPreviousHash) {
      throw new LocalAuditJournalError(
        'previous_hash_mismatch',
        'A cadeia anterior do diário de auditoria não confere.',
        entry.sequence,
      );
    }
    if (entry.event.origin !== 'desktop' || entry.event.projectId !== projectId) {
      throw new LocalAuditJournalError(
        'invalid_schema',
        'A entrada não pertence ao diário local informado.',
        entry.sequence,
      );
    }
    if (calculateEntryHash(entry) !== entry.entryHash) {
      throw new LocalAuditJournalError(
        'entry_hash_mismatch',
        'O hash da entrada do diário de auditoria não confere.',
        entry.sequence,
      );
    }
    entries.push(entry);
    expectedSequence += 1;
    expectedPreviousHash = entry.entryHash;
  }
  return {
    entries,
    nextSequence: expectedSequence,
    lastEntryHash: expectedPreviousHash,
  };
};

const readOpenJournal = async (
  handle: Awaited<ReturnType<typeof open>>,
  projectId: string,
): Promise<LocalAuditJournalReadResult> => {
  const info = await handle.stat();
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > MAX_AUDIT_JOURNAL_BYTES) {
    throw new LocalAuditJournalError(
      info.size > MAX_AUDIT_JOURNAL_BYTES ? 'journal_too_large' : 'unsafe_storage',
      'O arquivo aberto do diário de auditoria não é seguro.',
    );
  }
  const bytes = await handle.readFile();
  if (bytes.byteLength > MAX_AUDIT_JOURNAL_BYTES) {
    throw new LocalAuditJournalError(
      'journal_too_large',
      'O diário de auditoria excede o limite permitido.',
    );
  }
  return verifyJournalBytes(bytes, projectId);
};

const syncDirectory = async (path: string): Promise<void> => {
  const directory = await open(path, fileConstants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};

const withJournalLock = async <Result>(
  key: string,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const previous = journalLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  journalLocks.set(key, tail);
  try {
    return await current;
  } finally {
    if (journalLocks.get(key) === tail) journalLocks.delete(key);
  }
};

export const createLocalAuditJournalStore = (storageRoot: string): LocalAuditJournalStore => ({
  async append(projectId, candidate) {
    const parsed = operationalAuditEventSchema.safeParse(candidate);
    if (
      !parsed.success ||
      parsed.data.origin !== 'desktop' ||
      parsed.data.projectId !== projectId
    ) {
      throw new LocalAuditJournalError(
        'invalid_event',
        'O evento não pertence ao diário local informado.',
      );
    }
    const event: OperationalAuditEvent = parsed.data;
    const directory = await prepareProjectDirectory(storageRoot, projectId);
    const destination = join(directory, 'operational-audit.jsonl');

    return withJournalLock(destination, async () => {
      const existed = await assertSafeJournalPath(destination);
      const handle = await open(
        destination,
        fileConstants.O_RDWR |
          fileConstants.O_APPEND |
          fileConstants.O_CREAT |
          fileConstants.O_NOFOLLOW,
        0o600,
      );
      try {
        const journal = await readOpenJournal(handle, projectId);
        const unsignedEntry = {
          sequence: journal.nextSequence,
          previousHash: journal.lastEntryHash,
          event,
        } as const;
        const entry = journalEntrySchema.parse({
          ...unsignedEntry,
          entryHash: calculateEntryHash(unsignedEntry),
        });
        const line = `${serializeCanonicalAuditJson(entry)}\n`;
        if (
          Buffer.byteLength(line, 'utf8') + (await handle.stat()).size >
          MAX_AUDIT_JOURNAL_BYTES
        ) {
          throw new LocalAuditJournalError(
            'journal_too_large',
            'O diário de auditoria excederia o limite permitido.',
          );
        }
        await handle.writeFile(line, 'utf8');
        await handle.sync();
        if (!existed) await syncDirectory(directory);
        return entry;
      } finally {
        await handle.close();
      }
    });
  },

  async read(projectId) {
    const directory = await prepareProjectDirectory(storageRoot, projectId);
    const destination = join(directory, 'operational-audit.jsonl');
    return withJournalLock(destination, async () => {
      if (!(await assertSafeJournalPath(destination))) {
        return { entries: [], nextSequence: 1, lastEntryHash: ZERO_HASH };
      }
      const handle = await open(destination, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
      try {
        return await readOpenJournal(handle, projectId);
      } finally {
        await handle.close();
      }
    });
  },

  async listProjectIds() {
    const journalsRoot = join(storageRoot, 'audit-journals');
    await mkdir(journalsRoot, { recursive: true, mode: 0o700 });
    await assertPrivateDirectory(journalsRoot);
    const entries = await readdir(journalsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  },
});
