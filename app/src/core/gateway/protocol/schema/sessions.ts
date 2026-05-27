import { Type, type Static } from '@sinclair/typebox';

export const SessionConfigSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  channelId: Type.String({ minLength: 1 }),
  conversationId: Type.String({ minLength: 1 }),
  participantId: Type.String({ minLength: 1 }),
  participantName: Type.Optional(Type.String()),
  idleTimeoutMs: Type.Optional(
    Type.Integer({ minimum: 1000, default: 1800000 })
  ),
  maxIdleCount: Type.Optional(Type.Integer({ minimum: 1, default: 10 })),
  resetPolicy: Type.Optional(
    Type.Union([
      Type.Literal('manual'),
      Type.Literal('time_based'),
      Type.Literal('turn_based'),
    ])
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const SessionStateSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('idle'),
    Type.Literal('waiting'),
    Type.Literal('closed'),
    Type.Literal('error'),
  ]),
  createdAt: Type.Number(),
  lastActivityAt: Type.Number(),
  messageCount: Type.Integer({ minimum: 0 }),
  turnCount: Type.Integer({ minimum: 0 }),
  tokenUsage: Type.Optional(
    Type.Object({
      inputTokens: Type.Integer({ minimum: 0 }),
      outputTokens: Type.Integer({ minimum: 0 }),
      totalTokens: Type.Integer({ minimum: 0 }),
    })
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const SessionContextSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  channelType: Type.String(),
  channelUserId: Type.String(),
  participantDisplayName: Type.Optional(Type.String()),
  platform: Type.Optional(Type.String()),
  clientInfo: Type.Optional(
    Type.Object({
      userAgent: Type.Optional(Type.String()),
      platform: Type.Optional(Type.String()),
      locale: Type.Optional(Type.String()),
    })
  ),
  turnNumber: Type.Integer({ minimum: 0 }),
  createdAt: Type.Number(),
});

export type SessionConfig = Static<typeof SessionConfigSchema>;
export type SessionState = Static<typeof SessionStateSchema>;
export type SessionContext = Static<typeof SessionContextSchema>;
