import { Type, type Static } from '@sinclair/typebox';

export const WebhookConfigSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  url: Type.String({ format: 'uri' }),
  secret: Type.Optional(Type.String()),
  events: Type.Array(Type.String()),
  enabled: Type.Optional(Type.Boolean({ default: true })),
  retryConfig: Type.Optional(
    Type.Object({
      maxRetries: Type.Optional(Type.Integer({ minimum: 0, default: 3 })),
      retryDelayMs: Type.Optional(
        Type.Integer({ minimum: 100, default: 1000 })
      ),
      exponentialBackoff: Type.Optional(Type.Boolean({ default: true })),
    })
  ),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 100, default: 10000 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const WebhookPayloadSchema = Type.Object({
  event: Type.String({ minLength: 1 }),
  timestamp: Type.Number(),
  data: Type.Optional(Type.Unknown()),
  attempts: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  signature: Type.Optional(Type.String()),
});

export const WebhookDeliverySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  webhookId: Type.String({ minLength: 1 }),
  event: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('delivered'),
    Type.Literal('failed'),
    Type.Literal('retrying'),
  ]),
  payload: WebhookPayloadSchema,
  sentAt: Type.Optional(Type.Number()),
  deliveredAt: Type.Optional(Type.Number()),
  responseCode: Type.Optional(Type.Integer()),
  error: Type.Optional(Type.String()),
});

export type WebhookConfig = Static<typeof WebhookConfigSchema>;
export type WebhookPayload = Static<typeof WebhookPayloadSchema>;
export type WebhookDelivery = Static<typeof WebhookDeliverySchema>;
