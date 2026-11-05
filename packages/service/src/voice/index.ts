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
export { upgradeToVoiceConnection, isWebSocketUpgrade } from './upgrade';
export {
  VoiceServiceBridge,
  createVoiceServiceBridge,
  resetVoiceServiceBridge,
} from './VoiceServiceBridge';
export type {
  VoiceBridgeConfig,
  VoiceBridgeStatus,
} from './VoiceServiceBridge';
export { VoiceEventBus } from './VoiceEventBus';
export { VoiceToolBridge } from './VoiceToolBridge';
export type { ToolExecutorDelegate } from './VoiceToolBridge';
export { VoiceSession } from './VoiceSession';
export { GeminiLiveAdapter } from './GeminiLiveAdapter';
export { OpenAIRealtimeAdapter } from './OpenAIRealtimeAdapter';
export {
  PCMAudioBuffer,
  AudioProcessor,
  AUDIO_FORMAT,
  DEFAULT_CHUNK_SIZE_BYTES,
} from './AudioPipeline';
export type { AudioBufferStats, AudioChunk } from './AudioPipeline';
export {
  handleVoiceUpgrade,
  getActiveVoiceSessions,
  getVoiceSession,
  getActiveVoiceSessionCount,
  closeAllVoiceSessions,
} from './VoiceGatewayBridge';

export {
  loadVoiceWakeConfig,
  setVoiceWakeTriggers,
  detectWakeWord,
  defaultVoiceWakeTriggers,
  sanitizeTriggers,
  startWakeListening,
  stopWakeListening,
  isWakeListening,
  feedWakeAudio,
  onWake,
  resetWakeManager,
} from './VoiceWakeManager';
export type { VoiceWakeConfig } from './VoiceWakeManager';
export type { WakeDetectionResult } from './types';

export { WakeWordEngine } from './WakeWordEngine';
export type {
  WakeWordResult,
  WakeWordEngineConfig,
  WakeWordEngineStatus,
} from './WakeWordEngine';

export type {
  VoiceClientEvent,
  VoiceServerEvent,
  VoiceSessionConfigEvent,
  VoiceAudioAppendEvent,
  VoiceAudioCommitEvent,
  VoiceFrameAppendEvent,
  VoiceResponseCreateEvent,
  VoiceResponseCancelEvent,
  VoiceToolResultEvent,
  VoiceSessionReadyEvent,
  VoiceAudioDeltaEvent,
  VoiceTranscriptDeltaEvent,
  VoiceTranscriptDoneEvent,
  VoiceToolCallEvent,
  VoiceToolProgressEvent,
  VoiceToolCancelledEvent,
  VoiceTurnStartedEvent,
  VoiceTurnEndedEvent,
  VoiceSessionEndedEvent,
  VoiceSessionRotatingEvent,
  VoiceSessionRotatedEvent,
  VoiceUsageMetricsEvent,
  VoiceLatencyMetricsEvent,
  VoiceErrorEvent,
  VoiceSessionState,
  VoiceSessionSummary,
  VoiceToolDeclaration,
  VoiceProviderAdapter,
  VoiceClientEventHandler,
  VoiceServerEventHandler,
  VoiceErrorHandler,
  VoiceStateChangeHandler,
  VoiceConnection,
  UpgradeHandler,
} from './types';

export type { VoiceEventBus as VoiceEventBusInterface } from './types';

export { VoiceChannelIntegration } from './VoiceChannelIntegration';
export type {
  VoiceChannelConfig,
  VoiceChannelMessageOptions,
  VoiceChannelStatus,
} from './VoiceChannelIntegration';

export { VoiceCommandRouter } from './VoiceCommandRouter';
export type {
  CommandActionType,
  VoiceCommandRule,
  VoiceCommandRouterConfig,
  CommandRoutingResult,
} from './VoiceCommandRouter';
