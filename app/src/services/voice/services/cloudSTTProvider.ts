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
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
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

  /** 可用性缓存 TTL（毫秒） */
  private static readonly AVAILABILITY_TTL = 60_000;

  /** 预编译 multipart 固定字段模板（不含 boundary 前缀） */
  private static readonly FIELD_MODEL_HEADER = Buffer.from(
    '\r\nContent-Disposition: form-data; name="model"\r\n\r\n'
  );
  private static readonly FIELD_LANG_HEADER = Buffer.from(
    '\r\nContent-Disposition: form-data; name="language"\r\n\r\n'
  );
  private static readonly FIELD_PROMPT_HEADER = Buffer.from(
    '\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n'
  );
  private static readonly FIELD_FILE_HEADER = Buffer.from(
    '\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n'
  );
  private static readonly FIELD_CRLF = Buffer.from('\r\n');
  private static readonly FIELD_BOUNDARY_PREFIX = Buffer.from('--');

  /** 上次探测时间戳 */
  private _lastProbeAt = 0;

  /** 缓存的最新可用性结果 */
  private _cachedAvailable = false;

  /** 进行中的探测 Promise */
  private _pendingProbe: Promise<void> | null = null;

  constructor(config: CloudSTTConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CloudSTTConfig>): void {
    this.config = { ...this.config, ...config };
    // 配置变更时重置缓存，下次 isAvailable() 将重新探测
    this._lastProbeAt = 0;
    this._cachedAvailable = false;
  }

  /**
   * 检查提供者是否可用
   *
   * 先返回缓存结果（如有），否则触发异步探测并返回配置级可用性。
   * 探测完成后自动更新缓存，后续调用返回真实结果。
   */
  isAvailable(): boolean {
    // 缓存有效期内直接返回探测结果
    if (Date.now() - this._lastProbeAt < CloudSTTProvider.AVAILABILITY_TTL) {
      return this._cachedAvailable;
    }

    // 无 API Key 肯定不可用
    if (!this.config.apiKey) {
      return false;
    }

    // 异步触发探测（不阻塞当前调用）
    if (!this._pendingProbe) {
      this._pendingProbe = this.probeConnection()
        .then((available) => {
          this._cachedAvailable = available;
          this._lastProbeAt = Date.now();
          this._pendingProbe = null;
        })
        .catch(() => {
          this._cachedAvailable = false;
          this._lastProbeAt = Date.now();
          this._pendingProbe = null;
        });
    }

    // 首次调用：缓存未初始化，返回配置级检查结果
    return !!this.config.apiKey;
  }

  /**
   * 轻量 API 连通性探测
   *
   * 向 Whisper API 发送 GET 请求验证端点可达且 API Key 有效。
   * 超时 3 秒，不阻塞 UI。
   */
  private async probeConnection(timeoutMs = 3000): Promise<boolean> {
    const baseUrl = this.config.baseUrl ?? `https://${OPENAI_STT_ENDPOINT}`;
    const modelsUrl = `${baseUrl.replace(/\/+$/, '')}/v1/models`;

    try {
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
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

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.cloud.stt.transcribe',
        attributes: {
          model,
          language: language || 'auto',
          audioSize: audioData.length,
        },
      },
      async () => {
        try {
          const formData = this.buildFormData(
            audioData,
            model,
            language,
            keyterms
          );
          const response = await this.makeRequest(formData);

          const parsed = JSON.parse(response.toString('utf8'));

          if (parsed.error) {
            throw new Error(
              parsed.error.message || JSON.stringify(parsed.error)
            );
          }

          return {
            text: parsed.text || '',
            confidence: 1.0,
            isFinal: true,
            language: language,
            provider: 'cloud',
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          void handleError(error, {
            module: 'services:voice:cloudSTT',
            action: 'transcribe',
          });

          return {
            text: '',
            confidence: 0,
            isFinal: true,
            provider: 'cloud',
            error: { code: 'TRANSCRIBE_FAILED', message: errorMsg },
          };
        }
      }
    )();
  }

  /**
   * 构建 multipart/form-data 请求体
   *
   * 使用预编译的固定 Buffer 模板，减少每次转录时的 Buffer 分配。
   */
  private buildFormData(
    audioData: Buffer,
    model: string,
    language?: string,
    keyterms?: string[]
  ): Buffer {
    const boundary = `----FormBoundary${randomHex()}`;
    const boundaryBytes = Buffer.from(boundary);
    const parts: Buffer[] = [];

    // --boundary + model 字段
    parts.push(CloudSTTProvider.FIELD_BOUNDARY_PREFIX);
    parts.push(boundaryBytes);
    parts.push(CloudSTTProvider.FIELD_MODEL_HEADER);
    parts.push(Buffer.from(model));
    parts.push(CloudSTTProvider.FIELD_CRLF);

    // language 字段（可选）
    if (language) {
      parts.push(CloudSTTProvider.FIELD_BOUNDARY_PREFIX);
      parts.push(boundaryBytes);
      parts.push(CloudSTTProvider.FIELD_LANG_HEADER);
      parts.push(Buffer.from(language));
      parts.push(CloudSTTProvider.FIELD_CRLF);
    }

    // prompt 字段（关键词提示，可选）
    if (keyterms && keyterms.length > 0) {
      parts.push(CloudSTTProvider.FIELD_BOUNDARY_PREFIX);
      parts.push(boundaryBytes);
      parts.push(CloudSTTProvider.FIELD_PROMPT_HEADER);
      parts.push(Buffer.from(keyterms.join(', ')));
      parts.push(CloudSTTProvider.FIELD_CRLF);
    }

    // --boundary + file 字段 + 音频数据
    parts.push(CloudSTTProvider.FIELD_BOUNDARY_PREFIX);
    parts.push(boundaryBytes);
    parts.push(CloudSTTProvider.FIELD_FILE_HEADER);
    parts.push(audioData);
    parts.push(CloudSTTProvider.FIELD_CRLF);

    // --boundary-- 结束
    parts.push(CloudSTTProvider.FIELD_BOUNDARY_PREFIX);
    parts.push(boundaryBytes);
    parts.push(Buffer.from('--\r\n'));

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
 * 使用 crypto.randomUUID() 替代 Math.random()
 */
function randomHex(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
