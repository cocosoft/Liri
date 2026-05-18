export { upgradeToVoiceConnection, isWebSocketUpgrade } from './upgrade';
export { VoiceEventBus } from './VoiceEventBus';
export { VoiceToolBridge } from './VoiceToolBridge';
export type { ToolExecutorDelegate } from './VoiceToolBridge';
export { VoiceSession } from './VoiceSession';
export { GeminiLiveAdapter } from './GeminiLiveAdapter';
export { OpenAIRealtimeAdapter } from './OpenAIRealtimeAdapter';
export { PCMAudioBuffer, AudioProcessor, AUDIO_FORMAT, DEFAULT_CHUNK_SIZE_BYTES } from './AudioPipeline';
export type { AudioBufferStats, AudioChunk } from './AudioPipeline';
export {
  handleVoiceUpgrade,
  getActiveVoiceSessions,
  getVoiceSession,
  getActiveVoiceSessionCount,
  closeAllVoiceSessions,
} from './VoiceGatewayBridge';

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
