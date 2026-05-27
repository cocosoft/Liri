import { Type, type Static } from '@sinclair/typebox';

export const ChannelConfigSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  type: Type.String({ minLength: 1 }),
  enabled: Type.Optional(Type.Boolean({ default: true })),
  priority: Type.Optional(
    Type.Integer({ minimum: 0, maximum: 100, default: 50 })
  ),
  rateLimit: Type.Optional(
    Type.Object({
      windowMs: Type.Integer({ minimum: 100 }),
      maxRequests: Type.Integer({ minimum: 1 }),
    })
  ),
  retryConfig: Type.Optional(
    Type.Object({
      maxRetries: Type.Optional(Type.Integer({ minimum: 0, default: 3 })),
      retryDelayMs: Type.Optional(
        Type.Integer({ minimum: 100, default: 1000 })
      ),
    })
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ChannelStatusSchema = Type.Object({
  channelId: Type.String({ minLength: 1 }),
  connected: Type.Boolean(),
  healthy: Type.Boolean(),
  lastHeartbeatAt: Type.Optional(Type.Number()),
  messageCount: Type.Integer({ minimum: 0 }),
  errorCount: Type.Integer({ minimum: 0 }),
  latencyMs: Type.Optional(Type.Number({ minimum: 0 })),
  status: Type.String(),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ChannelMessageSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  channelId: Type.String({ minLength: 1 }),
  direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
  type: Type.Optional(Type.String({ default: 'text' })),
  content: Type.String(),
  timestamp: Type.Number(),
  sender: Type.Optional(
    Type.Object({
      id: Type.String(),
      name: Type.Optional(Type.String()),
    })
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type ChannelConfig = Static<typeof ChannelConfigSchema>;
export type ChannelStatus = Static<typeof ChannelStatusSchema>;
export type ChannelMessage = Static<typeof ChannelMessageSchema>;
