import {
  publicationKindSchema,
  sourceRoleSchema,
  sourceTypeSchema,
  sourceVariantSchema,
  updateEntrySchema,
  type UpdateEntry,
} from '@lex-editor/legal-domain';
import { z } from 'zod';

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const SAFE_DIRECTORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const MAX_PUBLICATION_MANIFEST_BYTES = 256 * 1024;
export const MAX_PUBLICATION_NUMBER = 999_999;

export const publicationUuidSchema = z
  .uuid()
  .refine((value) => value === value.toLocaleLowerCase('en-US'), 'UUID must be lowercase.');
export const publicationSha256Schema = z.string().regex(SHA256, 'Expected lowercase SHA-256.');
export const publicationGitShaSchema = z
  .string()
  .regex(GIT_SHA, 'Expected a Git SHA-1 or SHA-256.');
export const publicationVersionSchema = z
  .string()
  .regex(SEMVER, 'Expected SemVer without a v prefix.');
export const publicationImpactSchema = z.enum([
  'representation_contract',
  'normative_projection',
  'editorial_metadata',
]);

const sourceSnapshotSchema = z.strictObject({
  sourceType: sourceTypeSchema,
  sourceRole: sourceRoleSchema,
  sourceVariant: sourceVariantSchema,
  sourceUrl: z.url().max(2_048).optional(),
  finalUrl: z.url().max(2_048).optional(),
  sourceArtifactSha256: publicationSha256Schema,
  capturedAt: z.iso.datetime().regex(UTC_TIMESTAMP, 'Expected a canonical UTC timestamp.'),
});

const commonManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  publicationId: publicationUuidSchema,
  idempotencyKey: publicationUuidSchema,
  law: z.strictObject({
    lawId: publicationUuidSchema,
    directoryName: z.string().min(1).max(120).regex(SAFE_DIRECTORY),
  }),
  target: z.strictObject({
    version: publicationVersionSchema,
    publicationNumber: z.int().positive().max(MAX_PUBLICATION_NUMBER),
    kind: publicationKindSchema,
    impact: publicationImpactSchema,
    restoredVersionId: publicationUuidSchema.nullable(),
  }),
  expectedBase: z.strictObject({
    gitCommitSha: publicationGitShaSchema,
    publishedVersionId: publicationUuidSchema.nullable(),
  }),
  artifacts: z.strictObject({
    markdownSha256: publicationSha256Schema,
    updateMarkdownSha256: publicationSha256Schema,
    identifiedAstSha256: publicationSha256Schema,
  }),
  sourceSnapshots: z.array(sourceSnapshotSchema).min(1).max(100),
  approvedBy: z.strictObject({
    userId: publicationUuidSchema,
    role: z.literal('editor_juridico'),
  }),
  changelog: updateEntrySchema,
  preparedAt: z.iso.datetime().regex(UTC_TIMESTAMP, 'Expected a canonical UTC timestamp.'),
});

export const publicationManifestSchema = commonManifestSchema.superRefine((manifest, context) => {
  if (manifest.publicationId === manifest.idempotencyKey) {
    context.addIssue({
      code: 'custom',
      path: ['idempotencyKey'],
      message: 'publicationId and idempotencyKey must identify different concepts.',
    });
  }
  const primarySources = manifest.sourceSnapshots.filter(
    (snapshot) => snapshot.sourceRole === 'primary_current',
  );
  if (primarySources.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['sourceSnapshots'],
      message: 'A publication manifest must declare exactly one primary_current snapshot.',
    });
  }
  const sourceKeys = new Set<string>();
  for (const [index, snapshot] of manifest.sourceSnapshots.entries()) {
    const key = [
      snapshot.sourceType,
      snapshot.sourceRole,
      snapshot.sourceVariant,
      snapshot.sourceUrl ?? '',
      snapshot.finalUrl ?? '',
      snapshot.sourceArtifactSha256,
    ].join('\u0000');
    if (sourceKeys.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSnapshots', index],
        message: 'Duplicate source snapshot.',
      });
    }
    sourceKeys.add(key);
  }
  const hasPublishedVersionBase = manifest.expectedBase.publishedVersionId !== null;
  if (manifest.target.kind === 'initial') {
    if (manifest.target.version !== '1.0.0' || manifest.target.publicationNumber !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'The initial publication must use version 1.0.0 and publication number 1.',
      });
    }
    if (hasPublishedVersionBase) {
      context.addIssue({
        code: 'custom',
        path: ['expectedBase', 'publishedVersionId'],
        message: 'The initial publication cannot declare a published-version base.',
      });
    }
  } else if (!hasPublishedVersionBase) {
    context.addIssue({
      code: 'custom',
      path: ['expectedBase', 'publishedVersionId'],
      message: 'A subsequent publication must declare its expected published-version base.',
    });
  }
  if (manifest.target.kind === 'rollback') {
    if (manifest.target.restoredVersionId === null) {
      context.addIssue({
        code: 'custom',
        path: ['target', 'restoredVersionId'],
        message: 'A rollback must identify the restored version.',
      });
    }
  } else if (manifest.target.restoredVersionId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['target', 'restoredVersionId'],
      message: 'Only a rollback can identify a restored version.',
    });
  }
  if (
    manifest.changelog.version !== manifest.target.version ||
    manifest.changelog.publicationNumber !== manifest.target.publicationNumber ||
    manifest.changelog.kind !== manifest.target.kind
  ) {
    context.addIssue({
      code: 'custom',
      path: ['changelog'],
      message: 'The changelog entry must describe the exact publication target.',
    });
  }
});

export const publicationSequenceSchema = z
  .strictObject({
    previousVersion: publicationVersionSchema.nullable(),
    previousPublicationNumber: z.int().positive().max(MAX_PUBLICATION_NUMBER).nullable(),
    targetVersion: publicationVersionSchema,
    targetPublicationNumber: z.int().positive().max(MAX_PUBLICATION_NUMBER),
    impact: publicationImpactSchema,
  })
  .superRefine((sequence, context) => {
    const hasPreviousVersion = sequence.previousVersion !== null;
    if (hasPreviousVersion !== (sequence.previousPublicationNumber !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['previousVersion'],
        message: 'Previous version and publication number must both be present or both be null.',
      });
      return;
    }
    const expectedVersion = deriveNextPublicationVersion(sequence.previousVersion, sequence.impact);
    const expectedNumber = deriveNextPublicationNumber(sequence.previousPublicationNumber);
    if (sequence.targetVersion !== expectedVersion) {
      context.addIssue({
        code: 'custom',
        path: ['targetVersion'],
        message: `Expected version ${expectedVersion}.`,
      });
    }
    if (sequence.targetPublicationNumber !== expectedNumber) {
      context.addIssue({
        code: 'custom',
        path: ['targetPublicationNumber'],
        message: `Expected publication number ${String(expectedNumber)}.`,
      });
    }
  });

export type PublicationVersion = z.infer<typeof publicationVersionSchema>;
export type PublicationImpact = z.infer<typeof publicationImpactSchema>;
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;
export type PublicationSequence = z.infer<typeof publicationSequenceSchema>;
export type PublicationChangelogEntry = UpdateEntry;

const splitVersion = (version: string): readonly [bigint, bigint, bigint] => {
  const parts = publicationVersionSchema.parse(version).split('.');
  return [BigInt(parts[0] ?? ''), BigInt(parts[1] ?? ''), BigInt(parts[2] ?? '')];
};

export const deriveNextPublicationVersion = (
  previousVersion: string | null,
  impact: PublicationImpact,
): PublicationVersion => {
  publicationImpactSchema.parse(impact);
  if (previousVersion === null) return '1.0.0';
  const [major, minor, patch] = splitVersion(previousVersion);
  if (impact === 'representation_contract') return `${String(major + 1n)}.0.0`;
  if (impact === 'normative_projection') return `${String(major)}.${String(minor + 1n)}.0`;
  return `${String(major)}.${String(minor)}.${String(patch + 1n)}`;
};

export const deriveNextPublicationNumber = (previousNumber: number | null): number => {
  if (previousNumber === null) return 1;
  const parsed = z.int().positive().max(MAX_PUBLICATION_NUMBER).parse(previousNumber);
  if (parsed === MAX_PUBLICATION_NUMBER) {
    throw new Error('Publication number exceeds the six-digit manifest namespace.');
  }
  return parsed + 1;
};

export const validatePublicationSequence = (input: unknown): PublicationSequence =>
  publicationSequenceSchema.parse(input);

const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value !== 'object' || value === null) return value;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) canonical[key] = canonicalizeJson(child);
  }
  return canonical;
};

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
};

export const serializeCanonicalJson = (input: unknown): string => {
  return JSON.stringify(canonicalizeJson(input));
};

export const parsePublicationManifest = (input: unknown): Readonly<PublicationManifest> =>
  deepFreeze(publicationManifestSchema.parse(input));

export const serializePublicationManifest = (input: unknown): string =>
  serializeCanonicalJson(publicationManifestSchema.parse(input));

export const parseCanonicalPublicationManifest = (
  input: string | Uint8Array,
): Readonly<PublicationManifest> => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > MAX_PUBLICATION_MANIFEST_BYTES) {
    throw new Error('Publication manifest exceeds the maximum canonical size.');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text);
  if (text !== serializePublicationManifest(parsed)) {
    throw new Error('Publication manifest is not canonical JSON.');
  }
  return parsePublicationManifest(parsed);
};

const releaseStem = (directoryName: string, publicationNumber: number, version: string): string => {
  const directory = z.string().min(1).max(120).regex(SAFE_DIRECTORY).parse(directoryName);
  const number = z.int().positive().max(MAX_PUBLICATION_NUMBER).parse(publicationNumber);
  const parsedVersion = publicationVersionSchema.parse(version);
  return `leis/${directory}/.vinculex/releases/${String(number).padStart(6, '0')}-${parsedVersion}`;
};

export const publicationManifestRelativePath = (
  directoryName: string,
  publicationNumber: number,
  version: string,
): string => `${releaseStem(directoryName, publicationNumber, version)}.json`;

export const publicationIdentifiedAstRelativePath = (
  directoryName: string,
  publicationNumber: number,
  version: string,
): string => `${releaseStem(directoryName, publicationNumber, version)}.ast.json`;

export const publicationSourceSnapshotRelativePath = (
  directoryName: string,
  artifactSha256: string,
): string => {
  const directory = z.string().min(1).max(120).regex(SAFE_DIRECTORY).parse(directoryName);
  const digest = publicationSha256Schema.parse(artifactSha256);
  return `leis/${directory}/.vinculex/sources/${digest}.snapshot`;
};
