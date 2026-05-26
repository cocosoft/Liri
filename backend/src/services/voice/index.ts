/**
 * 语音模块主入口
 * 统一导出所有语音相关类型、服务和工具
 */

import { VoiceService, createVoiceService } from './services/voiceService';
import type {
  RecordingAvailability,
  VoiceAvailability,
  VoiceDependencies,
  RecordingOptions,
  RecordingResult,
  RecordingStateHandler,
  SpeechRecognitionResult,
  VoiceInputResult,
  VoiceOutputOptions,
  VoiceServiceConfig,
  VoiceEventType,
  VoiceEvent,
  VoiceEventListener,
} from './models/types';

// 导出语音相关类型
export type {
  RecordingAvailability,
  VoiceAvailability,
  VoiceDependencies,
  RecordingOptions,
  RecordingResult,
  RecordingStateHandler,
  SpeechRecognitionResult,
  VoiceInputResult,
  VoiceOutputOptions,
  VoiceServiceConfig,
  VoiceEventType,
  VoiceEvent,
  VoiceEventListener,
};

// 导出语音服务类
export { VoiceService, createVoiceService };

// 导出语音关键词
export { getVoiceKeyterms, splitIdentifier } from './voiceKeyterms';

// 导出防止休眠
export {
  startPreventSleep,
  stopPreventSleep,
  forceStopPreventSleep,
} from './preventSleep';

// 导出 VAD 检测器
export { VadDetector } from './services/vadDetector';
export type { VadResult, VadOptions } from './services/vadDetector';

// 导出环境检测器
export { EnvironmentDetector } from './services/environmentDetector';
export type {
  EnvironmentType,
  EnvironmentResult,
  EnvironmentDetectorOptions,
} from './services/environmentDetector';

// 导出 TTS 提供者系统
export { TTSRegistry, EdgeTTSProvider } from './services/ttsProvider';
export type {
  TTSProvider,
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
} from './services/ttsProvider';

// 导出默认服务实例
const voiceService = createVoiceService();
export default voiceService;
