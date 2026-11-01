/**
 * TTS 模块共享类型
 * 从 ttsProvider.ts 提取，打破 ttsProvider ↔ edgeTTSProvider 循环依赖
 */

/** TTS 语音信息 */
export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female';
}

/** TTS 优先级（数字越小优先级越高） */
export enum TTSQueuePriority {
  /** 即时反馈（按钮音效、提示音） */
  IMMEDIATE = 0,
  /** 短文本回复（< 100 字符） */
  SHORT = 1,
  /** 正常 AI 回复 */
  NORMAL = 2,
  /** 长文本合成 */
  BATCH = 3,
}

/** TTS 合成选项 */
export interface TTSSpeakOptions {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
  /** 音频格式（如 'mp3', 'wav', 'opus'），仅对支持多格式的 Provider 生效 */
  format?: string;
  /** 队列优先级（仅启用 TTS 队列时生效） */
  priority?: TTSQueuePriority;
  /** 3.7/P2-4：取消信号，abort 时中断排队与进行中的合成（透传到 speakInternal） */
  signal?: AbortSignal;
}

/** TTS 合成结果 */
export interface TTSSpeakResult {
  /** 是否成功 */
  success: boolean;
  /** 音频时长（秒），仅 speak 动作返回 */
  audioDurationSec?: number;
  /** 音频二进制数据 */
  audioData?: Buffer;
  /** 音频格式（如 'wav', 'mp3', 'opus'），用于构造临时文件扩展名 */
  audioFormat?: string;
  /** 音频文件路径，仅 save 动作返回 */
  filePath?: string;
  /** 语音信息 */
  voice?: TTSVoice;
  /** 错误信息 */
  error?: string;
}

/** TTS 提供者接口 */
export interface TTSProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 支持的音频格式列表 */
  readonly supportedFormats: string[];
  /** 获取支持的语音列表 */
  getVoices(): TTSVoice[];
  /** 合成语音 */
  speak(options: TTSSpeakOptions): Promise<TTSSpeakResult>;
  /** 合成并保存到文件 */
  save?(
    options: TTSSpeakOptions & { filename: string }
  ): Promise<TTSSpeakResult>;
  /** 停止合成 */
  stop?(): void;
  /** 流式合成（可选），边合成边回调音频块 */
  createStream?(options: TTSSpeakOptions): TTSStream;
}

/** 流式 TTS 合成接口 */
export interface TTSStream {
  /** 音频块回调（isLast=true 表示最后一块） */
  onData(callback: (chunk: Buffer, isLast: boolean) => void): void;
  /** 错误回调 */
  onError(callback: (error: Error) => void): void;
  /** 取消流式合成 */
  cancel(): void;
}
