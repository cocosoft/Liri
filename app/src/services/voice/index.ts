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
 * 语音模块主入口
 * 统一导出所有语音相关类型、服务和工具
 */

import { VoiceService, createVoiceService } from './services/voiceService';
import type {
  VoiceDependencies,
  RecordingOptions,
  RecordingResult,
  RecordingStateHandler,
  VoiceOutputOptions,
  VoiceServiceConfig,
  VoiceEventType,
  VoiceEvent,
  VoiceEventListener,
  STTProviderType,
  STTResult,
  STTSegment,
  STTConfig,
  STTTranscribeOptions,
  STTStreamOptions,
} from './models/types';

// 导出语音相关类型
export type {
  VoiceDependencies,
  RecordingOptions,
  RecordingResult,
  RecordingStateHandler,
  VoiceOutputOptions,
  VoiceServiceConfig,
  VoiceEventType,
  VoiceEvent,
  VoiceEventListener,
  STTProviderType,
  STTResult,
  STTSegment,
  STTConfig,
  STTTranscribeOptions,
  STTStreamOptions,
};

/** @deprecated 已合并至 VoiceDependencies */
export type RecordingAvailability = VoiceDependencies;
/** @deprecated 已合并至 VoiceDependencies */
export type VoiceAvailability = VoiceDependencies;
/** @deprecated 已统一为 STTResult */
export type SpeechRecognitionResult = STTResult;
/** @deprecated 已统一为 STTResult */
export type VoiceInputResult = STTResult;

// 导出语音服务类
export { VoiceService, createVoiceService };

// 导出 STT 提供者系统
export { STTRegistry } from './services/sttRegistry';
export type { STTProvider, STTStreamConnection } from './services/sttProvider';

// 导出 STT 提供者实现
export { LocalSTTProvider } from './services/localSTTProvider';
export type { LocalSTTConfig } from './services/localSTTProvider';

export { CloudSTTProvider } from './services/cloudSTTProvider';
export type { CloudSTTConfig } from './services/cloudSTTProvider';

export { StreamSTTProvider } from './services/streamSTTProvider';
export type { StreamSTTConfig } from './services/streamSTTProvider';

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
export { TTSRegistry, TTSQueuePriority } from './services/ttsProvider';
export { EdgeTTSProvider } from './services/edgeTTSProvider';
export type {
  TTSProvider,
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
} from './services/ttsProvider';

// 导出 OpenAI TTS 提供者
export { OpenAITTSProvider } from './services/openAITTSProvider';
export type { OpenAITTSConfig } from './services/openAITTSProvider';
export { PiperTTSProvider } from './services/piperTTSProvider';
export type { PiperTTSConfig } from './services/piperTTSProvider';

// 导出 TTS 多级配置覆盖
export {
  TTSConfigOverlay,
  getDefaultConfigOverlay,
  resetDefaultConfigOverlay,
} from './services/ttsConfigOverlay';
export type {
  TTSGlobalConfig,
  ResolvedTTSConfig,
} from './services/ttsConfigOverlay';

// 导出 TTS 人设管理
export { TTSPersonaManager } from './services/ttsPersonaManager';
export type {
  TTSPersona,
  CreatePersonaOptions,
} from './services/ttsPersonaManager';

// 导出音频电平表
export { AudioLevelMeter } from './services/audioLevelMeter';
export type {
  LevelResult,
  LevelCategory,
  LevelCallback,
} from './services/audioLevelMeter';

// 导出音频格式转换器
export {
  AudioFormatConverter,
  isFFmpegAvailable,
  resetFFmpegCache,
  getFormatInfo,
} from './services/audioFormatConverter';
export type {
  AudioFormat,
  AudioConvertOptions,
  AudioConvertResult,
  AudioFormatInfo,
} from './services/audioFormatConverter';

// 导出命令 TTS 提供者
export {
  CommandTTSProvider,
  resetCommandBackendCache,
} from './services/commandTTSProvider';

// 导出音频设备类型（AudioDeviceManager 类已删除）
export type {
  AudioDevice,
  AudioDeviceConfig,
} from './services/audioDeviceManager';

// 导出运行时环境检测器
export {
  detectRuntimeEnvironment,
  resetRuntimeEnvironmentCache,
  isVoiceAvailable,
} from './services/environmentRuntimeDetector';
export type {
  RuntimeEnvironment,
  RuntimeEnvironmentResult,
} from './services/environmentRuntimeDetector';

// 导出默认服务实例
const voiceService = createVoiceService();
export default voiceService;
