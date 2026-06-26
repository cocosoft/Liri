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
/**
 * Voice/Realtime 事件协议类型定义
 * 22 种双向事件类型 + Provider Adapter 接口
 */

import type { IncomingMessage, ServerResponse } from 'http';

/** ========== Client → Server (7 types) ========== */

export interface VoiceSessionConfigEvent {
  type: 'session.config';
  provider: string;
  voice?: string;
  model?: string;
  brainAgent?: string;
}

export interface VoiceAudioAppendEvent {
  type: 'audio.append';
  data: string;
}

export interface VoiceAudioCommitEvent {
  type: 'audio.commit';
}

export interface VoiceFrameAppendEvent {
  type: 'frame.append';
  data: string;
  mimeType?: string;
}

export interface VoiceResponseCreateEvent {
  type: 'response.create';
}

export interface VoiceResponseCancelEvent {
  type: 'response.cancel';
}

export interface VoiceToolResultEvent {
  type: 'tool.result';
  callId: string;
  output: string;
}

/** P2-2: 心跳请求事件（前端 → 后端） */
export interface VoicePingEvent {
  type: 'ping';
  timestamp: number;
}

export type VoiceClientEvent =
  | VoiceSessionConfigEvent
  | VoiceAudioAppendEvent
  | VoiceAudioCommitEvent
  | VoiceFrameAppendEvent
  | VoiceResponseCreateEvent
  | VoiceResponseCancelEvent
  | VoiceToolResultEvent
  | VoicePingEvent;

/** ========== Server → Client (15 types) ========== */

export interface VoiceSessionReadyEvent {
  type: 'session.ready';
  sessionId: string;
}

export interface VoiceAudioDeltaEvent {
  type: 'audio.delta';
  data: string;
}

export interface VoiceTranscriptDeltaEvent {
  type: 'transcript.delta';
  delta: string;
}

export interface VoiceTranscriptDoneEvent {
  type: 'transcript.done';
  text: string;
}

export interface VoiceToolCallEvent {
  type: 'tool.call';
  id: string;
  name: string;
  arguments: string;
}

export interface VoiceToolProgressEvent {
  type: 'tool.progress';
  callId: string;
  summary: string;
}

export interface VoiceToolCancelledEvent {
  type: 'tool.cancelled';
  callId: string;
}

export interface VoiceTurnStartedEvent {
  type: 'turn.started';
}

export interface VoiceTurnEndedEvent {
  type: 'turn.ended';
}

export interface VoiceSessionEndedEvent {
  type: 'session.ended';
  summary: string;
  duration: number;
}

export interface VoiceSessionRotatingEvent {
  type: 'session.rotating';
  reason: string;
}

export interface VoiceSessionRotatedEvent {
  type: 'session.rotated';
  newSessionId: string;
}

export interface VoiceUsageMetricsEvent {
  type: 'usage.metrics';
  inputTokens: number;
  outputTokens: number;
}

export interface VoiceLatencyMetricsEvent {
  type: 'latency.metrics';
  audioMs: number;
  llmMs: number;
}

export interface VoiceErrorEvent {
  type: 'error';
  code: string;
  message: string;
}

/** P2-2: 会话状态变更事件（后端 → 前端推送） */
export interface VoiceSessionStateChangeEvent {
  type: 'session.state_change';
  state: VoiceSessionState;
  previous: VoiceSessionState;
  timestamp: number;
}

/** P2-2: 心跳响应事件 */
export interface VoicePongEvent {
  type: 'pong';
  timestamp: number;
}

export type VoiceServerEvent =
  | VoiceSessionReadyEvent
  | VoiceAudioDeltaEvent
  | VoiceTranscriptDeltaEvent
  | VoiceTranscriptDoneEvent
  | VoiceToolCallEvent
  | VoiceToolProgressEvent
  | VoiceToolCancelledEvent
  | VoiceTurnStartedEvent
  | VoiceTurnEndedEvent
  | VoiceSessionEndedEvent
  | VoiceSessionRotatingEvent
  | VoiceSessionRotatedEvent
  | VoiceUsageMetricsEvent
  | VoiceLatencyMetricsEvent
  | VoiceErrorEvent
  | VoiceSessionStateChangeEvent
  | VoicePongEvent;

/** ========== Session 生命周期状态 ========== */

export type VoiceSessionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'active'
  | 'rotating'
  | 'disconnected'
  | 'error';

/** ========== 会话摘要 ========== */

export interface VoiceSessionSummary {
  sessionId: string;
  state: VoiceSessionState;
  startedAt: number;
  endedAt?: number;
  duration: number;
  totalAudioMs: number;
  totalLlmMs: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  errors: string[];
}

/** ========== 工具声明 ========== */

export interface VoiceToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** ========== Provider Adapter 接口 ========== */

export interface VoiceProviderAdapter {
  connect(
    config: VoiceSessionConfigEvent,
    sendToClient: (event: VoiceServerEvent) => void,
    options?: { tools?: VoiceToolDeclaration[] }
  ): Promise<void>;

  sendAudio(base64Data: string): void;

  commitAudio(): void;

  sendFrame(data: string, mimeType?: string): void;

  createResponse(): void;

  cancelResponse(): void;

  beginAsyncToolCall(callId: string): void;

  finishAsyncToolCall(callId: string): void;

  sendToolResult(callId: string, output: string): void;

  injectContext(text: string): void;

  getTranscript(): Array<{ role: 'user' | 'assistant'; text: string }>;

  disconnect(): void;
}

/** ========== 事件分发器接口 ========== */

export type VoiceClientEventHandler = (event: VoiceClientEvent) => void;
export type VoiceServerEventHandler = (event: VoiceServerEvent) => void;
export type VoiceErrorHandler = (error: Error) => void;
export type VoiceStateChangeHandler = (
  state: VoiceSessionState,
  previous: VoiceSessionState
) => void;

export interface VoiceEventBus {
  onClientEvent(handler: VoiceClientEventHandler): void;
  onServerEvent(handler: VoiceServerEventHandler): void;
  onError(handler: VoiceErrorHandler): void;
  onStateChange(handler: VoiceStateChangeHandler): void;
  emitToClient(event: VoiceServerEvent): void;
  emitToServer(event: VoiceClientEvent): void;
  emitError(error: Error): void;
  setState(state: VoiceSessionState): void;
  clear(): void;
}

/** ========== WebSocket 升级结果 ========== */

export interface VoiceConnection {
  id: string;
  connectedAt: number;

  send(event: VoiceServerEvent): void;

  onMessage(handler: (event: VoiceClientEvent) => void): void;

  onClose(handler: (code: number, reason: string) => void): void;

  onError(handler: (error: Error) => void): void;

  close(code?: number, reason?: string): void;
}

/** ========== 升级处理函数签名 ========== */

export type UpgradeHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => VoiceConnection | null;
