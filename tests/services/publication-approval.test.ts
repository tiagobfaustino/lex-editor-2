import { describe, expect, it } from 'vitest';

import {
  createInMemoryPublicationApprovalRepository,
  createPublicationApprovalAuthority,
  PublicationApprovalError,
  type PublisherIdentity,
} from '../../services/publisher/src/approval.js';

const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const EDITOR_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_EDITOR_ID = '55555555-5555-4555-8555-555555555555';
const APPROVAL_ID = '77777777-7777-4777-8777-777777777777';
const DIGEST = 'a'.repeat(64);

const createIdentityRepository = (identities: PublisherIdentity[]) => ({
  findByUserId(userId: string) {
    return Promise.resolve(identities.find((identity) => identity.userId === userId) ?? null);
  },
});

const editor = (userId = EDITOR_ID): PublisherIdentity => ({
  userId,
  accountStatus: 'active',
  roles: ['editor_juridico'],
});

describe('server-side publication approval', () => {
  it('binds the authenticated active editor, role, publication and exact digest', async () => {
    const approvals = createInMemoryPublicationApprovalRepository();
    const authority = createPublicationApprovalAuthority({
      identities: createIdentityRepository([editor()]),
      approvals,
      generateUuid: () => APPROVAL_ID,
      now: () => new Date('2026-08-10T16:00:00.000Z'),
    });

    const approval = await authority.approve(EDITOR_ID, {
      publicationId: PUBLICATION_ID,
      manifestDigest: DIGEST,
    });

    expect(approval).toEqual({
      schemaVersion: 1,
      approvalId: APPROVAL_ID,
      publicationId: PUBLICATION_ID,
      manifestDigest: DIGEST,
      userId: EDITOR_ID,
      role: 'editor_juridico',
      approvedAt: '2026-08-10T16:00:00.000Z',
    });
    await expect(
      authority.assertApproved({
        publicationId: PUBLICATION_ID,
        manifestDigest: DIGEST,
        approvedByUserId: EDITOR_ID,
      }),
    ).resolves.toEqual(approval);
  });

  it('is idempotent only for the same actor and digest and rejects replay with other bytes', async () => {
    const approvals = createInMemoryPublicationApprovalRepository();
    const authority = createPublicationApprovalAuthority({
      identities: createIdentityRepository([editor(), editor(OTHER_EDITOR_ID)]),
      approvals,
      generateUuid: () => APPROVAL_ID,
      now: () => new Date('2026-08-10T16:00:00.000Z'),
    });
    const request = { publicationId: PUBLICATION_ID, manifestDigest: DIGEST };
    const first = await authority.approve(EDITOR_ID, request);

    await expect(authority.approve(EDITOR_ID, request)).resolves.toEqual(first);
    await expect(
      authority.approve(EDITOR_ID, { ...request, manifestDigest: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'approval_conflict' });
    await expect(authority.approve(OTHER_EDITOR_ID, request)).rejects.toMatchObject({
      code: 'approval_conflict',
    });
  });

  it('checks the current server-side role both when approving and when publishing', async () => {
    const identities = [editor()];
    const authority = createPublicationApprovalAuthority({
      identities: createIdentityRepository(identities),
      approvals: createInMemoryPublicationApprovalRepository(),
      generateUuid: () => APPROVAL_ID,
      now: () => new Date('2026-08-10T16:00:00.000Z'),
    });
    await authority.approve(EDITOR_ID, {
      publicationId: PUBLICATION_ID,
      manifestDigest: DIGEST,
    });
    identities[0] = { ...editor(), roles: [] };

    await expect(
      authority.assertApproved({
        publicationId: PUBLICATION_ID,
        manifestDigest: DIGEST,
        approvedByUserId: EDITOR_ID,
      }),
    ).rejects.toBeInstanceOf(PublicationApprovalError);

    const unauthorized = createPublicationApprovalAuthority({
      identities: createIdentityRepository([
        { ...editor(OTHER_EDITOR_ID), accountStatus: 'suspended' },
      ]),
      approvals: createInMemoryPublicationApprovalRepository(),
    });
    await expect(
      unauthorized.approve(OTHER_EDITOR_ID, {
        publicationId: PUBLICATION_ID,
        manifestDigest: DIGEST,
      }),
    ).rejects.toMatchObject({ code: 'identity_not_authorized' });
  });

  it('does not trust actor, role or extra fields supplied by the request body', async () => {
    const authority = createPublicationApprovalAuthority({
      identities: createIdentityRepository([editor()]),
      approvals: createInMemoryPublicationApprovalRepository(),
    });
    await expect(
      authority.approve(EDITOR_ID, {
        publicationId: PUBLICATION_ID,
        manifestDigest: DIGEST,
        userId: OTHER_EDITOR_ID,
        role: 'admin',
      }),
    ).rejects.toThrow();
  });
});
