import { randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';

import { z } from 'zod';

import {
  publicationApprovalSchema,
  publicationDigestSchema,
  publicationUuidSchema,
} from '../../shared/publication/approval.js';
import {
  calculatePublicationManifestDigest,
  parseCanonicalPublicationManifest,
  publicationVersionSchema,
} from './manifest.js';

const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_JOURNAL_BYTES = 2 * 1024 * 1024;

const timestampSchema = z.iso
  .datetime()
  .regex(UTC_TIMESTAMP, 'Expected a canonical UTC timestamp.');
const gitShaSchema = z.string().regex(GIT_SHA, 'Expected a Git SHA-1 or SHA-256.');
const candidateBranchSchema = z
  .string()
  .regex(/^releases\/[0-9a-f-]{36}$/u, 'Expected a publication candidate branch.');

const preparedEventSchema = z.strictObject({
  eventId: publicationUuidSchema,
  status: z.literal('prepared'),
  occurredAt: timestampSchema,
});

const committedEventSchema = z.strictObject({
  eventId: publicationUuidSchema,
  status: z.literal('committed_local'),
  occurredAt: timestampSchema,
  gitCommitSha: gitShaSchema,
});

const pushedEventSchema = z.strictObject({
  eventId: publicationUuidSchema,
  status: z.literal('pushed'),
  occurredAt: timestampSchema,
  gitCommitSha: gitShaSchema,
});

const failedEventSchema = z.strictObject({
  eventId: publicationUuidSchema,
  status: z.literal('failed'),
  occurredAt: timestampSchema,
  resumeFromStatus: z.enum(['prepared', 'committed_local']),
  failureCode: z.enum([
    'git_base_conflict',
    'git_commit_failed',
    'git_push_failed',
    'unsafe_candidate',
  ]),
  gitCommitSha: gitShaSchema.nullable(),
});

export const publicationJournalEventSchema = z.discriminatedUnion('status', [
  preparedEventSchema,
  committedEventSchema,
  pushedEventSchema,
  failedEventSchema,
]);

export const publicationJournalSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    publicationId: publicationUuidSchema,
    idempotencyKey: publicationUuidSchema,
    lawId: publicationUuidSchema,
    targetVersion: publicationVersionSchema,
    targetPublicationNumber: z.int().positive(),
    manifestCanonical: z.string().min(2),
    manifestDigest: publicationDigestSchema,
    approval: publicationApprovalSchema,
    artifactRelativePaths: z.array(z.string().min(1).max(512)).min(4).max(104),
    candidateBranch: candidateBranchSchema,
    events: z.array(publicationJournalEventSchema).min(1).max(1_000),
  })
  .superRefine((journal, context) => {
    let manifest;
    try {
      manifest = parseCanonicalPublicationManifest(journal.manifestCanonical);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['manifestCanonical'],
        message: 'The persisted publication manifest is invalid or noncanonical.',
      });
      return;
    }
    if (calculatePublicationManifestDigest(manifest) !== journal.manifestDigest) {
      context.addIssue({
        code: 'custom',
        path: ['manifestDigest'],
        message: 'The persisted manifest digest does not match its canonical bytes.',
      });
    }
    if (
      journal.publicationId !== manifest.publicationId ||
      journal.idempotencyKey !== manifest.idempotencyKey ||
      journal.lawId !== manifest.law.lawId ||
      journal.targetVersion !== manifest.target.version ||
      journal.targetPublicationNumber !== manifest.target.publicationNumber
    ) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'The journal identity does not match the immutable manifest.',
      });
    }
    if (
      journal.approval.publicationId !== manifest.publicationId ||
      journal.approval.manifestDigest !== journal.manifestDigest ||
      journal.approval.userId !== manifest.approvedBy.userId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approval'],
        message: 'The approval does not match the manifest actor and digest.',
      });
    }
    if (journal.candidateBranch !== `releases/${journal.publicationId}`) {
      context.addIssue({
        code: 'custom',
        path: ['candidateBranch'],
        message: 'The candidate branch must be derived from publicationId.',
      });
    }

    let provenStatus: 'none' | 'prepared' | 'committed_local' | 'pushed' = 'none';
    let provenCommit: string | null = null;
    const eventIds = new Set<string>();
    for (const [index, event] of journal.events.entries()) {
      if (eventIds.has(event.eventId)) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'eventId'],
          message: 'Journal event identifiers must be unique.',
        });
      }
      eventIds.add(event.eventId);

      if (event.status === 'prepared') {
        if (provenStatus !== 'none') {
          context.addIssue({
            code: 'custom',
            path: ['events', index],
            message: 'Prepared must be the first and only initial event.',
          });
        }
        provenStatus = 'prepared';
      } else if (event.status === 'committed_local') {
        if (provenStatus !== 'prepared') {
          context.addIssue({
            code: 'custom',
            path: ['events', index],
            message: 'A local commit requires a proven prepared stage.',
          });
        }
        provenStatus = 'committed_local';
        provenCommit = event.gitCommitSha;
      } else if (event.status === 'pushed') {
        if (provenStatus !== 'committed_local' || event.gitCommitSha !== provenCommit) {
          context.addIssue({
            code: 'custom',
            path: ['events', index],
            message: 'A push requires the exact proven local commit.',
          });
        }
        provenStatus = 'pushed';
      } else if (
        provenStatus === 'none' ||
        provenStatus === 'pushed' ||
        event.resumeFromStatus !== provenStatus ||
        event.gitCommitSha !== provenCommit
      ) {
        context.addIssue({
          code: 'custom',
          path: ['events', index],
          message: 'A failure must retain the last safely proven stage and SHA.',
        });
      }
    }
  });

export type PublicationJournal = z.infer<typeof publicationJournalSchema>;
export type PublicationJournalEvent = z.infer<typeof publicationJournalEventSchema>;
export type ProvenPublicationStatus = 'prepared' | 'committed_local' | 'pushed';

export class PublicationJournalError extends Error {
  constructor(
    readonly code: 'invalid_journal' | 'journal_conflict' | 'journal_not_found' | 'unsafe_storage',
    message: string,
  ) {
    super(message);
  }
}

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};

const assertDirectory = async (path: string): Promise<void> => {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PublicationJournalError('unsafe_storage', 'O diário não usa um diretório seguro.');
  }
};

const prepareDirectory = async (storageRoot: string, publicationId: string): Promise<string> => {
  const validatedId = publicationUuidSchema.parse(publicationId);
  const journalsRoot = join(storageRoot, 'publication-attempts');
  await mkdir(journalsRoot, { recursive: true, mode: 0o700 });
  await assertDirectory(journalsRoot);
  const rootReal = await realpath(journalsRoot);
  const directory = join(rootReal, validatedId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertDirectory(directory);
  const directoryReal = await realpath(directory);
  if (!isInside(rootReal, directoryReal)) {
    throw new PublicationJournalError('unsafe_storage', 'O diário escapa da raiz configurada.');
  }
  return directoryReal;
};

const assertReplaceableFile = async (path: string): Promise<void> => {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new PublicationJournalError('unsafe_storage', 'O arquivo do diário não é seguro.');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }
};

const syncDirectory = async (path: string): Promise<void> => {
  const directory = await open(path, fileConstants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};

const writeAtomically = async (destination: string, journal: PublicationJournal): Promise<void> => {
  const directory = dirname(destination);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  await assertReplaceableFile(destination);
  const handle = await open(
    temporary,
    fileConstants.O_WRONLY |
      fileConstants.O_CREAT |
      fileConstants.O_EXCL |
      fileConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(journal)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await assertReplaceableFile(destination);
    await rename(temporary, destination);
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

const readJournal = async (path: string): Promise<PublicationJournal | null> => {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_JOURNAL_BYTES) {
    throw new PublicationJournalError('unsafe_storage', 'O arquivo do diário não é seguro.');
  }
  const handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_JOURNAL_BYTES) {
      throw new PublicationJournalError('unsafe_storage', 'O diário excede o limite permitido.');
    }
    try {
      return publicationJournalSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
    } catch {
      throw new PublicationJournalError(
        'invalid_journal',
        'O diário de publicação persistido é inválido ou foi adulterado.',
      );
    }
  } finally {
    await handle.close();
  }
};

export const getProvenPublicationState = (
  journal: PublicationJournal,
): Readonly<{ status: ProvenPublicationStatus; gitCommitSha: string | null }> => {
  const parsed = publicationJournalSchema.parse(journal);
  let status: ProvenPublicationStatus = 'prepared';
  let gitCommitSha: string | null = null;
  for (const event of parsed.events) {
    if (event.status === 'committed_local') {
      status = 'committed_local';
      gitCommitSha = event.gitCommitSha;
    } else if (event.status === 'pushed') {
      status = 'pushed';
      gitCommitSha = event.gitCommitSha;
    }
  }
  return { status, gitCommitSha };
};

export interface PublicationJournalStore {
  create(journal: unknown): Promise<PublicationJournal>;
  load(publicationId: string): Promise<PublicationJournal | null>;
  append(publicationId: string, event: unknown): Promise<PublicationJournal>;
}

export const createPublicationJournalStore = (storageRoot: string): PublicationJournalStore => ({
  async create(rawJournal) {
    const journal = publicationJournalSchema.parse(rawJournal);
    const directory = await prepareDirectory(storageRoot, journal.publicationId);
    const destination = join(directory, 'journal.json');
    const existing = await readJournal(destination);
    if (existing !== null) {
      if (JSON.stringify(existing) !== JSON.stringify(journal)) {
        throw new PublicationJournalError(
          'journal_conflict',
          'A tentativa já possui um diário imutável diferente.',
        );
      }
      return existing;
    }
    await writeAtomically(destination, journal);
    return journal;
  },

  async load(publicationId) {
    const directory = await prepareDirectory(storageRoot, publicationId);
    return readJournal(join(directory, 'journal.json'));
  },

  async append(publicationId, rawEvent) {
    const directory = await prepareDirectory(storageRoot, publicationId);
    const destination = join(directory, 'journal.json');
    const existing = await readJournal(destination);
    if (existing === null) {
      throw new PublicationJournalError('journal_not_found', 'O diário da tentativa não existe.');
    }
    const event = publicationJournalEventSchema.parse(rawEvent);
    const next = publicationJournalSchema.parse({
      ...existing,
      events: [...existing.events, event],
    });
    await writeAtomically(destination, next);
    return next;
  },
});
