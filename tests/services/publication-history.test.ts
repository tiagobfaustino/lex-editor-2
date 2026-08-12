import { identifiedMinima, type IdentifiedNormaAST } from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

import {
  createPublicationHistoryService,
  type PublicationVersionRepository,
  type StoredPublicationVersion,
} from '../../services/publisher/src/history.js';

const LAW_ID = '11111111-1111-4111-8111-111111111111';
const HISTORICAL_ID = '22222222-2222-4222-8222-222222222222';
const CURRENT_ID = '33333333-3333-4333-8333-333333333333';

const versionAst = (version: string, caput: string): IdentifiedNormaAST => {
  const ast = structuredClone(identifiedMinima);
  ast.versaoVinculex = version;
  ast.publicationStatus = 'approved';
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture jurídica inválida.');
  article.caput = caput;
  return ast;
};

const historical: StoredPublicationVersion = {
  versionId: HISTORICAL_ID,
  lawId: LAW_ID,
  version: '1.0.0',
  publicationNumber: 1,
  publicationKind: 'initial',
  restoredVersionId: null,
  gitCommitSha: 'a'.repeat(40),
  publishedAt: '2026-08-08T12:00:00.000Z',
  sourceSummary: 'Primeira publicação conferida.',
  ast: versionAst('1.0.0', 'Texto normativo original.'),
};

const current: StoredPublicationVersion = {
  versionId: CURRENT_ID,
  lawId: LAW_ID,
  version: '1.1.0',
  publicationNumber: 2,
  publicationKind: 'legislative_update',
  restoredVersionId: null,
  gitCommitSha: 'b'.repeat(40),
  publishedAt: '2026-08-09T12:00:00.000Z',
  sourceSummary: 'Alteração legislativa conferida.',
  ast: versionAst('1.1.0', 'Texto normativo alterado.'),
};

const repository = (): PublicationVersionRepository => {
  const versions = [historical, current];
  return {
    listByLawId: (lawId) => Promise.resolve(lawId === LAW_ID ? versions : []),
    getById: (lawId, versionId) =>
      Promise.resolve(
        versions.find((version) => version.lawId === lawId && version.versionId === versionId) ??
          null,
      ),
    getCurrent: (lawId) => Promise.resolve(lawId === LAW_ID ? current : null),
  };
};

describe('publication history and forward rollback', () => {
  it('lists immutable versions newest first and marks only the current version', async () => {
    const service = createPublicationHistoryService({ versions: repository() });

    await expect(service.list(LAW_ID)).resolves.toMatchObject([
      { versionId: CURRENT_ID, publicationNumber: 2, isCurrent: true },
      { versionId: HISTORICAL_ID, publicationNumber: 1, isCurrent: false },
    ]);
  });

  it('derives a Block ID diff and creates rollback as a new version without mutating history', async () => {
    const service = createPublicationHistoryService({
      versions: repository(),
      now: () => new Date('2026-08-10T14:30:00.000Z'),
    });
    const originalHistorical = structuredClone(historical.ast);
    const originalCurrent = structuredClone(current.ast);

    await expect(service.diff(LAW_ID, CURRENT_ID, HISTORICAL_ID)).resolves.toMatchObject({
      fromVersion: '1.1.0',
      toVersion: '1.0.0',
      publicationImpact: 'normative_projection',
      requiresLegalApproval: true,
      changes: {
        amended: [{ blockId: 'ldem-art-1' }],
      },
    });
    const rollback = await service.prepareRollback({
      lawId: LAW_ID,
      restoreVersionId: HISTORICAL_ID,
      justification: 'Restauração necessária após divergência normativa confirmada.',
    });

    expect(rollback).toMatchObject({
      restoredVersionId: HISTORICAL_ID,
      restoredVersion: '1.0.0',
      targetVersion: '1.2.0',
      targetPublicationNumber: 3,
      publicationImpact: 'normative_projection',
      requiresLegalApproval: true,
      ast: {
        versaoVinculex: '1.2.0',
        publicationStatus: 'review',
        dataFormatacaoVinculex: '2026-08-10',
        dataVerificacaoIntegridade: '2026-08-10',
      },
    });
    expect(rollback.ast.children[0]).toMatchObject({ caput: 'Texto normativo original.' });
    expect(historical.ast).toEqual(originalHistorical);
    expect(current.ast).toEqual(originalCurrent);
  });

  it('rejects the current version, short justification and versions from another law', async () => {
    const service = createPublicationHistoryService({ versions: repository() });

    await expect(
      service.prepareRollback({
        lawId: LAW_ID,
        restoreVersionId: CURRENT_ID,
        justification: 'Justificativa juridicamente suficiente.',
      }),
    ).rejects.toMatchObject({ code: 'invalid_rollback' });
    await expect(
      service.prepareRollback({
        lawId: LAW_ID,
        restoreVersionId: HISTORICAL_ID,
        justification: 'curta',
      }),
    ).rejects.toBeDefined();
    await expect(
      service.diff(LAW_ID, CURRENT_ID, '44444444-4444-4444-8444-444444444444'),
    ).rejects.toMatchObject({ code: 'version_not_found' });
  });
});
