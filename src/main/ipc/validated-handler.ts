import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { serialize } from 'node:v8';
import type { z } from 'zod';

import type { DesktopErrorCode, DesktopErrorDto, IpcResult } from '../../shared/ipc/desktop-api.js';
import { isTrustedRendererUrl, type RendererLocation } from '../renderer-location.js';
import { isPlanaltoNetworkError } from '../import/planalto-source.js';

export const DEFAULT_MAX_IPC_PAYLOAD_BYTES = 16 * 1024;

export class DesktopIpcError extends Error {
  constructor(readonly code: DesktopErrorCode) {
    super(code);
    this.name = 'DesktopIpcError';
  }
}

type MaybePromise<Value> = Promise<Value> | Value;

export type ValidatedIpcHandlerOptions<Input, Output> = Readonly<{
  rendererLocation: RendererLocation;
  getTrustedWebContents(): WebContents | null;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  authorize(input: Input): MaybePromise<boolean>;
  handle(input: Input): MaybePromise<Output>;
}>;

const errorDetails: Record<DesktopErrorCode, Readonly<{ message: string; retryable: boolean }>> = {
  INVALID_INPUT: {
    message: 'Os dados enviados são inválidos.',
    retryable: false,
  },
  PAYLOAD_TOO_LARGE: {
    message: 'Os dados enviados excedem o limite permitido.',
    retryable: false,
  },
  NOT_ALLOWED: {
    message: 'A operação não é permitida neste contexto.',
    retryable: false,
  },
  CONFLICT: {
    message: 'A revisão mudou; recarregue os dados antes de confirmar novamente.',
    retryable: true,
  },
  NETWORK_NOT_ALLOWED: {
    message: 'A URL ou o destino de rede não é permitido.',
    retryable: false,
  },
  NETWORK_DNS: {
    message: 'Não foi possível resolver o endereço da fonte oficial.',
    retryable: true,
  },
  NETWORK_TIMEOUT: {
    message: 'Não foi possível acessar a fonte: tempo esgotado.',
    retryable: true,
  },
  NETWORK_HTTP: {
    message: 'A fonte oficial retornou um erro HTTP.',
    retryable: true,
  },
  NETWORK_CONTENT_TYPE: {
    message: 'A fonte não retornou uma página HTML válida.',
    retryable: false,
  },
  NETWORK_TOO_LARGE: {
    message: 'A página excede o limite permitido para importação.',
    retryable: false,
  },
  NETWORK_CERTIFICATE: {
    message: 'O certificado TLS da fonte oficial não é válido.',
    retryable: false,
  },
  FAILED: {
    message: 'A operação desktop não pôde ser concluída.',
    retryable: true,
  },
};

const failed = <Value>(code: DesktopErrorCode, safeMessage?: string): IpcResult<Value> => {
  const details = errorDetails[code];
  const error: DesktopErrorDto = {
    code,
    message: safeMessage ?? details.message,
    retryable: details.retryable,
  };

  return { ok: false, error };
};

const serializedSize = (value: unknown): number | null => {
  try {
    return serialize(value).byteLength;
  } catch {
    return null;
  }
};

export const isTrustedIpcSender = (
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  trustedWebContents: WebContents | null,
  rendererLocation: RendererLocation,
): boolean => {
  const frame = event.senderFrame;

  return (
    trustedWebContents !== null &&
    event.sender === trustedWebContents &&
    frame !== null &&
    !frame.isDestroyed() &&
    frame === event.sender.mainFrame &&
    isTrustedRendererUrl(rendererLocation, frame.url)
  );
};

export const executeValidatedIpcHandler = async <Input, Output>(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  payload: unknown,
  options: ValidatedIpcHandlerOptions<Input, Output>,
): Promise<IpcResult<Output>> => {
  if (!isTrustedIpcSender(event, options.getTrustedWebContents(), options.rendererLocation)) {
    return failed('NOT_ALLOWED');
  }

  const inputSize = serializedSize(payload);
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_IPC_PAYLOAD_BYTES;

  if (inputSize === null) {
    return failed('INVALID_INPUT');
  }

  if (inputSize > maxInputBytes) {
    return failed('PAYLOAD_TOO_LARGE');
  }

  const parsedInput = options.inputSchema.safeParse(payload);

  if (!parsedInput.success) {
    return failed('INVALID_INPUT');
  }

  try {
    if (!(await options.authorize(parsedInput.data))) {
      return failed('NOT_ALLOWED');
    }

    const output = await options.handle(parsedInput.data);
    const parsedOutput = options.outputSchema.safeParse(output);

    if (!parsedOutput.success) {
      return failed('FAILED');
    }

    const outputSize = serializedSize(parsedOutput.data);
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_IPC_PAYLOAD_BYTES;

    if (outputSize === null || outputSize > maxOutputBytes) {
      return failed('FAILED');
    }

    return {
      ok: true,
      value: parsedOutput.data,
    };
  } catch (error) {
    if (error instanceof DesktopIpcError) {
      return failed(error.code);
    }
    if (isPlanaltoNetworkError(error) && error.code !== 'NETWORK_FAILED') {
      const message =
        error.code === 'NETWORK_HTTP' && error.httpStatus !== undefined
          ? `A fonte oficial retornou HTTP ${String(error.httpStatus)}.`
          : undefined;
      return failed(error.code, message);
    }
    return failed('FAILED');
  }
};
