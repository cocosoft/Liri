import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type {
  RequestFrame,
  ResponseFrame,
  EventFrame,
  ErrorFrame,
  GatewayFrame,
  InboundFrame,
  ErrorCode,
} from './types';

export type {
  RequestFrame,
  ResponseFrame,
  EventFrame,
  ErrorFrame,
  GatewayFrame,
  InboundFrame,
  ErrorCode,
} from './types';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function createRequestFrame(
  method: string,
  params?: Record<string, unknown>,
  id?: string
): RequestFrame {
  return { type: 'request', id: id ?? randomUUID(), method, params };
}

export function createResponseFrame(
  id: string,
  result?: unknown,
  error?: { code: string; message: string; details?: unknown }
): ResponseFrame {
  const frame: ResponseFrame = { type: 'response', id };
  if (result !== undefined) frame.result = result;
  if (error) frame.error = error as ErrorFrame['error'];
  return frame;
}

export function createEventFrame(event: string, data?: unknown): EventFrame {
  const frame: EventFrame = { type: 'event', event };
  if (data !== undefined) frame.data = data;
  return frame;
}

export function createErrorFrame(
  errorCode: ErrorCode,
  message: string,
  details?: unknown
): ErrorFrame {
  const frame: ErrorFrame = {
    type: 'error',
    error: { code: errorCode, message },
  };
  if (details !== undefined) frame.error.details = details;
  return frame;
}

export function isRequestFrame(frame: GatewayFrame): frame is RequestFrame {
  return frame.type === 'request';
}

export function isResponseFrame(frame: GatewayFrame): frame is ResponseFrame {
  return frame.type === 'response';
}

export function isEventFrame(frame: GatewayFrame): frame is EventFrame {
  return frame.type === 'event';
}

export function isErrorFrame(frame: GatewayFrame): frame is ErrorFrame {
  return frame.type === 'error';
}

export function isInboundFrame(frame: GatewayFrame): frame is InboundFrame {
  return isRequestFrame(frame) || isEventFrame(frame);
}

export function getFrameId(frame: GatewayFrame): string | undefined {
  if (isRequestFrame(frame) || isResponseFrame(frame)) return frame.id;
  return undefined;
}

export function computeWebSocketAcceptKey(key: string): string {
  return crypto
    .createHash('sha1')
    .update(key + WS_MAGIC_GUID)
    .digest('base64');
}
