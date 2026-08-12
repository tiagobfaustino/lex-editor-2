import {
  deriveStructuredChanges,
  validarIdentifiedNormaAst,
  type IdentifiedNormaAST,
  type StructuredChanges,
} from '@lex-editor/legal-domain';
import { z } from 'zod';

import {
  deriveNextPublicationNumber,
  deriveNextPublicationVersion,
  publicationGitShaSchema,
  publicationUuidSchema,
  publicationVersionSchema,
  type PublicationImpact,
} from '../../../src/shared/publication/manifest.js';

const timestampSchema = z.iso.datetime();
const rollbackJustificationSchema = z
  .string()
  .trim()
  .min(10)
  .max(1_000)
  .regex(/^[^\r\n]+$/u);

export interface StoredPublicationVersion {
  readonly versionId: string;
  readonly lawId: string;
  readonly version: string;
  readonly publicationNumber: number;
  readonly publicationKind: 'initial' | 'legislative_update' | 'editorial_correction' | 'rollback';
  readonly restoredVersionId: string | null;
  readonly gitCommitSha: string;
  readonly publishedAt: string;
  readonly sourceSummary: string;
  readonly ast: IdentifiedNormaAST;
}

export interface PublicationVersionRepository {
  listByLawId(lawId: string): Promise<readonly StoredPublicationVersion[]>;
  getById(lawId: string, versionId: string): Promise<StoredPublicationVersion | null>;
  getCurrent(lawId: string): Promise<StoredPublicationVersion | null>;
}

export interface PublicationHistoryItem {
  readonly versionId: string;
  readonly lawId: string;
  readonly version: string;
  readonly publicationNumber: number;
  readonly publicationKind: StoredPublicationVersion['publicationKind'];
  readonly restoredVersionId: string | null;
  readonly gitCommitSha: string;
  readonly publishedAt: string;
  readonly isCurrent: boolean;
  readonly sourceSummary: string;
}

export interface PublicationVersionDiff {
  readonly lawId: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly publicationImpact: PublicationImpact;
  readonly requiresLegalApproval: boolean;
  readonly changes: StructuredChanges;
}

export interface RollbackPublicationDraft extends PublicationVersionDiff {
  readonly restoredVersionId: string;
  readonly restoredVersion: string;
  readonly targetVersion: string;
  readonly targetPublicationNumber: number;
  readonly justification: string;
  readonly ast: IdentifiedNormaAST;
}

export class PublicationHistoryError extends Error {
  constructor(
    readonly code:
      'history_not_found' | 'version_not_found' | 'invalid_history' | 'invalid_rollback',
    message: string,
  ) {
    super(message);
  }
}

const parseVersion = (raw: StoredPublicationVersion): StoredPublicationVersion => {
  const ast = validarIdentifiedNormaAst(raw.ast);
  if (!ast.ok) {
    throw new PublicationHistoryError('invalid_history', 'O snapshot histórico não é válido.');
  }
  return Object.freeze({
    ...raw,
    versionId: publicationUuidSchema.parse(raw.versionId),
    lawId: publicationUuidSchema.parse(raw.lawId),
    version: publicationVersionSchema.parse(raw.version),
    publicationNumber: z.int().positive().parse(raw.publicationNumber),
    restoredVersionId:
      raw.restoredVersionId === null ? null : publicationUuidSchema.parse(raw.restoredVersionId),
    gitCommitSha: publicationGitShaSchema.parse(raw.gitCommitSha),
    publishedAt: timestampSchema.parse(raw.publishedAt),
    sourceSummary: z.string().trim().min(1).max(500).parse(raw.sourceSummary),
    ast: ast.valor,
  });
};

const hasNormativeChanges = (changes: StructuredChanges): boolean =>
  changes.included.length > 0 ||
  changes.amended.length > 0 ||
  changes.revoked.length > 0 ||
  changes.renumbered.length > 0;

const makeDiff = (
  lawId: string,
  from: StoredPublicationVersion,
  to: StoredPublicationVersion,
): PublicationVersionDiff => {
  const changes = deriveStructuredChanges(from.ast, to.ast);
  const publicationImpact: PublicationImpact = hasNormativeChanges(changes)
    ? 'normative_projection'
    : 'editorial_metadata';
  return Object.freeze({
    lawId,
    fromVersionId: from.versionId,
    toVersionId: to.versionId,
    fromVersion: from.version,
    toVersion: to.version,
    publicationImpact,
    requiresLegalApproval: publicationImpact === 'normative_projection',
    changes,
  });
};

export const createPublicationHistoryService = (options: {
  versions: PublicationVersionRepository;
  now?: () => Date;
}) => {
  const now = options.now ?? (() => new Date());

  const getPair = async (lawId: string, fromVersionId: string, toVersionId: string) => {
    const parsedLawId = publicationUuidSchema.parse(lawId);
    const parsedFromId = publicationUuidSchema.parse(fromVersionId);
    const parsedToId = publicationUuidSchema.parse(toVersionId);
    const [rawFrom, rawTo] = await Promise.all([
      options.versions.getById(parsedLawId, parsedFromId),
      options.versions.getById(parsedLawId, parsedToId),
    ]);
    if (rawFrom === null || rawTo === null) {
      throw new PublicationHistoryError(
        'version_not_found',
        'Uma das versões solicitadas não pertence à lei.',
      );
    }
    const from = parseVersion(rawFrom);
    const to = parseVersion(rawTo);
    if (from.lawId !== parsedLawId || to.lawId !== parsedLawId) {
      throw new PublicationHistoryError(
        'version_not_found',
        'Uma das versões solicitadas não pertence à lei.',
      );
    }
    return { lawId: parsedLawId, from, to };
  };

  return {
    async list(lawId: string): Promise<readonly PublicationHistoryItem[]> {
      const parsedLawId = publicationUuidSchema.parse(lawId);
      const [rawVersions, rawCurrent] = await Promise.all([
        options.versions.listByLawId(parsedLawId),
        options.versions.getCurrent(parsedLawId),
      ]);
      const current = rawCurrent === null ? null : parseVersion(rawCurrent);
      const versions = rawVersions.map(parseVersion);
      const numbers = new Set<number>();
      const ids = new Set<string>();
      for (const version of versions) {
        if (
          version.lawId !== parsedLawId ||
          numbers.has(version.publicationNumber) ||
          ids.has(version.versionId)
        ) {
          throw new PublicationHistoryError(
            'invalid_history',
            'O histórico contém identidade ou sequência inconsistente.',
          );
        }
        numbers.add(version.publicationNumber);
        ids.add(version.versionId);
      }
      return Object.freeze(
        [...versions]
          .sort((left, right) => right.publicationNumber - left.publicationNumber)
          .map((version) =>
            Object.freeze({
              versionId: version.versionId,
              lawId: version.lawId,
              version: version.version,
              publicationNumber: version.publicationNumber,
              publicationKind: version.publicationKind,
              restoredVersionId: version.restoredVersionId,
              gitCommitSha: version.gitCommitSha,
              publishedAt: version.publishedAt,
              isCurrent: current?.versionId === version.versionId,
              sourceSummary: version.sourceSummary,
            }),
          ),
      );
    },

    async diff(
      lawId: string,
      fromVersionId: string,
      toVersionId: string,
    ): Promise<PublicationVersionDiff> {
      const pair = await getPair(lawId, fromVersionId, toVersionId);
      return makeDiff(pair.lawId, pair.from, pair.to);
    },

    async prepareRollback(input: {
      lawId: string;
      restoreVersionId: string;
      justification: string;
    }): Promise<RollbackPublicationDraft> {
      const lawId = publicationUuidSchema.parse(input.lawId);
      const restoreVersionId = publicationUuidSchema.parse(input.restoreVersionId);
      const justification = rollbackJustificationSchema.parse(input.justification);
      const [rawCurrent, rawRestored] = await Promise.all([
        options.versions.getCurrent(lawId),
        options.versions.getById(lawId, restoreVersionId),
      ]);
      if (rawCurrent === null) {
        throw new PublicationHistoryError('history_not_found', 'A lei ainda não foi publicada.');
      }
      if (rawRestored === null) {
        throw new PublicationHistoryError(
          'version_not_found',
          'A versão escolhida não pertence à lei.',
        );
      }
      const current = parseVersion(rawCurrent);
      const restored = parseVersion(rawRestored);
      if (
        current.lawId !== lawId ||
        restored.lawId !== lawId ||
        current.versionId === restored.versionId
      ) {
        throw new PublicationHistoryError(
          'invalid_rollback',
          'Rollback exige uma versão histórica anterior da mesma lei.',
        );
      }
      const diff = makeDiff(lawId, current, restored);
      const instant = now().toISOString();
      const rollbackAst = structuredClone(restored.ast);
      rollbackAst.versaoVinculex = deriveNextPublicationVersion(
        current.version,
        diff.publicationImpact,
      );
      rollbackAst.publicationStatus = 'review';
      rollbackAst.dataFormatacaoVinculex = instant.slice(0, 10);
      rollbackAst.dataVerificacaoIntegridade = instant.slice(0, 10);
      const validation = validarIdentifiedNormaAst(rollbackAst);
      if (!validation.ok) {
        throw new PublicationHistoryError(
          'invalid_rollback',
          'O snapshot restaurado não produz uma candidata jurídica válida.',
        );
      }
      return Object.freeze({
        ...diff,
        restoredVersionId: restored.versionId,
        restoredVersion: restored.version,
        targetVersion: rollbackAst.versaoVinculex,
        targetPublicationNumber: deriveNextPublicationNumber(current.publicationNumber),
        justification,
        ast: validation.valor,
      });
    },
  };
};

export type PublicationHistoryService = ReturnType<typeof createPublicationHistoryService>;
