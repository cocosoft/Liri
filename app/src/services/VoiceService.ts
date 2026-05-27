/**
 * @deprecated 请使用 @modules/services/voice（services/voice/index.ts）替代
 * 此文件保留作为重导出垫片，确保存量引用不受影响
 */

import voiceService from './voice/index';

export type {
  VoiceServiceConfig,
  VoiceInputResult,
  VoiceOutputOptions,
  VoiceEventType,
  VoiceEvent,
  VoiceEventListener,
} from './voice/models/types';

export {
  VoiceService,
  createVoiceService,
} from './voice/services/voiceService';

export { voiceService };

export default voiceService;
