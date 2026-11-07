import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { LawSourceBindingRevision, ProviderRevision } from '@lex-editor/source-ingestion';
import {
  createNodeSourceDryRunRunner,
  fetchConfiguredPlanaltoSourceSet,
  ingestConfiguredPlanaltoSourceSet,
  type PlanaltoNetworkPorts,
  type TransportRequest,
} from '@lex-editor/source-ingestion/node';

const DIGEST = 'a'.repeat(64);
const provider: ProviderRevision = {
  schemaVersion: 1,
  providerRevisionId: '11111111-1111-4111-8111-111111111111',
  providerId: '22222222-2222-4222-8222-222222222222',
  revisionNumber: 1,
  providerKey: 'planalto-oficial',
  providerName: 'Portal da Legislação do Planalto',
  sourceType: 'planalto_html',
  adapterId: 'planalto.html',
  adapterContractVersion: 1,
  origin: { scheme: 'https', host: 'www.planalto.gov.br', port: null, pathPrefix: '/ccivil_03/' },
  detectionParameters: { requireLegalHeader: true },
  configDigest: DIGEST,
  createdByUserId: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-08-13T15:00:00.000Z',
};
const binding: LawSourceBindingRevision = {
  schemaVersion: 1,
  bindingRevisionId: '44444444-4444-4444-8444-444444444444',
  bindingId: '55555555-5555-4555-8555-555555555555',
  lawId: '66666666-6666-4666-8666-666666666666',
  providerRevisionId: provider.providerRevisionId,
  revisionNumber: 1,
  artifacts: [
    {
      order: 0,
      sourceRole: 'primary_current',
      sourceVariant: 'compiled',
      sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm',
    },
    {
      order: 1,
      sourceRole: 'historical_auxiliary',
      sourceVariant: 'annotated',
      sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm',
    },
  ],
  monitoringIntervalMs: 86_400_000,
  configDigest: 'b'.repeat(64),
  createdByUserId: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-08-13T15:00:00.000Z',
};

const fixturePorts = async (): Promise<PlanaltoNetworkPorts> => {
  const [compiled, annotated] = await Promise.all([
    readFile(join(process.cwd(), 'fixtures/legal/l10826/compiled/snapshot.html')),
    readFile(join(process.cwd(), 'fixtures/legal/l10826/annotated/snapshot.html')),
  ]);
  return {
    resolveHost: vi.fn(() => Promise.resolve([{ address: '8.8.8.8', family: 4 as const }])),
    request: vi.fn(({ url }: TransportRequest) =>
      Promise.resolve({
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=windows-1252' },
        body: url.pathname.includes('compilado') ? compiled : annotated,
      }),
    ),
  };
};

describe('seleção primária da importação manual configurada', () => {
  it('seleciona a URL anotada sem alterar os papéis do catálogo para coletas automáticas', async () => {
    const ports = await fixturePorts();
    const selectedUrl = binding.artifacts[1]?.sourceUrl;
    if (selectedUrl === undefined) throw new Error('Fixture inválida');
    const imported = await fetchConfiguredPlanaltoSourceSet(provider, binding, ports, selectedUrl);
    expect(imported.map(({ sourceRole, sourceVariant }) => [sourceRole, sourceVariant])).toEqual([
      ['primary_current', 'annotated'],
      ['cross_check', 'compiled'],
    ]);
    expect(imported[0]?.requestedUrl).toBe(selectedUrl);
    const automatic = await fetchConfiguredPlanaltoSourceSet(provider, binding, ports);
    expect(automatic.map(({ sourceRole }) => sourceRole)).toEqual([
      'primary_current',
      'historical_auxiliary',
    ]);
    expect(binding.artifacts[0]?.sourceRole).toBe('primary_current');
    expect(binding.artifacts[1]?.sourceRole).toBe('historical_auxiliary');
  });

  it('recusa URL fora do conjunto configurado antes de DNS e transporte', async () => {
    const ports = await fixturePorts();
    await expect(
      fetchConfiguredPlanaltoSourceSet(
        provider,
        binding,
        ports,
        'https://www.planalto.gov.br/ccivil_03/leis/outra.htm',
      ),
    ).rejects.toMatchObject({ code: 'NETWORK_NOT_ALLOWED' });
    expect(ports.resolveHost).not.toHaveBeenCalled();
    expect(ports.request).not.toHaveBeenCalled();
  });
});

describe('adaptador Node compartilhado do Planalto', () => {
  it('recupera dispositivos após fechamentos externos no conjunto real do Código Penal', async () => {
    const compiled = await readFile('fixtures/legal/cp/import/compiled.html');
    const annotated = await readFile('fixtures/legal/cp/import/annotated.html');
    const cpBinding: LawSourceBindingRevision = {
      ...binding,
      artifacts: binding.artifacts.map((artifact) => ({
        ...artifact,
        sourceUrl:
          'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848' +
          (artifact.sourceVariant === 'compiled' ? 'compilado' : '') +
          '.htm',
      })),
    };
    const result = await ingestConfiguredPlanaltoSourceSet(provider, cpBinding, {
      resolveHost: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
      request: ({ url }) =>
        Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=windows-1252' },
          body: url.pathname.includes('compilado') ? compiled : annotated,
        }),
    });

    const primary = result.artifacts.find(
      ({ fetched }) => fetched.sourceRole === 'primary_current',
    );
    const history = result.artifacts.find(
      ({ fetched }) => fetched.sourceRole === 'historical_auxiliary',
    );
    expect(
      primary?.extractedContent.includes(
        'Art. 1º - Não há crime sem lei anterior que o defina. Não há pena sem prévia cominação legal.',
      ),
    ).toBe(true);
    expect(primary?.extractedContent.includes('Art. 361')).toBe(true);
    expect(history?.extractedContent.includes('~~Art. 1° Não há crime sem lei anterior')).toBe(
      true,
    );
    expect(history?.extractedContent.includes('Art. 361')).toBe(true);
    expect(history?.snapshot.conteudo.includes('</html>')).toBe(true);
  }, 15_000);

  it.each([
    {
      law: 'Lei nº 9.099/1995',
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current' as const,
          sourceVariant: 'annotated' as const,
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l9099.htm',
          fixturePath: 'fixtures/legal/l9099/snapshot.html',
        },
      ],
    },
    {
      law: 'Lei nº 9.605/1998',
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current' as const,
          sourceVariant: 'annotated' as const,
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l9605.htm',
          fixturePath: 'fixtures/legal/l9605/snapshot.html',
        },
      ],
    },
    {
      law: 'Lei nº 10.826/2003',
      artifacts: [
        {
          order: 0,
          sourceRole: 'primary_current' as const,
          sourceVariant: 'compiled' as const,
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm',
          fixturePath: 'fixtures/legal/l10826/compiled/snapshot.html',
        },
        {
          order: 1,
          sourceRole: 'historical_auxiliary' as const,
          sourceVariant: 'annotated' as const,
          sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm',
          fixturePath: 'fixtures/legal/l10826/annotated/snapshot.html',
        },
      ],
    },
  ])('revalida $law offline com funções e variantes normativas', async ({ artifacts }) => {
    const fixtures = new Map(
      await Promise.all(
        artifacts.map(
          async ({ sourceUrl, fixturePath }) => [sourceUrl, await readFile(fixturePath)] as const,
        ),
      ),
    );
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
      request: ({ url }) => {
        const body = fixtures.get(url.href);
        if (body === undefined) throw new Error('UNEXPECTED_FIXTURE_URL');
        return Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=windows-1252' },
          body,
        });
      },
    };
    const configuredBinding: LawSourceBindingRevision = {
      ...binding,
      artifacts: artifacts.map((artifact) => ({
        order: artifact.order,
        sourceRole: artifact.sourceRole,
        sourceVariant: artifact.sourceVariant,
        sourceUrl: artifact.sourceUrl,
      })),
    };

    const result = await ingestConfiguredPlanaltoSourceSet(provider, configuredBinding, ports);

    expect(
      result.artifacts.map(({ fetched }) => ({
        sourceRole: fetched.sourceRole,
        sourceVariant: fetched.sourceVariant,
        sourceUrl: fetched.finalUrl,
      })),
    ).toEqual(
      artifacts.map((artifact) => ({
        sourceRole: artifact.sourceRole,
        sourceVariant: artifact.sourceVariant,
        sourceUrl: artifact.sourceUrl,
      })),
    );
    expect(
      result.artifacts.every(({ extractedContent }) => extractedContent.includes('Art.')),
    ).toBe(true);
  });

  it('coleta somente URLs configuradas e preserva snapshots separados', async () => {
    const ports = await fixturePorts();
    const result = await ingestConfiguredPlanaltoSourceSet(provider, binding, ports);

    expect(ports.request).toHaveBeenCalledTimes(2);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.map(({ snapshot }) => snapshot.sha256)).toHaveLength(2);
    expect(new Set(result.artifacts.map(({ snapshot }) => snapshot.sha256)).size).toBe(2);
    expect(result.artifacts.map(({ snapshot }) => snapshot.referencia.sourceRole)).toEqual([
      'primary_current',
      'historical_auxiliary',
    ]);
    expect(
      result.artifacts.every(({ extractedContent }) => extractedContent.includes('Art.')),
    ).toBe(true);
  });

  it('gera evidência limitada de sucesso pelo caminho real', async () => {
    const result = await createNodeSourceDryRunRunner(await fixturePorts()).run(provider, binding);

    expect(result).toMatchObject({
      sourceTestOutcome: 'success',
      completedStage: 'adapter',
      errorCode: null,
    });
    expect(result.evidenceDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('<html');
    expect(JSON.stringify(result)).not.toContain('Art.');
  });

  it('classifica falha de rede sem converter em sucesso', async () => {
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '10.0.0.8', family: 4 }]),
      request: vi.fn(() => Promise.reject(new Error('must not request'))),
    };
    const result = await createNodeSourceDryRunRunner(ports).run(provider, binding);

    expect(result).toMatchObject({
      sourceTestOutcome: 'failure',
      completedStage: 'network',
      errorCode: 'NETWORK_NOT_ALLOWED',
    });
    expect(ports.request).not.toHaveBeenCalled();
  });

  it('classifica página HTML sem estrutura jurídica como falha de detecção', async () => {
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
      request: () =>
        Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from('<html><body><p>Portal institucional sem lei.</p></body></html>'),
        }),
    };
    const result = await createNodeSourceDryRunRunner(ports).run(provider, binding);

    expect(result).toMatchObject({
      sourceTestOutcome: 'failure',
      completedStage: 'detection',
      errorCode: 'SOURCE_UNRECOGNIZED',
    });
  });
});
