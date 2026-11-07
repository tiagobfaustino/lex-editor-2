import {
  createPublisherAuditProvider,
  createSourceCatalogAuditProvider,
  createUpdateWorkerAuditProvider,
} from '../../../src/main/audit/remote-audit-provider.js';
import { createSourceCatalogE2eHarness as createSourceHarness } from './source-catalog-harness.js';
import {
  createDisposableAuditSql,
  PUBLICATION_AUDIT_ADMIN_ID,
} from './publication-audit-database.js';

export const createSourceCatalogE2eHarness = async (options: { storageRoot: string }) => {
  const source = await createSourceHarness(options);
  const containerName = process.env['LEX_EDITOR_E2E_PUBLICATION_CONTAINER'];
  if (containerName === undefined || !/^lex-publication-audit-[a-f0-9]{8}$/u.test(containerName))
    throw new Error('Invalid disposable audit fixture.');
  const sql = createDisposableAuditSql(containerName, 'publication_audit_ui_reader');
  const providerOptions = { sql, getActorUserId: () => PUBLICATION_AUDIT_ADMIN_ID };
  return {
    ...source,
    auditProviders: [
      createPublisherAuditProvider(providerOptions),
      createUpdateWorkerAuditProvider(providerOptions),
      createSourceCatalogAuditProvider(providerOptions),
    ],
  };
};
