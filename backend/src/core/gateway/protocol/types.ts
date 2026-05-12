import type { Static } from '@sinclair/typebox';
import {
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  ErrorFrameSchema,
  ChannelTypeEnum,
  FrameTypeEnum,
  EventTypeEnum,
  ErrorCodeEnum,
} from './schemas';

export type ChannelType = Static<typeof ChannelTypeEnum>;
export type FrameType = Static<typeof FrameTypeEnum>;
export type EventType = Static<typeof EventTypeEnum>;
export type ErrorCode = Static<typeof ErrorCodeEnum>;

export type RequestFrame = Static<typeof RequestFrameSchema>;
export type ResponseFrame = Static<typeof ResponseFrameSchema>;
export type EventFrame = Static<typeof EventFrameSchema>;
export type ErrorFrame = Static<typeof ErrorFrameSchema>;

export type GatewayFrame =
  | RequestFrame
  | ResponseFrame
  | EventFrame
  | ErrorFrame;
export type InboundFrame = RequestFrame | EventFrame;

export type { Static } from '@sinclair/typebox';
