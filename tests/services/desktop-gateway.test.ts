import { createHash } from 'node:crypto';
import {
  calculateNormativeHash,
  deriveStructuredChanges,
  identifiedMinima,
} from '@lex-editor/legal-domain';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopGateway } from '../../services/desktop-gateway/src/service.js';
import { assertPreparedLegislativeCandidate } from '../../services/desktop-gateway/src/candidate-approval.js';
import { legislativeCandidateArtifactSchema } from '../../services/update-worker/src/candidate-artifacts.js';
import {
  serializeCanonicalJson,
  serializePublicationManifest,
} from '../../src/shared/publication/manifest.js';

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const sql = () => ({ query: vi.fn().mockResolvedValue([]) });

const fixture = (
  profile = { user_id: USER_ID, account_status: 'active', papel: 'administrador' },
) => {
  const identity = sql();
  identity.query.mockResolvedValue([profile]);
  const roles = {
    identity,
    catalog: sql(),
    importer: sql(),
    updateEditor: sql(),
    auditReader: sql(),
    publicationReader: sql(),
  };
  const authenticate = vi.fn().mockResolvedValue({ userId: USER_ID });
  return {
    roles,
    authenticate,
    gateway: createDesktopGateway({ sql: roles, authenticator: { authenticate } }),
  };
};
const request = (
  path: string,
  body: unknown = {},
  token: string | null = 'individual-access-token',
) =>
  new Request(`https://gateway.example.test${path}`, {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const candidateFixture = () => {
  const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
  const content = 'Snapshot oficial preservado.';
  const digest = sha256(content);
  const ast = structuredClone(identifiedMinima);
  const sourceRefs = (node: Record<string, unknown>) => {
    node['sourceRef'] = {
      ...(node['sourceRef'] as Record<string, unknown>),
      sourceArtifactSha256: digest,
    };
    if (Array.isArray(node['children']))
      node['children'].forEach((child) => {
        sourceRefs(child as Record<string, unknown>);
      });
  };
  sourceRefs(ast as unknown as Record<string, unknown>);
  const lawId = 'bbbbbbbb-0000-4000-8000-000000000001';
  const baseVersionId = 'cccccccc-0000-4000-8000-000000000001';
  const candidate = legislativeCandidateArtifactSchema.parse({
    schemaVersion: 1,
    candidateArtifactId: 'dddddddd-0000-4000-8000-000000000001',
    lawId,
    baseVersionId,
    baseNormativeSha256: 'a'.repeat(64),
    candidateNormativeSha256: calculateNormativeHash(ast, sha256),
    ast,
    snapshots: [{ sha256: digest, conteudo: content, referencia: ast.sourceRef }],
  });
  const prepared = structuredClone(ast);
  prepared.versaoVinculex = '1.1.0';
  prepared.publicationStatus = 'approved';
  const publicationId = 'eeeeeeee-0000-4000-8000-000000000001';
  const canonical = serializeCanonicalJson(prepared);
  const manifest = {
    schemaVersion: 1 as const,
    publicationId,
    idempotencyKey: 'ffffffff-0000-4000-8000-000000000001',
    law: { lawId, directoryName: 'lei-testada' },
    target: {
      version: '1.1.0',
      publicationNumber: 2,
      kind: 'legislative_update' as const,
      impact: 'normative_projection' as const,
      restoredVersionId: null,
    },
    expectedBase: { gitCommitSha: 'a'.repeat(40), publishedVersionId: baseVersionId },
    artifacts: {
      markdownSha256: 'b'.repeat(64),
      updateMarkdownSha256: 'c'.repeat(64),
      identifiedAstSha256: sha256(canonical),
    },
    sourceSnapshots: [
      {
        sourceType: ast.sourceRef.sourceType,
        sourceRole: ast.sourceRef.sourceRole,
        sourceVariant: ast.sourceRef.sourceVariant,
        sourceArtifactSha256: digest,
        capturedAt: '2026-10-08T10:00:00.000Z',
      },
    ],
    approvedBy: { userId: USER_ID, role: 'editor_juridico' as const },
    changelog: {
      publicationDate: '2026-10-08',
      version: '1.1.0',
      publicationNumber: 2,
      kind: 'legislative_update' as const,
      sourceSummary: 'Alteração verificada na fonte oficial.',
      changingLaw: 'Lei nº 1/2026',
      changes: deriveStructuredChanges(null, prepared),
    },
    preparedAt: '2026-10-08T10:00:00.000Z',
  };
  return {
    candidate,
    prepared,
    manifest,
    publicationId,
    identifiedAstCanonical: canonical,
    manifestCanonical: serializePublicationManifest(manifest),
    sha256,
  };
};

describe('desktop hosted gateway', () => {
  it('derives the active session role from server profile without exposing tokens', async () => {
    const { gateway } = fixture();
    const response = await gateway.fetch(request('/session/identity'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { userId: USER_ID, role: 'administrador_tecnico' },
    });
  });
  it('rejects absent authentication and hostile actor injection before SQL effects', async () => {
    const { gateway, roles } = fixture();
    expect((await gateway.fetch(request('/updates/reject', {}, null))).status).toBe(401);
    expect(
      (await gateway.fetch(request('/session/identity', { actorUserId: USER_ID }))).status,
    ).toBe(422);
    expect(roles.updateEditor.query).not.toHaveBeenCalled();
  });
  it('does not give an administrator editorial publication authority', async () => {
    const { gateway, roles } = fixture();
    const response = await gateway.fetch(
      request('/publication/context', {
        tipoNorma: 'lei ordinária',
        numero: '1',
        ano: 2026,
        sigla: 'LEI1',
      }),
    );
    expect(response.status).toBe(403);
    expect(roles.publicationReader.query).not.toHaveBeenCalled();
  });
  it('rejects suspended profiles and redacts infrastructure failures', async () => {
    const suspended = fixture({
      user_id: USER_ID,
      account_status: 'suspended',
      papel: 'administrador',
    });
    expect((await suspended.gateway.fetch(request('/session/identity'))).status).toBe(403);
    const { gateway, roles } = fixture();
    roles.identity.query.mockRejectedValue(new Error('postgres://secret@host/private/path'));
    const response = await gateway.fetch(request('/session/identity'));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"gateway_unavailable"}');
  });
  it('accepts only named routes and bounded payloads', async () => {
    const { gateway } = fixture();
    expect((await gateway.fetch(request('/sql', { text: 'select secret' }))).status).toBe(404);
    expect(
      (await gateway.fetch(request('/session/identity', { oversized: 'x'.repeat(65_537) }))).status,
    ).toBe(413);
  });
  it('uses the importer role to resolve a source without granting catalog administration', async () => {
    const { gateway, roles } = fixture({
      user_id: USER_ID,
      account_status: 'active',
      papel: 'curador',
    });
    roles.importer.query.mockResolvedValue([{ value: null }]);
    const response = await gateway.fetch(
      request('/sources/resolveActive', { sourceUrl: 'https://www.planalto.gov.br/lei.htm' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: null });
    expect(roles.importer.query).toHaveBeenCalledWith(
      'select private.resolve_active_source_import($1::text) as value',
      ['https://www.planalto.gov.br/lei.htm'],
    );
    expect(
      (await gateway.fetch(request('/sources/list', { cursor: null, limit: 10 }))).status,
    ).toBe(403);
    expect(roles.catalog.query).not.toHaveBeenCalled();
  });
  it('binds rejection to authenticated user and the editorial SQL role', async () => {
    const { gateway, roles } = fixture({
      user_id: USER_ID,
      account_status: 'active',
      papel: 'curador',
    });
    const updateId = 'bbbbbbbb-0000-4000-8000-000000000001';
    roles.updateEditor.query.mockResolvedValue([
      {
        value: {
          updateId,
          updateReviewStatus: 'rejected',
          publicationId: null,
          retryCount: 0,
          reprocessRequested: false,
        },
      },
    ]);
    const response = await gateway.fetch(
      request('/updates/reject', { updateId, reason: 'Texto necessita revisão.' }),
    );
    expect(response.status).toBe(200);
    expect(roles.updateEditor.query).toHaveBeenCalledWith(
      expect.stringContaining('private.decide_legislative_update'),
      [updateId, USER_ID, 'rejected', 'Texto necessita revisão.', null],
    );
    expect(roles.catalog.query).not.toHaveBeenCalled();
    expect(roles.auditReader.query).not.toHaveBeenCalled();
  });
  it('reports an unregistered law without inventing publication context', async () => {
    const { gateway, roles } = fixture({
      user_id: USER_ID,
      account_status: 'active',
      papel: 'curador',
    });
    roles.publicationReader.query.mockResolvedValue([{ value: null }]);
    const response = await gateway.fetch(
      request('/publication/context', {
        tipoNorma: 'lei ordinária',
        numero: '1',
        ano: 2026,
        sigla: 'LEI1',
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'law_not_registered' });
    expect(roles.publicationReader.query).toHaveBeenCalledWith(
      expect.stringContaining('private.get_desktop_publication_context'),
      [USER_ID, 'lei ordinária', '1', 2026, 'LEI1'],
    );
  });
  it('inspects history using canonical legal identity without inventing a sigla', async () => {
    const { gateway, roles } = fixture({
      user_id: USER_ID,
      account_status: 'active',
      papel: 'curador',
    });
    roles.publicationReader.query.mockResolvedValue([
      {
        value: {
          availability: 'available',
          authorityRevision: 'law:current:1',
          publishedVersionIds: ['bbbbbbbb-0000-4000-8000-000000000001'],
        },
      },
    ]);
    const response = await gateway.fetch(
      request('/publication/historyEvidence', {
        tipoNorma: 'lei ordinária',
        numero: '1',
        ano: 2026,
      }),
    );
    expect(response.status).toBe(200);
    expect(roles.publicationReader.query).toHaveBeenCalledWith(
      expect.stringContaining('private.inspect_desktop_publication_history'),
      [USER_ID, 'lei ordinária', '1', 2026, null],
    );
  });
  it('reprocesses with a separate idempotent request identity', async () => {
    const { gateway, roles } = fixture();
    const updateId = 'bbbbbbbb-0000-4000-8000-000000000001';
    const requestId = 'cccccccc-0000-4000-8000-000000000001';
    roles.updateEditor.query.mockResolvedValue([
      {
        value: {
          updateId,
          updateReviewStatus: 'error',
          publicationId: null,
          retryCount: 1,
          reprocessRequested: true,
        },
      },
    ]);
    const response = await gateway.fetch(request('/updates/reprocess', { updateId, requestId }));
    expect(response.status).toBe(200);
    expect(roles.updateEditor.query).toHaveBeenCalledWith(expect.stringContaining('$3::uuid'), [
      updateId,
      USER_ID,
      requestId,
    ]);
  });
  it('binds candidate approval to the server artifact and exact locally prepared bytes', async () => {
    const fixtureData = candidateFixture();
    const { gateway, roles } = fixture({
      user_id: USER_ID,
      account_status: 'active',
      papel: 'curador',
    });
    const updateId = 'aaaaaaaa-1111-4111-8111-111111111111';
    roles.updateEditor.query
      .mockResolvedValueOnce([{ value: fixtureData.candidate }])
      .mockResolvedValueOnce([
        {
          value: {
            updateId,
            updateReviewStatus: 'approved',
            publicationId: fixtureData.publicationId,
            retryCount: 0,
            reprocessRequested: false,
          },
        },
      ]);
    const response = await gateway.fetch(
      request('/updates/approve', {
        updateId,
        publicationId: fixtureData.publicationId,
        manifestCanonical: fixtureData.manifestCanonical,
        identifiedAstCanonical: fixtureData.identifiedAstCanonical,
      }),
    );
    expect(response.status).toBe(200);
    expect(roles.updateEditor.query).toHaveBeenLastCalledWith(
      expect.stringContaining('private.approve_legislative_update_candidate'),
      [
        updateId,
        USER_ID,
        fixtureData.publicationId,
        fixtureData.candidate.candidateArtifactId,
        fixtureData.manifestCanonical,
      ],
    );
  });
  it('rejects legal or Block ID tampering even when the attacker recomputes artifact hashes', () => {
    const data = candidateFixture();
    const child = data.prepared.children[0];
    if (child === undefined || !('blockId' in child) || typeof child.blockId !== 'string')
      throw new Error('Fixture lacks legal device.');
    child.blockId = `${child.blockId}-forged`;
    const canonical = serializeCanonicalJson(data.prepared);
    const manifest = serializePublicationManifest({
      ...data.manifest,
      artifacts: { ...data.manifest.artifacts, identifiedAstSha256: data.sha256(canonical) },
    });
    expect(() => {
      assertPreparedLegislativeCandidate({
        candidate: data.candidate,
        userId: USER_ID,
        publicationId: data.publicationId,
        identifiedAstCanonical: canonical,
        manifestCanonical: manifest,
      });
    }).toThrow();
  });
  it('rejects a prepared candidate approved by another individual or source snapshot', () => {
    const data = candidateFixture();
    expect(() => {
      assertPreparedLegislativeCandidate({
        ...data,
        userId: 'aaaaaaaa-2222-4222-8222-222222222222',
      });
    }).toThrow();
    const changed = serializePublicationManifest({
      ...data.manifest,
      sourceSnapshots: [
        { ...data.manifest.sourceSnapshots[0], sourceArtifactSha256: 'd'.repeat(64) },
      ],
    });
    expect(() => {
      assertPreparedLegislativeCandidate({ ...data, userId: USER_ID, manifestCanonical: changed });
    }).toThrow();
  });
});
