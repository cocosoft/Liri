import { Type, type Static } from '@sinclair/typebox';

export const NodeInfoSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  type: Type.Union([
    Type.Literal('agent'),
    Type.Literal('gateway'),
    Type.Literal('worker'),
    Type.Literal('relay'),
  ]),
  version: Type.String(),
  status: Type.Union([
    Type.Literal('online'),
    Type.Literal('offline'),
    Type.Literal('busy'),
    Type.Literal('maintenance'),
  ]),
  address: Type.Optional(Type.String()),
  port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  lastHeartbeatAt: Type.Optional(Type.Number()),
  startedAt: Type.Optional(Type.Number()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const NodeCapabilitySchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  type: Type.String(),
  version: Type.String(),
  enabled: Type.Optional(Type.Boolean({ default: true })),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const NodeCommandSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  targetNodeId: Type.String({ minLength: 1 }),
  command: Type.String({ minLength: 1 }),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
  ]),
  issuedAt: Type.Number(),
  completedAt: Type.Optional(Type.Number()),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
});

export type NodeInfo = Static<typeof NodeInfoSchema>;
export type NodeCapability = Static<typeof NodeCapabilitySchema>;
export type NodeCommand = Static<typeof NodeCommandSchema>;
