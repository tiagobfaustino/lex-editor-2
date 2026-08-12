import { describe, expect, it, vi } from 'vitest';

import { createLegislativeUpdateDesktopCapabilities } from '../../src/main/updates/desktop-service.js';
import type { LegislativeUpdateReviewOperations } from '../../src/main/updates/desktop-service.js';

const UPDATE_ID = '10000000-0000-4000-8000-000000000001';
const getCountsMock = vi.fn(() =>
  Promise.resolve({
    pending: 1,
    approved: 0,
    rejected: 0,
    superseded: 0,
    error: 0,
    actionable: 1,
  }),
);
const rejectMock = vi.fn(() =>
  Promise.resolve({
    updateId: UPDATE_ID,
    updateReviewStatus: 'rejected' as const,
    publicationId: null,
    retryCount: 0,
    reprocessRequested: false,
  }),
);

const operations = (): LegislativeUpdateReviewOperations => ({
  list: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  getDetail: vi.fn(() => Promise.reject(new Error('not used'))),
  getCounts: getCountsMock,
  approve: vi.fn(() =>
    Promise.resolve({
      updateId: UPDATE_ID,
      updateReviewStatus: 'approved' as const,
      publicationId: '10000000-0000-4000-8000-000000000002',
      retryCount: 0,
      reprocessRequested: false,
    }),
  ),
  reject: rejectMock,
  reprocess: vi.fn(() =>
    Promise.resolve({
      updateId: UPDATE_ID,
      updateReviewStatus: 'rejected' as const,
      publicationId: null,
      retryCount: 1,
      reprocessRequested: true,
    }),
  ),
});

describe('capacidades desktop da fila legislativa', () => {
  it('delega somente intenções nomeadas ao cliente editorial', async () => {
    const client = operations();
    const capabilities = createLegislativeUpdateDesktopCapabilities({ operations: client });
    await expect(capabilities.getUpdateCounts.handle({})).resolves.toMatchObject({ actionable: 1 });
    await expect(
      capabilities.rejectUpdate.handle({
        updateId: UPDATE_ID,
        reason: 'A fonte auxiliar divergiu da compilada.',
      }),
    ).resolves.toMatchObject({ updateReviewStatus: 'rejected' });
    expect(getCountsMock).toHaveBeenCalledOnce();
    expect(rejectMock).toHaveBeenCalledWith({
      updateId: UPDATE_ID,
      reason: 'A fonte auxiliar divergiu da compilada.',
    });
  });
});
