import { Type, type Static } from '@sinclair/typebox';

export const PluginManifestSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  author: Type.Optional(Type.String()),
  hooks: Type.Optional(Type.Array(Type.String())),
  permissions: Type.Optional(Type.Array(Type.String())),
  entry: Type.Optional(Type.String()),
});

export const PluginConfigSchema = Type.Object({
  pluginId: Type.String({ minLength: 1 }),
  enabled: Type.Optional(Type.Boolean({ default: true })),
  priority: Type.Optional(
    Type.Integer({ minimum: 0, maximum: 100, default: 50 })
  ),
  settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const PluginStateSchema = Type.Object({
  pluginId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal('registered'),
    Type.Literal('loaded'),
    Type.Literal('active'),
    Type.Literal('disabled'),
    Type.Literal('error'),
  ]),
  loadedAt: Type.Optional(Type.Number()),
  activatedAt: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
  metrics: Type.Optional(
    Type.Object({
      invocations: Type.Integer({ minimum: 0 }),
      errors: Type.Integer({ minimum: 0 }),
      avgLatencyMs: Type.Optional(Type.Number({ minimum: 0 })),
    })
  ),
});

export type PluginManifest = Static<typeof PluginManifestSchema>;
export type PluginConfig = Static<typeof PluginConfigSchema>;
export type PluginState = Static<typeof PluginStateSchema>;
