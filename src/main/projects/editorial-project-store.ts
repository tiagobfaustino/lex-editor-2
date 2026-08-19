import { createHash, randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { z } from 'zod';

import {
  calculateRevisionHash,
  editorialCheckpointSchema,
  parseEditorialJournal,
  replayEditorialJournal,
  revisionHashSchema,
  type EditorialCheckpoint,
  type EditorialJournal,
  type IdentifiedNormaAST,
  type RevisionHash,
} from '@lex-editor/legal-domain';

import {
  ContentProjectionProfileDtoSchema,
  type ContentProjectionProfileDto,
} from '../../shared/ipc/import.js';

const MAX_EDITORIAL_FILE_BYTES = 64 * 1024 * 1024;
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

type CheckpointIssue = 'missing_checkpoint' | 'invalid_checkpoint' | 'corrupt_checkpoint';

export const REPROCESSING_STATUSES = [
  'running',
  'awaiting_promotion',
  'completed',
  'conflicted',
  'failed',
  'cancelled',
] as const;

export const ReprocessingStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  requestId: z.uuid(),
  incidentId: z.uuid().nullable(),
  plan: z.enum(['from_source_snapshot', 'from_identified_revision']),
  reason: z.string().min(1).max(500),
  expectedRevisionHash: revisionHashSchema,
  status: z.enum(REPROCESSING_STATUSES),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  resultingRevisionHash: revisionHashSchema.nullable(),
  conflictCode: z.string().min(1).max(200).nullable(),
});

export type ReprocessingState = z.infer<typeof ReprocessingStateSchema>;

export type EditorialProjectRecoveryResult =
  | Readonly<{
      ok: true;
      journal: EditorialJournal;
      ast: IdentifiedNormaAST;
      revisionHash: RevisionHash;
      checkpointUsed: boolean;
      checkpointIssue: CheckpointIssue | null;
      replayedEntries: number;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code:
          | 'invalid_project_id'
          | 'project_not_found'
          | 'unsafe_storage'
          | 'journal_corrupt'
          | 'replay_failed';
        message: string;
      }>;
    }>;

export type EditorialProjectStore = Readonly<{
  saveJournal(rawJournal: unknown): Promise<EditorialJournal>;
  saveCheckpoint(projectId: string, rawCheckpoint: unknown): Promise<EditorialCheckpoint>;
  saveRevision(
    rawJournal: unknown,
    rawCheckpoint: unknown,
  ): Promise<Readonly<{ journal: EditorialJournal; checkpoint: EditorialCheckpoint }>>;
  saveProjectionPreference(
    projectId: string,
    projectionProfile: ContentProjectionProfileDto,
  ): Promise<ContentProjectionProfileDto>;
  loadProjectionPreference(projectId: string): Promise<ContentProjectionProfileDto | null>;
  recover(projectId: string): Promise<EditorialProjectRecoveryResult>;
  saveReprocessingState(rawState: unknown): Promise<ReprocessingState>;
  loadReprocessingState(projectId: string): Promise<ReprocessingState | null>;
}>;

const ProjectionPreferenceFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  projectionProfile: ContentProjectionProfileDtoSchema,
});

class StoreError extends Error {
  constructor(
    readonly code:
      'invalid_project_id' | 'project_not_found' | 'unsafe_storage' | 'journal_corrupt',
    message: string,
  ) {
    super(message);
  }
}

const assertProjectId = (projectId: string): void => {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new StoreError('invalid_project_id', 'O identificador do projeto é inválido.');
  }
};

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};

const assertDirectory = async (path: string): Promise<void> => {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new StoreError('unsafe_storage', 'O armazenamento editorial não é um diretório seguro.');
  }
};

const prepareProjectDirectory = async (
  projectsRoot: string,
  projectId: string,
  create: boolean,
): Promise<string> => {
  assertProjectId(projectId);
  await mkdir(projectsRoot, { recursive: true, mode: 0o700 });
  await assertDirectory(projectsRoot);
  const projectsRootReal = await realpath(projectsRoot);
  const projectDirectory = join(projectsRootReal, projectId);
  if (create) await mkdir(projectDirectory, { recursive: true, mode: 0o700 });
  try {
    await assertDirectory(projectDirectory);
  } catch (error) {
    if (
      !create &&
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw new StoreError('project_not_found', 'O projeto editorial não foi encontrado.');
    }
    throw error;
  }
  const projectReal = await realpath(projectDirectory);
  if (!isInside(projectsRootReal, projectReal)) {
    throw new StoreError(
      'unsafe_storage',
      'O diretório do projeto escapa do armazenamento editorial.',
    );
  }
  return projectReal;
};

const assertReplaceableFile = async (path: string): Promise<void> => {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new StoreError(
        'unsafe_storage',
        'O artefato editorial existente não é um arquivo seguro.',
      );
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

const writeJsonAtomically = async (destination: string, value: unknown): Promise<void> => {
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
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
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

const readJsonFile = async (path: string, optional: boolean): Promise<unknown> => {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      if (optional) return undefined;
      throw new StoreError('journal_corrupt', 'O diário editorial persistido está ausente.');
    }
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_EDITORIAL_FILE_BYTES) {
    throw new StoreError('unsafe_storage', 'O artefato editorial persistido não é seguro.');
  }
  const handle = await open(path, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_EDITORIAL_FILE_BYTES) {
      throw new StoreError('unsafe_storage', 'O artefato editorial excede o limite permitido.');
    }
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new StoreError('journal_corrupt', 'O artefato editorial contém JSON inválido.');
    }
  } finally {
    await handle.close();
  }
};

const recoveryFailure = (
  error: unknown,
): Extract<EditorialProjectRecoveryResult, { ok: false }> => {
  if (error instanceof StoreError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return {
    ok: false,
    error: { code: 'unsafe_storage', message: 'Não foi possível ler o armazenamento editorial.' },
  };
};

export const createEditorialProjectStore = (storageRoot: string): EditorialProjectStore => {
  const projectsRoot = join(storageRoot, 'editorial-projects');

  return {
    async saveJournal(rawJournal) {
      const journal = parseEditorialJournal(rawJournal, sha256);
      const directory = await prepareProjectDirectory(projectsRoot, journal.projectId, true);
      await writeJsonAtomically(join(directory, 'journal.json'), journal);
      return journal;
    },

    async saveCheckpoint(projectId, rawCheckpoint) {
      assertProjectId(projectId);
      const checkpoint = editorialCheckpointSchema.parse(rawCheckpoint);
      if (checkpoint.projectId !== projectId) {
        throw new StoreError(
          'invalid_project_id',
          'O checkpoint não pertence ao projeto editorial informado.',
        );
      }
      const directory = await prepareProjectDirectory(projectsRoot, projectId, true);
      await writeJsonAtomically(join(directory, 'checkpoint.json'), checkpoint);
      return checkpoint;
    },

    async saveRevision(rawJournal, rawCheckpoint) {
      const journal = parseEditorialJournal(rawJournal, sha256);
      const checkpoint = editorialCheckpointSchema.parse(rawCheckpoint);
      if (
        checkpoint.projectId !== journal.projectId ||
        checkpoint.journalId !== journal.journalId ||
        checkpoint.throughSequence !== journal.entries.length ||
        checkpoint.revisionHash !==
          (journal.entries.at(-1)?.resultRevisionHash ?? journal.base.revisionHash) ||
        calculateRevisionHash(checkpoint.ast, sha256) !== checkpoint.revisionHash
      ) {
        throw new StoreError(
          'journal_corrupt',
          'O checkpoint não representa a revisão final do diário informado.',
        );
      }
      const directory = await prepareProjectDirectory(projectsRoot, journal.projectId, true);
      // O checkpoint futuro é escrito primeiro. Se a segunda escrita falhar, o
      // diário anterior continua sendo a autoridade e o checkpoint é ignorado
      // com segurança na recuperação.
      await writeJsonAtomically(join(directory, 'checkpoint.json'), checkpoint);
      await writeJsonAtomically(join(directory, 'journal.json'), journal);
      return { journal, checkpoint };
    },

    async saveProjectionPreference(projectId, projectionProfile) {
      assertProjectId(projectId);
      const preference = ProjectionPreferenceFileSchema.parse({
        schemaVersion: 1,
        projectId,
        projectionProfile,
      });
      const directory = await prepareProjectDirectory(projectsRoot, projectId, true);
      await writeJsonAtomically(join(directory, 'projection-preference.json'), preference);
      return preference.projectionProfile;
    },

    async loadProjectionPreference(projectId) {
      const directory = await prepareProjectDirectory(projectsRoot, projectId, false);
      const rawPreference = await readJsonFile(join(directory, 'projection-preference.json'), true);
      if (rawPreference === undefined) return null;
      return ProjectionPreferenceFileSchema.parse(rawPreference).projectionProfile;
    },

    async saveReprocessingState(rawState) {
      const state = ReprocessingStateSchema.parse(rawState);
      const directory = await prepareProjectDirectory(projectsRoot, state.projectId, true);
      await writeJsonAtomically(join(directory, 'reprocessing.json'), state);
      return state;
    },

    async loadReprocessingState(projectId) {
      const directory = await prepareProjectDirectory(projectsRoot, projectId, false);
      const rawState = await readJsonFile(join(directory, 'reprocessing.json'), true);
      if (rawState === undefined) return null;
      return ReprocessingStateSchema.parse(rawState);
    },

    async recover(projectId) {
      try {
        const directory = await prepareProjectDirectory(projectsRoot, projectId, false);
        const rawJournal = await readJsonFile(join(directory, 'journal.json'), false);
        let journal: EditorialJournal;
        try {
          journal = parseEditorialJournal(rawJournal, sha256);
        } catch {
          return {
            ok: false,
            error: {
              code: 'journal_corrupt',
              message: 'O diário editorial persistido é inválido ou foi adulterado.',
            },
          };
        }

        let rawCheckpoint: unknown = undefined;
        let checkpointIssue: CheckpointIssue | null = null;
        try {
          rawCheckpoint = await readJsonFile(join(directory, 'checkpoint.json'), true);
          if (rawCheckpoint === undefined) checkpointIssue = 'missing_checkpoint';
        } catch (error) {
          if (error instanceof StoreError && error.code === 'journal_corrupt') {
            checkpointIssue = 'corrupt_checkpoint';
          } else {
            throw error;
          }
        }

        let replay = replayEditorialJournal(journal, sha256, rawCheckpoint);
        if (!replay.ok && replay.error.code === 'invalid_checkpoint') {
          checkpointIssue = 'invalid_checkpoint';
          replay = replayEditorialJournal(journal, sha256);
        }
        if (!replay.ok) {
          return {
            ok: false,
            error: {
              code: 'replay_failed',
              message: 'O diário editorial não pôde ser reexecutado com segurança.',
            },
          };
        }
        return {
          ok: true,
          journal,
          ast: replay.ast,
          revisionHash: replay.revisionHash,
          checkpointUsed: replay.checkpointUsed,
          checkpointIssue,
          replayedEntries: replay.replayedEntries,
        };
      } catch (error) {
        return recoveryFailure(error);
      }
    },
  };
};
