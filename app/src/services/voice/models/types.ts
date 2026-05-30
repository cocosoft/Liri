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
 * 语音模块类型定义
 * 统一合并自 voice.ts、VoiceService.ts、voiceService.ts 三套实现
 */

// ===================================================================
// 录音/依赖检查
// ===================================================================

/**
 * 录音可用性状态
 */
export interface RecordingAvailability {
  available: boolean;
  reason: string | null;
}

/**
 * 录音可用性（含录音方法，来自 voice.ts）
 */
export interface VoiceAvailability {
  available: boolean;
  method: string | null;
  missing: string[];
  installCommand: string | null;
}

/**
 * 语音依赖检查结果
 */
export interface VoiceDependencies {
  available: boolean;
  missing: string[];
  installCommand: string | null;
  /** 可用的录音方法（sox / arecord / powershell） */
  method: string | null;
}

/**
 * 录音结果
 */
export interface RecordingResult {
  filePath: string;
  durationMs: number;
  sampleRate: number;
  format: string;
}

/**
 * 录音选项
 */
export interface RecordingOptions {
  /** 是否启用静音检测 */
  silenceDetection?: boolean;
  /** 最大录音时长（秒） */
  maxDurationSecs?: number;
  /** 静音停止等待时长（秒） */
  silenceDurationSecs?: number;
  /** 静音检测阈值（百分比或绝对值） */
  silenceThreshold?: string;
  /** 音频设备名称 */
  device?: string;
}

/**
 * 录音状态监听器
 */
export type RecordingStateHandler = (state: string) => void;

// ===================================================================
// 语音识别/合成
// ===================================================================

/**
 * 语音识别结果
 */
export interface SpeechRecognitionResult {
  text: string;
  confidence: number;
}

/**
 * 语音输入结果（来自 VoiceService.ts）
 */
export interface VoiceInputResult {
  text: string;
  confidence: number;
  duration: number;
}

// ===================================================================
// STT（语音转文字）类型
// ===================================================================

/**
 * STT 提供者类型
 */
export type STTProviderType = 'local' | 'cloud' | 'stream';

/**
 * STT 转录选项
 */
export interface STTTranscribeOptions {
  /** 语言代码（如 zh-CN、en-US） */
  language?: string;
  /** 关键词/短语提示列表 */
  keyterms?: string[];
  /** 模型名称 */
  model?: string;
  /** 是否启用自动标点 */
  punctuation?: boolean;
  /** 请求超时（毫秒） */
  timeout?: number;
}

/**
 * STT 流式转录选项
 */
export interface STTStreamOptions {
  /** 语言代码 */
  language?: string;
  /** 关键词/短语提示列表 */
  keyterms?: string[];
  /** 模型名称 */
  model?: string;
  /** 是否返回中间结果 */
  interimResults?: boolean;
  /** 语音结束检测超时（毫秒） */
  endpointingMs?: number;
  /** 语句结束超时（毫秒） */
  utteranceEndMs?: number;
}

/**
 * STT 转录结果
 */
export interface STTResult {
  /** 转录文本 */
  text: string;
  /** 置信度（0-1） */
  confidence: number;
  /** 是否为最终结果（流式场景） */
  isFinal: boolean;
  /** 音频时长（秒） */
  duration?: number;
  /** 语言代码 */
  language?: string;
  /** 提供者名称 */
  provider?: string;
  /** 各语段详细结果 */
  segments?: STTSegment[];
}

/**
 * STT 语段详情
 */
export interface STTSegment {
  /** 语段文本 */
  text: string;
  /** 起始时间（秒） */
  start: number;
  /** 结束时间（秒） */
  end: number;
  /** 置信度 */
  confidence: number;
}

/**
 * STT 配置
 */
export interface STTConfig {
  /** 默认提供者 ID */
  defaultProvider?: string;
  /** 默认语言 */
  language?: string;
  /** 默认模型 */
  model?: string;
  /** 关键词列表 */
  keyterms?: string[];
  /** 是否启用自动标点 */
  punctuation?: boolean;
}

/**
 * 语音输出选项（来自 VoiceService.ts）
 */
export interface VoiceOutputOptions {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  /** 人设 ID（通过 TTSPersonaManager 解析语音配置） */
  personaId?: string;
}

// ===================================================================
// 配置
// ===================================================================

/**
 * 语音服务配置（来自 voiceService.ts + VoiceService.ts）
 */
export interface VoiceServiceConfig {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  silenceThreshold?: string | number;
  silenceDuration?: string | number;
  language?: string;
  /** 默认 STT 提供者 ID */
  sttProvider?: string;
  /** STT 语言 */
  sttLanguage?: string;
  /** STT 模型名称 */
  sttModel?: string;
  /** STT 关键词列表 */
  sttKeyterms?: string[];
}

// ===================================================================
// 事件系统（来自 VoiceService.ts）
// ===================================================================

/**
 * 语音事件类型
 */
export type VoiceEventType =
  | 'start'
  | 'stop'
  | 'data'
  | 'error'
  | 'volumeChange';

/**
 * 语音事件
 */
export interface VoiceEvent {
  type: VoiceEventType;
  data?: unknown;
  timestamp: number;
}

/**
 * 语音事件监听器
 */
export type VoiceEventListener = (event: VoiceEvent) => void;
