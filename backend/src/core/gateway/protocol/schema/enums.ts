import { Type } from '@sinclair/typebox';

export const ChannelTypeEnum = Type.Enum({
  TELEGRAM: 'telegram',
  WEBSOCKET: 'websocket',
  HTTP: 'http',
  CLI: 'cli',
  SLACK: 'slack',
  DISCORD: 'discord',
  CUSTOM: 'custom',
});

export const FrameTypeEnum = Type.Enum({
  REQUEST: 'request',
  RESPONSE: 'response',
  EVENT: 'event',
  ERROR: 'error',
});

export const EventTypeEnum = Type.Enum({
  MESSAGE: 'message',
  STATUS: 'status',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
});

export const ErrorCodeEnum = Type.Enum({
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_FRAME: 'INVALID_FRAME',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT: 'TIMEOUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CHANNEL_ERROR: 'CHANNEL_ERROR',
});
