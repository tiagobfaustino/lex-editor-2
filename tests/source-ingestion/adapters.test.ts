import { describe, expect, it } from 'vitest';

import {
  createSourceAdapterRegistry,
  installedSourceAdapterRegistry,
  planaltoAdapterDescriptor,
  type LawSourceBindingRevision,
  type ProviderRevision,
} from '@lex-editor/source-ingestion';

const PROVIDER_REVISION_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const BINDING_REVISION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const LAW_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'a'.repeat(64);

const provider = (overrides: Partial<ProviderRevision> = {}): ProviderRevision => ({
  schemaVersion: 1,
  providerRevisionId: PROVIDER_REVISION_ID,
  providerId: PROVIDER_ID,
  revisionNumber: 1,
  providerKey: 'planalto-oficial',
  providerName: 'Portal da Legislação do Planalto',
  sourceType: 'planalto_html',
  adapterId: 'planalto.html',
  adapterContractVersion: 1,
  origin: { scheme: 'https', host: 'www.planalto.gov.br', port: null, pathPrefix: '/ccivil_03/' },
  detectionParameters: { requireLegalHeader: true },
  configDigest: DIGEST,
  createdByUserId: USER_ID,
  createdAt: '2026-08-13T15:00:00.000Z',
  ...overrides,
});

const binding = (
  sourceUrl = 'https://www.planalto.gov.br/ccivil_03/leis/l9099.htm',
): LawSourceBindingRevision => ({
  schemaVersion: 1,
  bindingRevisionId: BINDING_REVISION_ID,
  bindingId: BINDING_ID,
  lawId: LAW_ID,
  providerRevisionId: PROVIDER_REVISION_ID,
  revisionNumber: 1,
  artifacts: [{ order: 0, sourceRole: 'primary_current', sourceVariant: 'annotated', sourceUrl }],
  monitoringIntervalMs: 86_400_000,
  configDigest: DIGEST,
  createdByUserId: USER_ID,
  createdAt: '2026-08-13T15:00:00.000Z',
});

describe('registro instalado de adaptadores', () => {
  it('resolve somente o par exato de id e versão', () => {
    expect(installedSourceAdapterRegistry.get('planalto.html', 1)).toBe(planaltoAdapterDescriptor);
    expect(() => installedSourceAdapterRegistry.get('planalto.html', 2)).toThrow(
      'ADAPTER_VERSION_UNSUPPORTED',
    );
    expect(() => installedSourceAdapterRegistry.get('custom.javascript', 1)).toThrow(
      'ADAPTER_NOT_INSTALLED',
    );
    expect(() =>
      createSourceAdapterRegistry([planaltoAdapterDescriptor, planaltoAdapterDescriptor]),
    ).toThrow('DUPLICATE_SOURCE_ADAPTER');
  });

  it.each([
    { requireLegalHeader: true, selector: 'body' },
    { requireLegalHeader: true, regex: 'Art\\. \\d+' },
    { requireLegalHeader: true, template: '${url}' },
    { requireLegalHeader: true, script: 'fetch("https://evil.invalid")' },
  ])('rejeita vocabulário declarativo desconhecido: %j', (detectionParameters) => {
    expect(() =>
      installedSourceAdapterRegistry.validateProviderRevision(provider({ detectionParameters })),
    ).toThrow('ADAPTER_PARAMETERS_INVALID');
  });

  it('rejeita origem semelhante e URL fora da origem exata antes da rede', () => {
    expect(() =>
      installedSourceAdapterRegistry.validateProviderRevision(
        provider({
          origin: {
            scheme: 'https',
            host: 'www.planalto.gov.br.evil.invalid',
            port: null,
            pathPrefix: '/',
          },
        }),
      ),
    ).toThrow('ADAPTER_ORIGIN_NOT_ALLOWED');
    expect(() =>
      installedSourceAdapterRegistry.validateBindingRevision(
        provider(),
        binding('https://www.planalto.gov.br/leis/fora-do-prefixo.htm'),
      ),
    ).toThrow('ADAPTER_ARTIFACT_NOT_ALLOWED');
    expect(() =>
      installedSourceAdapterRegistry.validateBindingRevision(
        provider(),
        binding('https://user:secret@www.planalto.gov.br/ccivil_03/leis/l9099.htm'),
      ),
    ).toThrow('ADAPTER_ARTIFACT_NOT_ALLOWED');
  });

  it('rejeita host IDNA semelhante e porta não declarada pelo adaptador', () => {
    expect(() =>
      installedSourceAdapterRegistry.validateProviderRevision(
        provider({
          origin: {
            scheme: 'https',
            host: 'xn--planalt-6za.gov.br',
            port: null,
            pathPrefix: '/',
          },
        }),
      ),
    ).toThrow('ADAPTER_ORIGIN_NOT_ALLOWED');
    expect(() =>
      installedSourceAdapterRegistry.validateProviderRevision(
        provider({ origin: { ...provider().origin, port: 8_443 } }),
      ),
    ).toThrow('ADAPTER_ORIGIN_NOT_ALLOWED');
    expect(() =>
      installedSourceAdapterRegistry.validateBindingRevision(
        provider(),
        binding('https://www.planalto.gov.br:8443/ccivil_03/leis/l9099.htm'),
      ),
    ).toThrow('ADAPTER_ARTIFACT_NOT_ALLOWED');
  });
});
