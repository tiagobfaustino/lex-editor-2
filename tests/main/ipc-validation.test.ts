import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  executeValidatedIpcHandler,
  isTrustedIpcSender,
} from '../../src/main/ipc/validated-handler.js';
import {
  resolveRendererLocation,
  type RendererLocation,
} from '../../src/main/renderer-location.js';

const productionLocation = resolveRendererLocation({
  productionUrl: 'file:///app/out/renderer/index.html',
});

type SenderFixture = Readonly<{
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>;
  webContents: WebContents;
  frame: WebFrameMain;
}>;

const createSenderFixture = (frameUrl = productionLocation.url): SenderFixture => {
  const frame = {
    isDestroyed: () => false,
    url: frameUrl,
  } as WebFrameMain;
  const webContents = {
    mainFrame: frame,
  } as WebContents;
  const event = {
    sender: webContents,
    senderFrame: frame,
  };

  return { event, webContents, frame };
};

const createHandlerOptions = (
  fixture: SenderFixture,
  overrides: Partial<{
    rendererLocation: RendererLocation;
    authorize: () => boolean;
    handle: () => unknown;
    maxInputBytes: number;
  }> = {},
) => ({
  rendererLocation: overrides.rendererLocation ?? productionLocation,
  getTrustedWebContents: () => fixture.webContents,
  inputSchema: z.strictObject({ value: z.string().max(32) }),
  outputSchema: z.strictObject({ result: z.string().max(32) }),
  maxInputBytes: overrides.maxInputBytes ?? 512,
  maxOutputBytes: 512,
  authorize: overrides.authorize ?? (() => true),
  handle: overrides.handle ?? (() => ({ result: 'ok' })),
});

describe('resolveRendererLocation', () => {
  it('aceita somente HTTP em loopback durante desenvolvimento', () => {
    expect(
      resolveRendererLocation({
        developmentUrl: 'http://localhost:5173/editor',
        productionUrl: productionLocation.url,
      }),
    ).toEqual({
      kind: 'development',
      url: 'http://localhost:5173/editor',
      trustedOrigin: 'http://localhost:5173',
    });

    expect(() =>
      resolveRendererLocation({
        developmentUrl: 'https://example.com',
        productionUrl: productionLocation.url,
      }),
    ).toThrow();
  });
});

describe('isTrustedIpcSender', () => {
  it('aceita somente a janela principal, o frame principal e o arquivo local exato', () => {
    const fixture = createSenderFixture();
    const fragment = createSenderFixture(`${productionLocation.url}#fontes`);
    const query = createSenderFixture(`${productionLocation.url}?forged=1#fontes`);

    expect(isTrustedIpcSender(fixture.event, fixture.webContents, productionLocation)).toBe(true);
    expect(isTrustedIpcSender(fragment.event, fragment.webContents, productionLocation)).toBe(true);
    expect(isTrustedIpcSender(fixture.event, null, productionLocation)).toBe(false);
    expect(
      isTrustedIpcSender(
        {
          ...fixture.event,
          senderFrame: {
            isDestroyed: () => false,
            url: productionLocation.url,
          } as WebFrameMain,
        },
        fixture.webContents,
        productionLocation,
      ),
    ).toBe(false);
    expect(
      isTrustedIpcSender(
        createSenderFixture('file:///tmp/forged.html').event,
        fixture.webContents,
        productionLocation,
      ),
    ).toBe(false);
    expect(isTrustedIpcSender(query.event, query.webContents, productionLocation)).toBe(false);
  });

  it('aceita apenas a origem loopback exata em desenvolvimento', () => {
    const location = resolveRendererLocation({
      developmentUrl: 'http://127.0.0.1:5173',
      productionUrl: productionLocation.url,
    });
    const trusted = createSenderFixture('http://127.0.0.1:5173/route');
    const wrongPort = createSenderFixture('http://127.0.0.1:4173/route');

    expect(isTrustedIpcSender(trusted.event, trusted.webContents, location)).toBe(true);
    expect(isTrustedIpcSender(wrongPort.event, wrongPort.webContents, location)).toBe(false);
  });
});

describe('executeValidatedIpcHandler', () => {
  it('executa payload válido e valida a saída', async () => {
    const fixture = createSenderFixture();

    await expect(
      executeValidatedIpcHandler(
        fixture.event,
        { value: 'entrada' },
        createHandlerOptions(fixture),
      ),
    ).resolves.toEqual({
      ok: true,
      value: { result: 'ok' },
    });
  });

  it.each([
    ['schema inválido', { value: 'ok', extra: true }, 'INVALID_INPUT'],
    ['payload grande', { value: 'x'.repeat(64) }, 'PAYLOAD_TOO_LARGE'],
  ])('rejeita %s', async (_name, payload, expectedCode) => {
    const fixture = createSenderFixture();

    const result = await executeValidatedIpcHandler(
      fixture.event,
      payload,
      createHandlerOptions(fixture, { maxInputBytes: 48 }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: expectedCode },
    });
  });

  it('nega antes de executar quando remetente ou autorização falham', async () => {
    const fixture = createSenderFixture();
    const handle = vi.fn(() => ({ result: 'ok' }));

    const unauthorized = await executeValidatedIpcHandler(
      fixture.event,
      { value: 'entrada' },
      createHandlerOptions(fixture, {
        authorize: () => false,
        handle,
      }),
    );
    const forged = await executeValidatedIpcHandler(
      createSenderFixture('file:///tmp/forged.html').event,
      { value: 'entrada' },
      createHandlerOptions(fixture, { handle }),
    );

    expect(unauthorized).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    });
    expect(forged).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('redige exceções e saídas fora do contrato', async () => {
    const fixture = createSenderFixture();
    const authorizationError = await executeValidatedIpcHandler(
      fixture.event,
      { value: 'entrada' },
      createHandlerOptions(fixture, {
        authorize: () => {
          throw new Error('segredo-na-autorização');
        },
      }),
    );
    const thrown = await executeValidatedIpcHandler(
      fixture.event,
      { value: 'entrada' },
      createHandlerOptions(fixture, {
        handle: () => {
          throw new Error('segredo-interno');
        },
      }),
    );
    const invalidOutput = await executeValidatedIpcHandler(
      fixture.event,
      { value: 'entrada' },
      createHandlerOptions(fixture, {
        handle: () => ({ unexpected: 'valor' }),
      }),
    );

    expect(authorizationError).toEqual({
      ok: false,
      error: {
        code: 'FAILED',
        message: 'A operação desktop não pôde ser concluída.',
        retryable: true,
      },
    });
    expect(JSON.stringify([authorizationError, thrown])).not.toMatch(
      /segredo-na-autorização|segredo-interno/,
    );
    expect(thrown).toEqual(authorizationError);
    expect(invalidOutput).toMatchObject({
      ok: false,
      error: { code: 'FAILED' },
    });
  });
});
