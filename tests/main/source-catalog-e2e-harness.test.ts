import { describe, expect, it } from 'vitest';

import { loadSourceCatalogE2eHarness } from '../../src/main/source-catalog-e2e-harness.js';

describe('source catalog E2E harness gate', () => {
  it('jamais carrega o módulo externo em aplicativo empacotado', async () => {
    await expect(
      loadSourceCatalogE2eHarness({
        isPackaged: true,
        storageRoot: '/not-used',
        environment: {
          LEX_EDITOR_E2E_SOURCE_CATALOG: '1',
          LEX_EDITOR_E2E_SOURCE_CATALOG_MODULE: '/module-that-must-not-load.mjs',
        },
      }),
    ).resolves.toBeNull();
  });

  it('permanece desativado sem opt-in explícito e falha fechado sem módulo', async () => {
    await expect(
      loadSourceCatalogE2eHarness({
        isPackaged: false,
        storageRoot: '/not-used',
        environment: {},
      }),
    ).resolves.toBeNull();
    await expect(
      loadSourceCatalogE2eHarness({
        isPackaged: false,
        storageRoot: '/not-used',
        environment: { LEX_EDITOR_E2E_SOURCE_CATALOG: '1' },
      }),
    ).rejects.toThrow('SOURCE_CATALOG_E2E_MODULE_REQUIRED');
  });
});
