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

const ErrorDetailSchema = Type.Object({
  code: ErrorCodeEnum,
  message: Type.String(),
  details: Type.Optional(Type.Unknown()),
});

export const RequestFrameSchema = Type.Object({
  type: Type.Literal('request'),
  id: Type.String({ minLength: 1 }),
  method: Type.String({ minLength: 1 }),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ResponseFrameSchema = Type.Object({
  type: Type.Literal('response'),
  id: Type.String({ minLength: 1 }),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(ErrorDetailSchema),
});

export const EventFrameSchema = Type.Object({
  type: Type.Literal('event'),
  event: Type.String({ minLength: 1 }),
  data: Type.Optional(Type.Unknown()),
});

export const ErrorFrameSchema = Type.Object({
  type: Type.Literal('error'),
  error: ErrorDetailSchema,
});

export const GatewayFrameSchema = Type.Union([
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  ErrorFrameSchema,
]);

export const InboundFrameSchema = Type.Union([
  RequestFrameSchema,
  EventFrameSchema,
]);

export const schemas = {
  RequestFrame: RequestFrameSchema,
  ResponseFrame: ResponseFrameSchema,
  EventFrame: EventFrameSchema,
  ErrorFrame: ErrorFrameSchema,
  GatewayFrame: GatewayFrameSchema,
  InboundFrame: InboundFrameSchema,
  ChannelType: ChannelTypeEnum,
  FrameType: FrameTypeEnum,
  EventType: EventTypeEnum,
  ErrorCode: ErrorCodeEnum,
  ErrorDetail: ErrorDetailSchema,
};

export type T = typeof schemas;
