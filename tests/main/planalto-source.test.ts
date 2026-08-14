import { describe, expect, it, vi } from 'vitest';

import {
  fetchPlanaltoSourceSet,
  isPublicIpAddress,
  PLANALTO_NETWORK_LIMITS,
  PlanaltoNetworkError,
  type PlanaltoNetworkPorts,
} from '../../src/main/import/planalto-source.js';

const PUBLIC_ADDRESSES = [{ address: '8.8.8.8', family: 4 as const }];

const makePorts = (
  respond: PlanaltoNetworkPorts['request'],
  addresses = PUBLIC_ADDRESSES,
): PlanaltoNetworkPorts => ({
  resolveHost: vi.fn(() => Promise.resolve(addresses)),
  request: vi.fn(respond),
});

const htmlResponse = (body = '<html><body>Art. 1º Texto.</body></html>') => ({
  statusCode: 200,
  headers: { 'content-type': 'text/html; charset=windows-1252' },
  body: Buffer.from(body),
});

describe('fetch seguro do conjunto Planalto', () => {
  it('rejeita host fora da allowlist antes de DNS ou transporte', async () => {
    const ports = makePorts(() => Promise.resolve(htmlResponse()));

    await expect(fetchPlanaltoSourceSet('http://127.0.0.1/segredo', ports)).rejects.toMatchObject({
      code: 'NETWORK_NOT_ALLOWED',
    });
    expect(ports.resolveHost).not.toHaveBeenCalled();
    expect(ports.request).not.toHaveBeenCalled();
  });

  it.each([
    'https://xn--planalt-6za.gov.br/ccivil_03/leis/l9099.htm',
    'https://www.planalto.gov.br:8443/ccivil_03/leis/l9099.htm',
  ])('rejeita host IDNA semelhante ou porta inesperada antes do DNS: %s', async (url) => {
    const ports = makePorts(() => Promise.resolve(htmlResponse()));

    await expect(fetchPlanaltoSourceSet(url, ports)).rejects.toMatchObject({
      code: 'NETWORK_NOT_ALLOWED',
    });
    expect(ports.resolveHost).not.toHaveBeenCalled();
    expect(ports.request).not.toHaveBeenCalled();
  });

  it('rejeita qualquer resolução privada e não abre conexão', async () => {
    const ports = makePorts(
      () => Promise.resolve(htmlResponse()),
      [{ address: '169.254.169.254', family: 4 }],
    );

    await expect(
      fetchPlanaltoSourceSet('https://www.planalto.gov.br/lei.htm', ports),
    ).rejects.toMatchObject({ code: 'NETWORK_NOT_ALLOWED' });
    expect(ports.request).not.toHaveBeenCalled();
  });

  it('revalida redirect e bloqueia troca para destino proibido', async () => {
    const ports = makePorts(() =>
      Promise.resolve({
        statusCode: 302,
        headers: { location: 'http://localhost/admin' },
        body: Buffer.alloc(0),
      }),
    );

    await expect(
      fetchPlanaltoSourceSet('https://www.planalto.gov.br/lei.htm', ports),
    ).rejects.toMatchObject({ code: 'NETWORK_NOT_ALLOWED' });
    expect(ports.request).toHaveBeenCalledTimes(1);
  });

  it('resolve DNS novamente em cada redirect e bloqueia rebinding para IP privado', async () => {
    const ports: PlanaltoNetworkPorts = {
      resolveHost: vi
        .fn()
        .mockResolvedValueOnce(PUBLIC_ADDRESSES)
        .mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 as const }]),
      request: vi.fn(() =>
        Promise.resolve({
          statusCode: 302,
          headers: { location: 'https://www.planalto.gov.br/redirected.htm' },
          body: Buffer.alloc(0),
        }),
      ),
    };

    await expect(
      fetchPlanaltoSourceSet('https://www.planalto.gov.br/lei.htm', ports),
    ).rejects.toMatchObject({ code: 'NETWORK_NOT_ALLOWED' });
    expect(ports.resolveHost).toHaveBeenCalledTimes(2);
    expect(ports.request).toHaveBeenCalledTimes(1);
  });

  it('prefere a contraparte compilada e mantém a anotada como evidência histórica', async () => {
    const ports = makePorts(({ url, addresses }) => {
      expect(addresses).toEqual(PUBLIC_ADDRESSES);
      return Promise.resolve(
        htmlResponse(
          url.pathname.includes('compilado') ? '<html>compilada</html>' : '<html>anotada</html>',
        ),
      );
    });

    const artifacts = await fetchPlanaltoSourceSet(
      'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
      ports,
    );

    expect(artifacts).toHaveLength(2);
    expect(artifacts.map(({ sourceRole, sourceVariant }) => [sourceRole, sourceVariant])).toEqual([
      ['primary_current', 'compiled'],
      ['historical_auxiliary', 'annotated'],
    ]);
    expect(artifacts[0]?.finalUrl).toContain('del4657compilado.htm');
    expect(artifacts[1]?.finalUrl).toContain('del4657.htm');
  });

  it('aceita fonte única quando a contraparte oficial não existe', async () => {
    const ports = makePorts(({ url }) =>
      Promise.resolve(
        url.pathname.includes('compilado')
          ? htmlResponse()
          : { statusCode: 404, headers: { 'content-type': 'text/html' }, body: Buffer.alloc(0) },
      ),
    );

    const artifacts = await fetchPlanaltoSourceSet(
      'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm',
      ports,
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      sourceRole: 'primary_current',
      sourceVariant: 'compiled',
    });
  });

  it('distingue tipo inválido, limite excedido e timeout', async () => {
    const invalidType = makePorts(() =>
      Promise.resolve({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{}'),
      }),
    );
    await expect(
      fetchPlanaltoSourceSet('https://www.planalto.gov.br/lei.htm', invalidType),
    ).rejects.toMatchObject({ code: 'NETWORK_CONTENT_TYPE' });

    const tooLarge = makePorts(() =>
      Promise.resolve({
        ...htmlResponse(),
        body: Buffer.alloc(PLANALTO_NETWORK_LIMITS.maxArtifactBytes + 1),
      }),
    );
    await expect(
      fetchPlanaltoSourceSet('https://www.planalto.gov.br/lei.htm', tooLarge),
    ).rejects.toMatchObject({ code: 'NETWORK_TOO_LARGE' });

    const timeout = makePorts(() => Promise.reject(new PlanaltoNetworkError('NETWORK_TIMEOUT')));
    await expect(
      fetchPlanaltoSourceSet('https://www.planalto.gov.br/lei.htm', timeout),
    ).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
  });
});

describe('classificação de endereço de rede', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
  ])('bloqueia %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('aceita IP público %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });
});
