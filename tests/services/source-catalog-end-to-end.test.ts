import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { identifiedMinima } from '@lex-editor/legal-domain';
import type { CapturedSourceCheckJob } from '@lex-editor/source-ingestion';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createConfiguredLegislativeSourceCollector,
  type ConfiguredSourceSetParser,
} from '../../services/update-worker/src/index.js';
import { createLocalProjectService } from '../../src/main/local-project-service.js';
import { createDesktopSourceCatalogIpcCapabilities } from '../../src/main/source-catalog-ipc-capabilities.js';
import { createSourceCatalogE2eHarness } from '../e2e/support/source-catalog-harness.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('catálogo → importador → worker', () => {
  it('preserva a mesma revisão, adaptador, funções e variantes no corte completo offline', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'lex-source-catalog-e2e-'));
    roots.push(storageRoot);
    const harness = await createSourceCatalogE2eHarness({ storageRoot });
    const desktop = createDesktopSourceCatalogIpcCapabilities({
      service: harness.service,
      getAccessToken: harness.getAccessToken,
    });
    const sourceUrl = 'https://planalto.gov.br/ccivil_03/leis/l9099.htm';
    const provider = await desktop.createProviderRevision.handle({
      providerKey: 'planalto-e2e',
      expectedLockVersion: 0,
      providerName: 'Origem Planalto sem www',
      sourceType: 'planalto_html',
      adapterId: 'planalto.html',
      adapterContractVersion: 1,
      origin: {
        scheme: 'https',
        host: 'planalto.gov.br',
        port: null,
        pathPrefix: '/ccivil_03/leis/',
      },
      detectionParameters: { requireLegalHeader: true },
    });
    const binding = await desktop.createBindingRevision.handle({
      lawId: '99999999-9999-4999-8999-999999999999',
      providerRevisionId: provider.providerRevisionId,
      expectedLockVersion: 0,
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current',
          sourceVariant: 'annotated',
          sourceUrl,
        },
      ],
      monitoringIntervalMs: 86_400_000,
    });
    const tested = await desktop.dryRunBinding.handle({
      providerRevisionId: provider.providerRevisionId,
      bindingRevisionId: binding.bindingRevisionId,
    });
    expect(tested.sourceTestOutcome).toBe('success');
    await desktop.activateBinding.handle({
      providerId: provider.providerId,
      providerRevisionId: provider.providerRevisionId,
      expectedProviderLockVersion: provider.providerLockVersion,
      bindingId: binding.bindingId,
      bindingRevisionId: binding.bindingRevisionId,
      expectedBindingLockVersion: binding.bindingLockVersion,
      testEvidenceId: tested.testEvidenceId,
    });

    const activeConfiguration = await harness.activeSourceImportResolver.resolve(sourceUrl);
    expect(activeConfiguration).not.toBeNull();
    if (activeConfiguration === null) throw new Error('ACTIVE_CONFIGURATION_REQUIRED');

    const importer = createLocalProjectService({
      storageRoot,
      dialog: {
        showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
        showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
      },
      getMainWindow: () => ({}) as BrowserWindow,
      sendProgress: vi.fn(),
      networkPorts: harness.networkPorts,
      activeSourceImportResolver: harness.activeSourceImportResolver,
    });
    const imported = await importer.importFromUrl.handle({ url: sourceUrl });
    const evidence = JSON.parse(
      await readFile(
        join(storageRoot, 'sources', imported.sourceId, 'import-evidence.json'),
        'utf8',
      ),
    ) as {
      configuration: Record<string, unknown>;
      snapshots: readonly Record<string, unknown>[];
    };
    expect(evidence.configuration).toMatchObject({
      providerRevisionId: provider.providerRevisionId,
      bindingRevisionId: binding.bindingRevisionId,
      adapterId: 'planalto.html',
      adapterContractVersion: 1,
    });
    expect(evidence.snapshots).toMatchObject([
      { sourceRole: 'primary_current', sourceVariant: 'annotated', finalUrl: sourceUrl },
    ]);

    const now = '2026-08-14T12:00:00.000Z';
    const capturedJob: CapturedSourceCheckJob = {
      schemaVersion: 1,
      sourceCheckJobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      bindingId: binding.bindingId,
      bindingRevisionId: binding.bindingRevisionId,
      providerRevisionId: provider.providerRevisionId,
      lawId: activeConfiguration.bindingRevision.lawId,
      baseVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sourceCheckTrigger: 'manual',
      sourceCheckJobState: 'running',
      idempotencyKey: 'e2e-configured-source',
      requestedAt: now,
      claimedAt: now,
      providerRevision: activeConfiguration.providerRevision,
      bindingRevision: activeConfiguration.bindingRevision,
      health: {
        schemaVersion: 1,
        bindingId: binding.bindingId,
        bindingRevisionId: binding.bindingRevisionId,
        sourceHealthState: 'unknown',
        nextCheckAt: now,
        consecutiveFailures: 0,
        nextRetryAt: null,
        suspendedUntil: null,
        lastErrorCode: null,
        lastCheckedAt: null,
        updatedAt: now,
      },
    };
    const parse = vi.fn<ConfiguredSourceSetParser['parse']>(() =>
      Promise.resolve({
        candidateAst: identifiedMinima,
        candidateArtifactId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    );
    const collected = await createConfiguredLegislativeSourceCollector({
      capturedJob,
      parser: { parse },
      networkPorts: harness.networkPorts,
    }).collect({
      lawId: capturedJob.lawId,
      lawSigla: identifiedMinima.sigla,
      lawTitle: identifiedMinima.titulo,
      sourceConfiguration: activeConfiguration,
      baseVersionId: capturedJob.baseVersionId,
      baseNormativeSha256: 'd'.repeat(64),
      publishedAst: identifiedMinima,
      schedule: {
        lawId: capturedJob.lawId,
        intervalMs: activeConfiguration.bindingRevision.monitoringIntervalMs,
        nextCheckAt: now,
        consecutiveFailures: 0,
        nextRetryAt: null,
        suspendedUntil: null,
      },
    });

    const parsedInput = parse.mock.calls[0]?.[0];
    expect(parsedInput?.job.providerRevisionId).toBe(provider.providerRevisionId);
    expect(parsedInput?.job.bindingRevisionId).toBe(binding.bindingRevisionId);
    expect(parsedInput?.sourceSet.providerRevisionId).toBe(provider.providerRevisionId);
    expect(parsedInput?.sourceSet.bindingRevisionId).toBe(binding.bindingRevisionId);
    expect(collected.snapshots.map(({ referencia }) => referencia)).toMatchObject([
      { sourceRole: 'primary_current', sourceVariant: 'annotated', sourceUrl },
    ]);
  });
});
