import { pathToFileURL } from 'node:url';

import type { PlanaltoNetworkPorts } from '@lex-editor/source-ingestion/node';

import type { SourceCatalogService } from '../../services/source-catalog/src/index.js';
import type { ActiveSourceImportResolver } from './local-project-service.js';

export type SourceCatalogE2eHarness = Readonly<{
  service: SourceCatalogService;
  getAccessToken(): string | null | Promise<string | null>;
  activeSourceImportResolver: ActiveSourceImportResolver;
  networkPorts: PlanaltoNetworkPorts;
}>;

type SourceCatalogE2eHarnessModule = Readonly<{
  createSourceCatalogE2eHarness(options: {
    storageRoot: string;
  }): SourceCatalogE2eHarness | Promise<SourceCatalogE2eHarness>;
}>;

const isHarness = (value: unknown): value is SourceCatalogE2eHarness => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SourceCatalogE2eHarness>;
  return (
    typeof candidate.service === 'object' &&
    typeof candidate.getAccessToken === 'function' &&
    typeof candidate.activeSourceImportResolver?.resolve === 'function' &&
    typeof candidate.networkPorts?.resolveHost === 'function' &&
    typeof candidate.networkPorts.request === 'function'
  );
};

/**
 * Carrega infraestrutura administrativa somente no smoke/E2E do bundle local.
 * O módulo não é importado estaticamente, portanto não entra no artefato de
 * produção; `app.isPackaged` é uma segunda trava contra ativação por ambiente.
 */
export const loadSourceCatalogE2eHarness = async (options: {
  isPackaged: boolean;
  storageRoot: string;
  environment: NodeJS.ProcessEnv;
}): Promise<SourceCatalogE2eHarness | null> => {
  if (options.isPackaged || options.environment['LEX_EDITOR_E2E_SOURCE_CATALOG'] !== '1') {
    return null;
  }

  const modulePath = options.environment['LEX_EDITOR_E2E_SOURCE_CATALOG_MODULE'];
  if (modulePath === undefined || modulePath.trim().length === 0) {
    throw new Error('SOURCE_CATALOG_E2E_MODULE_REQUIRED');
  }

  const imported: unknown = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  const module = imported as Partial<SourceCatalogE2eHarnessModule>;
  if (typeof module.createSourceCatalogE2eHarness !== 'function') {
    throw new Error('SOURCE_CATALOG_E2E_MODULE_INVALID');
  }

  const harness = await module.createSourceCatalogE2eHarness({ storageRoot: options.storageRoot });
  if (!isHarness(harness)) throw new Error('SOURCE_CATALOG_E2E_HARNESS_INVALID');
  return harness;
};
