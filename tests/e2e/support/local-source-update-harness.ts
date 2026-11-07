import { readFile } from 'node:fs/promises';
import type { ActiveSourceImportConfiguration } from '@lex-editor/source-ingestion';
import { createSourceCatalogE2eHarness as createBaseHarness } from './source-catalog-harness.js';
const compiledUrl = 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm';
const configuration: ActiveSourceImportConfiguration = {
  providerRevision: {
    schemaVersion: 1,
    providerRevisionId: '11111111-1111-4111-8111-111111111111',
    providerId: '22222222-2222-4222-8222-222222222222',
    revisionNumber: 3,
    providerKey: 'planalto-oficial',
    providerName: 'Portal da Legislação do Planalto',
    sourceType: 'planalto_html',
    adapterId: 'planalto.html',
    adapterContractVersion: 1,
    origin: {
      scheme: 'https',
      host: 'www.planalto.gov.br',
      port: null,
      pathPrefix: '/ccivil_03/',
    },
    detectionParameters: { requireLegalHeader: true },
    configDigest: 'a'.repeat(64),
    createdByUserId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-08-13T15:00:00.000Z',
  },
  bindingRevision: {
    schemaVersion: 1,
    bindingRevisionId: '44444444-4444-4444-8444-444444444444',
    bindingId: '55555555-5555-4555-8555-555555555555',
    lawId: '66666666-6666-4666-8666-666666666666',
    providerRevisionId: '11111111-1111-4111-8111-111111111111',
    revisionNumber: 4,
    artifacts: [
      {
        order: 0,
        sourceRole: 'primary_current',
        sourceVariant: 'compiled',
        sourceUrl: compiledUrl,
      },
    ],
    monitoringIntervalMs: 86_400_000,
    configDigest: 'b'.repeat(64),
    createdByUserId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-08-13T15:01:00.000Z',
  },
};
export const createSourceCatalogE2eHarness = async (options: { storageRoot: string }) => {
  const base = await createBaseHarness(options);
  return {
    ...base,
    activeSourceImportResolver: { resolve: () => Promise.resolve(configuration) },
    networkPorts: {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 as const }]),
      request: async () => {
        const path = process.env['LEX_SOURCE_UPDATE_TEST_HTML'];
        if (path === undefined) throw new Error('Missing fixture');
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=windows-1252' },
          body: await readFile(path),
        };
      },
    },
  };
};
