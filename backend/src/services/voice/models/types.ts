/**
 * 语音模块类型定义
 */

/**
 * 录音可用性状态
 */
export interface RecordingAvailability {
  /** 是否可用 */
  available: boolean;
  /** 不可用的原因 */
  reason: string | null;
}

/**
 * 语音依赖检查结果
 */
export interface VoiceDependencies {
  /** 是否可用 */
  available: boolean;
  /** 缺失的依赖 */
  missing: string[];
  /** 安装命令 */
  installCommand: string | null;
}

/**
 * 录音选项
 */
export interface RecordingOptions {
  /** 是否启用静音检测 */
  silenceDetection?: boolean;
}

/**
 * 语音识别结果
 */
export interface SpeechRecognitionResult {
  /** 识别的文本 */
  text: string;
  /** 置信度 */
  confidence: number;
}

/**
 * 语音服务配置
 */
export interface VoiceServiceConfig {
  /** 采样率 */
  sampleRate?: number;
  /** 声道数 */
  channels?: number;
  /** 静音检测阈值 */
  silenceThreshold?: string;
  /** 静音检测持续时间（秒） */
  silenceDuration?: string;
}
