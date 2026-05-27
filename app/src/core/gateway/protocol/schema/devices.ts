import { Type, type Static } from '@sinclair/typebox';

export const DeviceInfoSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  type: Type.Union([
    Type.Literal('desktop'),
    Type.Literal('mobile'),
    Type.Literal('web'),
    Type.Literal('cli'),
  ]),
  platform: Type.Optional(Type.String()),
  osVersion: Type.Optional(Type.String()),
  appVersion: Type.Optional(Type.String()),
  lastSeenAt: Type.Optional(Type.Number()),
  isTrusted: Type.Optional(Type.Boolean({ default: false })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const DeviceAuthSchema = Type.Object({
  deviceId: Type.String({ minLength: 1 }),
  token: Type.String({ minLength: 1 }),
  expiresAt: Type.Number(),
  refreshToken: Type.Optional(Type.String()),
  scopes: Type.Array(Type.String()),
  createdAt: Type.Number(),
});

export const PairingSessionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  deviceId: Type.String({ minLength: 1 }),
  pairingCode: Type.String({ minLength: 6, maxLength: 8 }),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('approved'),
    Type.Literal('rejected'),
    Type.Literal('expired'),
  ]),
  createdAt: Type.Number(),
  expiresAt: Type.Number(),
  approvedAt: Type.Optional(Type.Number()),
  approvedBy: Type.Optional(Type.String()),
});

export type DeviceInfo = Static<typeof DeviceInfoSchema>;
export type DeviceAuth = Static<typeof DeviceAuthSchema>;
export type PairingSession = Static<typeof PairingSessionSchema>;
