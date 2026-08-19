import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { OperationalAuditDetail } from '@lex-editor/operational-audit';

import { DESKTOP_AUDIT_LIMITS } from '../../shared/ipc/audit.js';
import type { LocalAuditJournalStore } from './local-audit-journal.js';

type PipelineDetail = Extract<OperationalAuditDetail, { kind: 'pipeline' }>;
type EvidenceReference = NonNullable<PipelineDetail['evidence']>;

export type EvidenceLocation =
  Readonly<{ found: true; reference: EvidenceReference }> | Readonly<{ found: false }>;

export type EvidenceRead =
  | Readonly<{ ok: true; excerpt: string; excerptSha256: string; endLine: number }>
  | Readonly<{ ok: false }>;

export type EvidenceProvider = Readonly<{
  locate(projectId: string, evidenceLocatorId: string): Promise<EvidenceLocation>;
  read(sourceArtifactSha256: string, startLine: number, endLine: number): Promise<EvidenceRead>;
}>;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const splitLines = (text: string): readonly string[] => text.split(/\r\n|\r|\n/u);

export const createEvidenceProvider = (
  journal: LocalAuditJournalStore,
  storageRoot: string,
): EvidenceProvider => ({
  async locate(projectId, evidenceLocatorId) {
    const { entries } = await journal.read(projectId).catch(() => ({ entries: [] }));
    const found = entries.find(
      ({ event }) =>
        event.detail.kind === 'pipeline' &&
        event.detail.evidence?.evidenceLocatorId === evidenceLocatorId,
    );
    if (found?.event.detail.kind !== 'pipeline') {
      return { found: false };
    }
    const reference = found.event.detail.evidence;
    if (reference === null) return { found: false };
    return { found: true, reference };
  },
  async read(sourceArtifactSha256, startLine, endLine) {
    const sourcesRoot = join(storageRoot, 'sources');
    let matchPath: string | null = null;
    try {
      const sourceDirectories = await readdir(sourcesRoot);
      for (const sourceDirectory of sourceDirectories) {
        const directory = join(sourcesRoot, sourceDirectory);
        const files = await readdir(directory).catch(() => []);
        const match = files.find((file) => file.includes(`-${sourceArtifactSha256}`));
        if (match !== undefined) {
          matchPath = join(directory, match);
          break;
        }
      }
    } catch {
      return { ok: false };
    }
    if (matchPath === null) return { ok: false };
    let bytes: Buffer;
    try {
      bytes = await readFile(matchPath);
    } catch {
      return { ok: false };
    }
    if (sha256(bytes) !== sourceArtifactSha256) return { ok: false };
    const lines = splitLines(bytes.toString('utf8'));
    const cappedEndLine = Math.min(
      endLine,
      lines.length,
      startLine + DESKTOP_AUDIT_LIMITS.maxEvidenceLines - 1,
    );
    const excerpt = lines
      .slice(startLine - 1, Math.max(startLine - 1, cappedEndLine))
      .join('\n')
      .slice(0, DESKTOP_AUDIT_LIMITS.maxEvidenceExcerptChars);
    return {
      ok: true,
      excerpt,
      excerptSha256: sha256(Buffer.from(excerpt, 'utf8')),
      endLine: Math.max(startLine, cappedEndLine),
    };
  },
});
