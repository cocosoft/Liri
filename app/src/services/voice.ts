/**
 * @deprecated 请使用 @modules/services/voice（services/voice/index.ts）替代
 * 此文件保留作为重导出垫片，确保存量引用不受影响
 */

import voiceService from './voice/index';

export { createVoiceService } from './voice/index';

export type {
  RecordingAvailability,
  VoiceAvailability,
  VoiceDependencies,
  RecordingOptions,
  RecordingResult,
  RecordingStateHandler,
} from './voice/index';

export default voiceService;
