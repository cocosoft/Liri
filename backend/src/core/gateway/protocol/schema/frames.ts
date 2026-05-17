import { Type } from '@sinclair/typebox';
import { ErrorCodeEnum } from './enums.js';

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
