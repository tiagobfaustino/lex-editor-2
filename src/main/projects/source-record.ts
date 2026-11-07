import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import {
  sourceRoleSchema,
  sourceVariantSchema,
  type IdentifiedNormaAST,
  type SourceRole,
  type SourceVariant,
} from '@lex-editor/legal-domain';
import {
  sourceConfigurationEvidenceSchema,
  type SourceConfigurationEvidence,
} from '@lex-editor/source-ingestion';
import type { SourceSummaryDto } from '../../shared/ipc/import.js';

export type SourceArtifactRecord = Readonly<{
  sourceArtifactId: string;
  snapshotPath: string;
  finalUrl: string;
  sourceRole: SourceRole;
  sourceVariant: SourceVariant;
  sourceArtifactSha256: string;
}>;
export type SourceRecord = Readonly<{
  projectId: string;
  summary: SourceSummaryDto;
  primary: SourceArtifactRecord;
  artifacts: readonly SourceArtifactRecord[];
  configurationEvidence: SourceConfigurationEvidence | null;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const evidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceId: z.uuid(),
  configuration: sourceConfigurationEvidenceSchema,
  snapshots: z
    .array(
      z.strictObject({
        sourceArtifactId: z.uuid(),
        sourceArtifactSha256: z.string().regex(/^[0-9a-f]{64}$/u),
        sourceRole: sourceRoleSchema,
        sourceVariant: sourceVariantSchema,
        finalUrl: z.url().max(2048),
      }),
    )
    .max(100),
});
const inside = (root: string, path: string): boolean => {
  const value = relative(root, path);
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith(sep);
};
const directory = async (root: string, path: string): Promise<string> => {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('UNSAFE_SOURCE');
  const resolved = await realpath(path);
  if (!inside(root, resolved)) throw new Error('UNSAFE_SOURCE');
  return resolved;
};
const readSafe = async (root: string, path: string, maxBytes: number): Promise<Buffer> => {
  const info = await lstat(path);
  const resolved = await realpath(path);
  if (!info.isFile() || info.isSymbolicLink() || !inside(root, resolved))
    throw new Error('UNSAFE_SOURCE');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('UNSAFE_SOURCE');
    const bytes = await file.readFile();
    if (bytes.length > maxBytes) throw new Error('UNSAFE_SOURCE');
    return bytes;
  } finally {
    await file.close();
  }
};

/** Recupera apenas snapshots já salvos, nunca busca ou reinterpreta texto jurídico. */
export const recoverSourceRecord = async (
  storageRoot: string,
  projectId: string,
  baseAst: IdentifiedNormaAST,
  savedSummary: SourceSummaryDto | null,
): Promise<SourceRecord> => {
  const rootPath = join(storageRoot, 'sources');
  const info = await lstat(rootPath);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('UNSAFE_SOURCE');
  const root = await realpath(rootPath);
  const references = [baseAst.sourceRef, ...(baseAst.supportingSourceRefs ?? [])];
  const candidates: SourceRecord[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!uuid.test(entry.name) || (savedSummary !== null && entry.name !== savedSummary.sourceId))
      continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const dir = await directory(root, join(root, entry.name));
    const files = await readdir(dir, { withFileTypes: true });
    const matches = references.map((reference) =>
      files.find(
        (file) =>
          file.name.endsWith(`-${reference.sourceArtifactSha256}.html`) ||
          file.name.endsWith(`-${reference.sourceArtifactSha256}.md`),
      ),
    );
    if (matches.some((file) => file === undefined)) continue;
    const evidenceFile = files.find((file) => file.name === 'import-evidence.json');
    const evidence =
      evidenceFile === undefined
        ? null
        : evidenceSchema.parse(
            JSON.parse(
              (await readSafe(dir, join(dir, evidenceFile.name), 128 * 1024)).toString('utf8'),
            ),
          );
    if (evidence !== null && evidence.sourceId !== entry.name)
      throw new Error('INVALID_SOURCE_EVIDENCE');
    const artifacts: SourceArtifactRecord[] = [];
    let byteLength = 0;
    for (const [index, reference] of references.entries()) {
      const match = files.find((file) => {
        if (
          !file.name.endsWith(`-${reference.sourceArtifactSha256}.html`) &&
          !file.name.endsWith(`-${reference.sourceArtifactSha256}.md`)
        )
          return false;
        const id = file.name.slice(0, 36);
        if (evidence !== null)
          return evidence.snapshots.some(
            (snapshot) =>
              snapshot.sourceArtifactId === id &&
              snapshot.sourceArtifactSha256 === reference.sourceArtifactSha256 &&
              snapshot.sourceRole === reference.sourceRole &&
              snapshot.sourceVariant === reference.sourceVariant,
          );
        return reference.sourceRole === 'primary_current'
          ? id === entry.name
          : !artifacts.some((artifact) => artifact.sourceArtifactId === id);
      });
      if (match === undefined) throw new Error('MISSING_SOURCE');
      const artifactId = match.name.slice(0, 36);
      if (!uuid.test(artifactId)) throw new Error('INVALID_SOURCE');
      const snapshotPath = join(dir, match.name);
      const bytes = await readSafe(dir, snapshotPath, 20 * 1024 * 1024);
      if (createHash('sha256').update(bytes).digest('hex') !== reference.sourceArtifactSha256)
        throw new Error('SOURCE_HASH_MISMATCH');
      const recorded = evidence?.snapshots.find(
        (snapshot) =>
          snapshot.sourceArtifactId === artifactId &&
          snapshot.sourceArtifactSha256 === reference.sourceArtifactSha256,
      );
      if (
        evidence !== null &&
        (recorded?.sourceRole !== reference.sourceRole ||
          recorded.sourceVariant !== reference.sourceVariant)
      )
        throw new Error('INVALID_SOURCE_EVIDENCE');
      artifacts.push({
        sourceArtifactId: artifactId,
        snapshotPath,
        finalUrl:
          recorded?.finalUrl ??
          reference.sourceUrl ??
          (index === 0 ? baseAst.fonte : (baseAst.fontesSecundarias?.[index - 1] ?? baseAst.fonte)),
        sourceRole: reference.sourceRole,
        sourceVariant: reference.sourceVariant,
        sourceArtifactSha256: reference.sourceArtifactSha256,
      });
      if (reference.sourceRole === 'primary_current') byteLength = bytes.length;
    }
    const primary = artifacts.find((artifact) => artifact.sourceRole === 'primary_current');
    if (primary === undefined) throw new Error('MISSING_PRIMARY_SOURCE');
    const summary: SourceSummaryDto = savedSummary ?? {
      sourceId: entry.name,
      sourceKind: primary.snapshotPath.endsWith('.md') ? 'local_markdown' : 'local_html',
      displayName: baseAst.sigla,
      mediaType: primary.snapshotPath.endsWith('.md') ? 'text/markdown' : 'text/html',
      byteLength,
      sourceArtifactSha256: primary.sourceArtifactSha256,
    };
    if (
      summary.sourceArtifactSha256 !== primary.sourceArtifactSha256 ||
      summary.byteLength !== byteLength ||
      summary.mediaType !== (primary.snapshotPath.endsWith('.md') ? 'text/markdown' : 'text/html')
    )
      throw new Error('INVALID_SOURCE_SUMMARY');
    candidates.push({
      projectId,
      summary,
      primary,
      artifacts,
      configurationEvidence: evidence?.configuration ?? null,
    });
  }
  const candidate = candidates[0];
  if (candidate === undefined) throw new Error('SOURCE_UNAVAILABLE');
  // Dados legados não ligavam sourceId ao projeto. Hashes idênticos permitem
  // recuperar os mesmos bytes; configurações divergentes exigem diagnóstico.
  if (
    candidates.some(
      (value) =>
        JSON.stringify(value.configurationEvidence) !==
        JSON.stringify(candidate.configurationEvidence),
    )
  )
    throw new Error('AMBIGUOUS_SOURCE_EVIDENCE');
  return candidate;
};
