import { describe, expect, it, vi } from 'vitest';

import {
  createPublicationDesktopCapabilities,
  type PublicationDesktopOperations,
  type PublicationProjectRevision,
} from '../../src/main/publication/desktop-service.js';
import type {
  PublicationAttemptDto,
  PublicationChangeSummaryDto,
  PublicationConfirmationDto,
  PublicationDiffDto,
} from '../../src/shared/ipc/publication.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PUBLICATION_ID = '22222222-2222-4222-8222-222222222222';
const LAW_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_HASH = 'c'.repeat(64);

const changes: PublicationChangeSummaryDto = {
  included: 0,
  amended: 1,
  revoked: 0,
  renumbered: 0,
  items: [
    {
      changeKind: 'amended' as const,
      blockId: 'ldem-art-1',
      destinationBlockId: null,
      description: 'Art. 1 alterado.',
    },
  ],
  truncated: false,
};

const confirmation: PublicationConfirmationDto = {
  publicationId: PUBLICATION_ID,
  projectId: PROJECT_ID,
  revisionHash: REVISION_HASH,
  lawId: LAW_ID,
  lawTitle: 'Lei de Demonstração',
  sigla: 'ldem',
  version: '1.1.0',
  publicationNumber: 2,
  publicationKind: 'legislative_update' as const,
  publicationImpact: 'normative_projection' as const,
  restoredVersionId: null,
  restoredVersion: null,
  deviceCount: 1,
  artifactKinds: ['markdown', 'update_markdown', 'manifest', 'identified_ast'],
  sourceSummary: 'Alteração legislativa conferida.',
  changes,
  requiresLegalApproval: true,
};

const failedAttempt: PublicationAttemptDto = {
  publicationId: PUBLICATION_ID,
  lawId: LAW_ID,
  version: '1.1.0',
  publicationNumber: 2,
  publicationKind: 'legislative_update' as const,
  publicationAttemptStatus: 'failed' as const,
  resumeFromStatus: 'syncing' as const,
  candidateSha: 'a'.repeat(40),
  manifestDigest: 'b'.repeat(64),
  publishedVersionId: null,
  updatedAt: '2026-08-10T15:00:00.000Z',
  retryable: true,
  message: 'Sincronização pendente e retomável.',
};

const diff: PublicationDiffDto = {
  lawId: LAW_ID,
  fromVersionId: VERSION_ID,
  toVersionId: '55555555-5555-4555-8555-555555555555',
  fromVersion: '1.1.0',
  toVersion: '1.0.0',
  publicationImpact: 'normative_projection',
  requiresLegalApproval: true,
  changes,
};

const rollbackConfirmation: PublicationConfirmationDto = {
  ...confirmation,
  publicationKind: 'rollback',
  restoredVersionId: VERSION_ID,
  restoredVersion: '1.0.0',
};

const operations = (): PublicationDesktopOperations => ({
  canAccessPublication: vi.fn((publicationId: string) =>
    Promise.resolve(publicationId === PUBLICATION_ID),
  ),
  prepare: vi.fn((_input, revision: PublicationProjectRevision) =>
    Promise.resolve({
      ...confirmation,
      revisionHash: revision.revisionHash,
      lawTitle: revision.lawTitle,
      sigla: revision.sigla,
      version: revision.version,
    }),
  ),
  execute: vi.fn(() => Promise.resolve(failedAttempt)),
  getAttempt: vi.fn(() => Promise.resolve(failedAttempt)),
  retry: vi.fn(() => Promise.resolve(failedAttempt)),
  listHistory: vi.fn(() =>
    Promise.resolve({
      items: [],
      nextCursor: null,
      totalItems: 0,
    }),
  ),
  getDiff: vi.fn(() => Promise.resolve(diff)),
  prepareRollback: vi.fn(() => Promise.resolve(rollbackConfirmation)),
});

describe('publication desktop capabilities', () => {
  it('requires an approved project only to prepare a release', async () => {
    const capabilities = createPublicationDesktopCapabilities({
      projects: {
        hasProject: (projectId) => projectId === PROJECT_ID,
        getApprovedRevision: () => null,
      },
      operations: operations(),
    });

    expect(
      await capabilities.preparePublication.authorize({
        projectId: PROJECT_ID,
        sourceSummary: 'Resumo válido.',
      }),
    ).toBe(false);
    expect(
      await capabilities.listPublicationHistory.authorize({
        projectId: PROJECT_ID,
        cursor: null,
        limit: 100,
      }),
    ).toBe(true);
  });

  it('remembers the prepared ID and keeps query/retry on the exact same attempt', async () => {
    const publicationOperations = operations();
    const capabilities = createPublicationDesktopCapabilities({
      projects: {
        hasProject: () => true,
        getApprovedRevision: () => ({
          revisionHash: REVISION_HASH,
          lawTitle: confirmation.lawTitle,
          sigla: confirmation.sigla,
          version: confirmation.version,
        }),
      },
      operations: publicationOperations,
    });

    await capabilities.preparePublication.handle({
      projectId: PROJECT_ID,
      sourceSummary: 'Resumo válido.',
    });
    expect(
      (publicationOperations.prepare as ReturnType<typeof vi.fn>).mock.calls[0]?.[1],
    ).toMatchObject({
      revisionHash: REVISION_HASH,
      lawTitle: confirmation.lawTitle,
      sigla: confirmation.sigla,
    });
    expect(
      await capabilities.getPublicationAttempt.authorize({ publicationId: PUBLICATION_ID }),
    ).toBe(true);
    await expect(
      capabilities.getPublicationAttempt.handle({ publicationId: PUBLICATION_ID }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION_ID,
      publicationAttemptStatus: 'failed',
      publishedVersionId: null,
    });
    await capabilities.retryPublication.handle({ publicationId: PUBLICATION_ID });

    expect((publicationOperations.getAttempt as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      [PUBLICATION_ID],
    ]);
    expect((publicationOperations.retry as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      [PUBLICATION_ID],
    ]);
  });

  it('does not authorize an unrelated publication ID', async () => {
    const capabilities = createPublicationDesktopCapabilities({
      projects: {
        hasProject: () => true,
        getApprovedRevision: () => ({
          revisionHash: REVISION_HASH,
          lawTitle: confirmation.lawTitle,
          sigla: confirmation.sigla,
          version: confirmation.version,
        }),
      },
      operations: operations(),
    });

    await expect(
      capabilities.executePublication.authorize({
        publicationId: '66666666-6666-4666-8666-666666666666',
      }),
    ).resolves.toBe(false);
  });

  it('rejeita candidato cuja revisão ou metadados divergem do projeto aprovado', async () => {
    const publicationOperations = operations();
    publicationOperations.prepare = vi.fn(() =>
      Promise.resolve({ ...confirmation, lawTitle: 'Título vindo de estado paralelo' }),
    );
    const capabilities = createPublicationDesktopCapabilities({
      projects: {
        hasProject: () => true,
        getApprovedRevision: () => ({
          revisionHash: REVISION_HASH,
          lawTitle: confirmation.lawTitle,
          sigla: confirmation.sigla,
          version: confirmation.version,
        }),
      },
      operations: publicationOperations,
    });

    await expect(
      capabilities.preparePublication.handle({
        projectId: PROJECT_ID,
        sourceSummary: 'Resumo válido.',
      }),
    ).rejects.toThrow(/approved revision/iu);
  });
});
