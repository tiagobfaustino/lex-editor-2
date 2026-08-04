import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { serialize } from 'node:v8';
import type { z } from 'zod';

import type { DesktopErrorCode, DesktopErrorDto, IpcResult } from '../../shared/ipc/desktop-api.js';
import { isTrustedRendererUrl, type RendererLocation } from '../renderer-location.js';

export const DEFAULT_MAX_IPC_PAYLOAD_BYTES = 16 * 1024;

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
  FAILED: {
    message: 'A operação desktop não pôde ser concluída.',
    retryable: true,
  },
};

const failed = <Value>(code: DesktopErrorCode): IpcResult<Value> => {
  const details = errorDetails[code];
  const error: DesktopErrorDto = {
    code,
    message: details.message,
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
  } catch {
    return failed('FAILED');
  }
};
