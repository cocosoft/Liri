export type ChunkMode = 'length' | 'newline';

export type ReplyPayload = {
  text?: string;
  attachments?: Array<{ type: string; url: string; name?: string }>;
  metadata?: Record<string, unknown>;
};

export type EnvelopeMetadata = {
  replyTo?: string;
  conversationId?: string;
  channelId?: string;
  accountId?: string;
  timestamp: number;
  priority?: 'low' | 'normal' | 'high';
};

export type ReplyEnvelope = {
  id: string;
  payload: ReplyPayload;
  metadata: EnvelopeMetadata;
  chunks: string[];
};

export type DispatchTarget = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

export type DispatchResult = {
  sent: boolean;
  envelopeId: string;
  chunkCount: number;
  error?: string;
};

export type HeartbeatState = {
  active: boolean;
  startedAt: number;
  lastBeatAt: number;
  intervalMs: number;
  beatCount: number;
};

export type ReplyContext = {
  sessionId: string;
  messageId: string;
  channelId: string;
  accountId?: string;
  conversationId?: string;
  text: string;
  attachments?: Array<{ type: string; url: string; name?: string }>;
};

export type ReplyResult = {
  sent: boolean;
  envelopes: ReplyEnvelope[];
  dispatched: DispatchResult[];
  heartbeat?: HeartbeatState;
  error?: string;
};

export type ChunkResult = {
  chunks: string[];
  mode: ChunkMode;
  originalLength: number;
  chunkCount: number;
};
