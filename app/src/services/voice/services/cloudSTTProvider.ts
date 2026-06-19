/**
 * CloudSTTProvider
 * 云端 STT 提供者
 * 通过 OpenAI Whisper API 实现云端语音转文字
 *
 * 用法：
 * ```ts
 * import { CloudSTTProvider } from './cloudSTTProvider';
 * STTRegistry.register(new CloudSTTProvider({ apiKey: 'sk-xxx' }));
 * ```
 */

import { request as httpsRequest, RequestOptions } from 'https';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { STTProvider, STTStreamConnection } from './sttProvider';
import type {
  STTProviderType,
  STTResult,
  STTTranscribeOptions,
  STTStreamOptions,
} from '../models/types';

const logger = new Logger({});

/** OpenAI Whisper API 端点 */
const OPENAI_STT_ENDPOINT = 'api.openai.com';
const OPENAI_STT_PATH = '/v1/audio/transcriptions';

/** CloudSTTProvider 配置项 */
export interface CloudSTTConfig {
  /** OpenAI API 密钥 */
  apiKey: string;
  /** Whisper 模型名称（默认 whisper-1） */
  model?: string;
  /** API 基础 URL（用于自定义代理） */
  baseUrl?: string;
  /** 请求超时（毫秒，默认 60000） */
  timeout?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG = {
  model: 'whisper-1',
  timeout: 60000,
};

/**
 * 云端 STT 提供者
 * 通过 OpenAI Whisper API 实现语音转文字
 */
export class CloudSTTProvider implements STTProvider {
  readonly id = 'cloud';
  readonly name = 'OpenAI Whisper API';
  readonly type: STTProviderType = 'cloud';
  readonly supportsStreaming = false;
  readonly supportsKeyterms = true;

  private config: CloudSTTConfig;

  constructor(config: CloudSTTConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CloudSTTConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 检查提供者是否可用
   * 通过检测 API Key 是否存在来判断
   */
  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  /**
   * 文件级转录
   * 通过 multipart/form-data 将音频文件上传到 OpenAI Whisper API
   *
   * @param audioData 音频数据
   * @param options 转录选项
   */
  async transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<STTResult> {
    const model = options?.model || this.config.model || 'whisper-1';
    const language = options?.language;
    const keyterms = options?.keyterms;

    try {
      const formData = this.buildFormData(audioData, model, language, keyterms);
      const response = await this.makeRequest(formData);

      const parsed = JSON.parse(response.toString('utf8'));

      if (parsed.error) {
        throw new Error(parsed.error.message || JSON.stringify(parsed.error));
      }

      return {
        text: parsed.text || '',
        confidence: 1.0,
        isFinal: true,
        language: language,
        provider: 'cloud',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      void handleError(error, {
        module: 'services:voice:cloudSTT',
        action: 'transcribe',
      });

      return {
        text: '',
        confidence: 0,
        isFinal: true,
        provider: 'cloud',
      };
    }
  }

  /**
   * 构建 multipart/form-data 请求体
   */
  private buildFormData(
    audioData: Buffer,
    model: string,
    language?: string,
    keyterms?: string[]
  ): Buffer {
    const boundary = `----FormBoundary${randomHex()}`;
    const parts: Buffer[] = [];

    // model 字段
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="model"\r\n\r\n` +
          `${model}\r\n`
      )
    );

    // language 字段（可选）
    if (language) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="language"\r\n\r\n` +
            `${language}\r\n`
        )
      );
    }

    // prompt 字段（关键词提示）
    if (keyterms && keyterms.length > 0) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
            `${keyterms.join(', ')}\r\n`
        )
      );
    }

    // 音频文件
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
          `Content-Type: audio/wav\r\n\r\n`
      )
    );
    parts.push(audioData);
    parts.push(Buffer.from(`\r\n`));

    // 结束边界
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    return Buffer.concat(parts);
  }

  /**
   * 发起 HTTPS 请求到 OpenAI Whisper API
   */
  private makeRequest(formData: Buffer): Promise<Buffer> {
    const boundary = formData.toString('utf8', 2, 60).split('\r\n')[0];

    return new Promise((resolve, reject) => {
      const options: RequestOptions = {
        hostname: this.config.baseUrl || OPENAI_STT_ENDPOINT,
        path: OPENAI_STT_PATH,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': formData.length,
        },
        timeout: this.config.timeout,
      };

      const req = httpsRequest(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(buffer);
          } else {
            const errorText = buffer.toString('utf8');
            reject(new Error(`API 返回状态码 ${res.statusCode}: ${errorText}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(formData);
      req.end();
    });
  }

  /**
   * CloudSTTProvider 不支持流式转录
   */
  createStream(_options?: STTStreamOptions): STTStreamConnection {
    throw new Error('CloudSTTProvider 不支持流式转录');
  }
}

/**
 * 生成随机十六进制字符串用于 multipart boundary
 */
function randomHex(): string {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
