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

/** TTS 合成选项 */
export interface TTSSpeakOptions {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
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
}
