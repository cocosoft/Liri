/**
 * STT 插件化提供者系统
 *
 * 定义 STT（语音转文字）提供者接口和流式连接接口。
 * 支持文件级转录和流式转录两种模式。
 *
 * 用法：
 * ```ts
 * import { STTRegistry } from './sttRegistry';
 * import { LocalSTTProvider } from './localSTTProvider';
 *
 * STTRegistry.register(new LocalSTTProvider());
 * const result = await STTRegistry.transcribe(audioBuffer);
 * ```
 */

import type {
  STTProviderType,
  STTResult,
  STTTranscribeOptions,
  STTStreamOptions,
} from '../models/types';

/**
 * 流式 STT 连接接口
 * 参考：CC_CODE VoiceStreamConnection
 */
export interface STTStreamConnection {
  /** 发送音频块 */
  send(chunk: Buffer): void;
  /** 标记音频结束 */
  finalize(): void;
  /** 关闭连接 */
  close(): void;
  /** 是否已连接 */
  isConnected(): boolean;
  /** 中间结果回调 */
  onTranscript(callback: (text: string, isFinal: boolean) => void): void;
  /** 错误回调 */
  onError(callback: (error: Error) => void): void;
  /** 结束回调 */
  onEnd(callback: () => void): void;
}

/**
 * STT 提供者接口
 */
export interface STTProvider {
  /** 提供者唯一标识 */
  readonly id: string;
  /** 提供者显示名称 */
  readonly name: string;
  /** 提供者类型 */
  readonly type: STTProviderType;
  /** 是否支持流式转录 */
  readonly supportsStreaming: boolean;
  /** 是否支持关键词增强 */
  readonly supportsKeyterms: boolean;

  /**
   * 检查提供者是否可用
   * @returns true 表示提供者已配置且可正常使用
   */
  isAvailable(): boolean;

  /**
   * 文件级转录
   * @param audioData 音频数据（PCM/WAV）
   * @param options 转录选项
   * @returns 转录结果
   */
  transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<STTResult>;

  /**
   * 创建流式转录连接
   * @param options 流式选项
   * @returns 流式连接
   */
  createStream?(options?: STTStreamOptions): STTStreamConnection;
}
