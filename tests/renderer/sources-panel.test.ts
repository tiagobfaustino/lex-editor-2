import { describe, expect, it } from 'vitest';

import {
  validateSourceDraft,
  type AdapterCapability,
  type SourceDraft,
} from '../../src/renderer/src/features/sources/source-form-validation.js';

const capability: AdapterCapability = {
  adapterId: 'planalto.html',
  contractVersion: 1,
  displayName: 'HTML oficial do Planalto',
  supportedSourceTypes: ['planalto_html'],
  allowedSchemes: ['https'],
  allowedHosts: ['planalto.gov.br', 'www.planalto.gov.br'],
  allowsCustomPort: false,
  maximumArtifacts: 2,
  supportedSourceRoles: ['primary_current', 'historical_auxiliary', 'cross_check'],
  supportedSourceVariants: ['compiled', 'annotated', 'other'],
  detectionFields: [
    {
      key: 'requireLegalHeader',
      label: 'Exigir cabeçalho jurídico reconhecível',
      valueKind: 'boolean',
      defaultValue: true,
      required: true,
    },
  ],
};

const validDraft: SourceDraft = {
  providerKey: 'planalto-oficial',
  providerName: 'Portal oficial do Planalto',
  lawId: '11111111-1111-4111-8111-111111111111',
  scheme: 'https',
  host: 'www.planalto.gov.br',
  pathPrefix: '/ccivil_03/',
  monitoringIntervalHours: '24',
  primaryVariant: 'compiled',
  primaryUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lei-teste.htm',
  auxiliaryEnabled: true,
  auxiliaryRole: 'historical_auxiliary',
  auxiliaryVariant: 'annotated',
  auxiliaryUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lei-teste-anotada.htm',
  detectionParameters: { requireLegalHeader: true },
};

describe('validação do formulário de fontes oficiais', () => {
  it('aceita uma origem e artefatos compatíveis com o adaptador', () => {
    expect(validateSourceDraft(validDraft, capability)).toEqual({});
  });

  it('rejeita host, prefixo e esquema fora das capacidades declaradas', () => {
    const errors = validateSourceDraft(
      {
        ...validDraft,
        scheme: 'http',
        host: 'planalto.gov.br.example.org',
        pathPrefix: 'ccivil_03/?busca=lei',
      },
      capability,
    );

    expect(errors.scheme).toBeDefined();
    expect(errors.host).toBeDefined();
    expect(errors.pathPrefix).toBeDefined();
    expect(errors.primaryUrl).toBeDefined();
  });

  it('rejeita UUID e frequência inválidos', () => {
    const errors = validateSourceDraft(
      { ...validDraft, lawId: 'lei-9099', monitoringIntervalHours: '745' },
      capability,
    );

    expect(errors.lawId).toBeDefined();
    expect(errors.monitoringIntervalHours).toBeDefined();
  });

  it('rejeita URL duplicada e URL com credenciais ou fragmento', () => {
    const duplicated = validateSourceDraft(
      { ...validDraft, auxiliaryUrl: validDraft.primaryUrl },
      capability,
    );
    const hostile = validateSourceDraft(
      {
        ...validDraft,
        primaryUrl: 'https://usuario:segredo@www.planalto.gov.br/ccivil_03/leis/lei.htm#texto',
      },
      capability,
    );

    expect(duplicated.auxiliaryUrl).toMatch(/diferente/iu);
    expect(hostile.primaryUrl).toMatch(/respeitar/iu);
  });
});
