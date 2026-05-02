/**
 * 语音模块主入口
 */

import { VoiceService, createVoiceService } from './services/voiceService';
import type {
  RecordingAvailability,
  VoiceDependencies,
  RecordingOptions,
  SpeechRecognitionResult,
  VoiceServiceConfig,
} from './models/types';

// 导出语音相关类型和服务
export {
  VoiceService,
  createVoiceService,
  RecordingAvailability,
  VoiceDependencies,
  RecordingOptions,
  SpeechRecognitionResult,
  VoiceServiceConfig,
};

// 导出语音关键词
export { getVoiceKeyterms, splitIdentifier } from './voiceKeyterms';

// 导出防止休眠
export {
  startPreventSleep,
  stopPreventSleep,
  forceStopPreventSleep,
} from './preventSleep';

// 导出默认服务实例
const voiceService = createVoiceService();
export default voiceService;
