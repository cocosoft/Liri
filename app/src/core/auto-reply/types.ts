// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
