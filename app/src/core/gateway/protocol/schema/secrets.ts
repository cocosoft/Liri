import { Type, type Static } from '@sinclair/typebox';

export const SecretRefSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  store: Type.Optional(Type.String({ default: 'env' })),
  fallback: Type.Optional(Type.String()),
});

export const SecretStoreSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.Union([
    Type.Literal('env'),
    Type.Literal('file'),
    Type.Literal('vault'),
    Type.Literal('memory'),
  ]),
  config: Type.Record(Type.String(), Type.Unknown()),
});

export const CredentialConfigSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  type: Type.String({ minLength: 1 }),
  secrets: Type.Array(SecretRefSchema),
  scopes: Type.Optional(Type.Array(Type.String())),
  expiresAt: Type.Optional(Type.Number()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type SecretRef = Static<typeof SecretRefSchema>;
export type SecretStore = Static<typeof SecretStoreSchema>;
export type CredentialConfig = Static<typeof CredentialConfigSchema>;
