/**
 * StreamSTTProvider
 * 流式 STT 提供者
 * 通过 WebSocket 实现实时流式语音转文字
 *
 * 支持两种接入模式：
 * 1. Anthropic voice_stream 端点（OAuth Bearer 认证）
 * 2. 自定义 WebSocket 端点（自定义认证头）
 *
 * 用法：
 * ```ts
 * import { StreamSTTProvider } from './streamSTTProvider';
 * STTRegistry.register(new StreamSTTProvider({ apiKey: 'sk-xxx' }));
 * ```
 */

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

/** KeepAlive 消息间隔（毫秒） */
const KEEPALIVE_INTERVAL_MS = 8_000;

/** finalize 超时配置（毫秒） */
const FINALIZE_TIMEOUTS = {
  safety: 5_000,
  noData: 1_500,
};

/**
 * WebSocket URL 构建策略
 * 不同 STT 服务商可通过实现此接口定制端点 URL
 */
export interface WsUrlBuilder {
  /** 根据选项构建 WebSocket 端点 URL */
  buildWsUrl(options?: STTStreamOptions): string;
}

/**
 * Anthropic voice_stream URL 构建策略
 * 构建 wss://api.anthropic.com/api/ws/speech_to_text/voice_stream 端点
 */
export class AnthropicWsUrlBuilder implements WsUrlBuilder {
  /** Anthropic voice_stream 路径 */
  private static readonly STREAM_PATH = '/api/ws/speech_to_text/voice_stream';

  private config: {
    encoding?: string;
    sampleRate?: number;
    channels?: number;
    endpointingMs?: number;
    utteranceEndMs?: number;
  };

  constructor(config?: {
    encoding?: string;
    sampleRate?: number;
    channels?: number;
    endpointingMs?: number;
    utteranceEndMs?: number;
  }) {
    this.config = config || {};
  }

  buildWsUrl(options?: STTStreamOptions): string {
    const params = new URLSearchParams({
      encoding: this.config.encoding || 'linear16',
      sample_rate: String(this.config.sampleRate || 16000),
      channels: String(this.config.channels || 1),
      endpointing_ms: String(this.config.endpointingMs || 300),
      utterance_end_ms: String(this.config.utteranceEndMs || 1000),
      language: options?.language ? options.language.split('-')[0] : 'en',
    });

    if (options?.keyterms?.length) {
      for (const term of options.keyterms) {
        params.append('keyterms', term);
      }
    }

    return `wss://api.anthropic.com${AnthropicWsUrlBuilder.STREAM_PATH}?${params.toString()}`;
  }
}

/** 流式连接来源类型 */
type FinalizeSource =
  | 'post_closestream_endpoint'
  | 'no_data_timeout'
  | 'safety_timeout'
  | 'ws_close'
  | 'ws_already_closed';

/** WebSocket 构造选项（Bun 运行时支持自定义 headers） */
interface WebSocketOptions {
  headers?: Record<string, string>;
}

/**
 * 创建 WebSocket 连接
 * Bun 运行时支持在第二个参数中传入 headers，而浏览器标准 WebSocket 仅支持 protocol。
 * 本函数通过 try-catch 兼容两种运行时，对外暴露类型安全的接口。
 *
 * @param url  WebSocket 端点 URL
 * @param options  可选的 headers 等扩展参数（Bun 特有）
 * @returns WebSocket 实例
 */
function createWebSocket(url: string, options?: WebSocketOptions): WebSocket {
  try {
    return new (WebSocket as new (
      url: string,
      options?: WebSocketOptions
    ) => WebSocket)(url, options);
  } catch {
    return new WebSocket(url);
  }
}

/** voice_stream 协议消息类型 */
interface TranscriptTextMessage {
  type: 'TranscriptText';
  data: string;
}

interface TranscriptEndpointMessage {
  type: 'TranscriptEndpoint';
}

interface TranscriptErrorMessage {
  type: 'TranscriptError';
  error_code?: string;
  description?: string;
}

type StreamMessage =
  | TranscriptTextMessage
  | TranscriptEndpointMessage
  | TranscriptErrorMessage
  | { type: 'error'; message?: string };

/** StreamSTTProvider 配置项 */
export interface StreamSTTConfig {
  /** API 密钥（Anthropic OAuth 或自定义） */
  apiKey?: string;
  /** 认证方式 */
  authType?: 'oauth' | 'bearer' | 'none';
  /** 自定义 WebSocket URL（优先使用） */
  wsUrl?: string;
  /** 自定义 WebSocket URL 构建策略（默认 AnthropicWsUrlBuilder） */
  urlBuilder?: WsUrlBuilder;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 音频编码格式 */
  encoding?: string;
  /** 采样率 */
  sampleRate?: number;
  /** 声道数 */
  channels?: number;
  /** 端点检测静音时长（毫秒） */
  endpointingMs?: number;
  /** 语句结束超时（毫秒） */
  utteranceEndMs?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: StreamSTTConfig = {
  authType: 'bearer',
  encoding: 'linear16',
  sampleRate: 16000,
  channels: 1,
  endpointingMs: 300,
  utteranceEndMs: 1000,
};

/**
 * 流式 STT 提供者
 * 通过 WebSocket 实现实时语音转文字流式转录
 */
export class StreamSTTProvider implements STTProvider {
  readonly id = 'stream';
  readonly name = 'Streaming STT';
  readonly type: STTProviderType = 'stream';
  readonly supportsStreaming = true;
  readonly supportsKeyterms = true;

  private config: StreamSTTConfig;
  private activeConnection: StreamSTTConnectionImpl | null = null;
  private _urlBuilder: WsUrlBuilder;

  /** 可用性缓存 TTL（毫秒） */
  private static readonly AVAILABILITY_TTL = 60_000;

  /** 上次探测时间戳 */
  private _lastProbeAt = 0;

  /** 缓存的最新可用性结果 */
  private _cachedAvailable = false;

  /** 进行中的探测 Promise */
  private _pendingProbe: Promise<void> | null = null;

  constructor(config: StreamSTTConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._urlBuilder =
      config.urlBuilder || new AnthropicWsUrlBuilder(this.config);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<StreamSTTConfig>): void {
    this.config = { ...this.config, ...config };
    // 配置变更时重置缓存，下次 isAvailable() 将重新探测
    this._lastProbeAt = 0;
    this._cachedAvailable = false;
  }

  /**
   * 检查提供者是否可用
   *
   * 先返回缓存结果（如有），否则触发异步 WebSocket 连接探测并返回配置级可用性。
   * 探测完成后自动更新缓存，后续调用返回真实结果。
   */
  isAvailable(): boolean {
    // 缓存有效期内直接返回探测结果
    if (Date.now() - this._lastProbeAt < StreamSTTProvider.AVAILABILITY_TTL) {
      return this._cachedAvailable;
    }

    // 无配置肯定不可用
    if (!this.config.wsUrl && !this.config.apiKey) {
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
    return !!(this.config.wsUrl || this.config.apiKey);
  }

  /**
   * 轻量 WebSocket 连接探测
   *
   * 建立临时 WebSocket 连接验证端点可达，连接成功后立即关闭。
   * 超时 3 秒，不阻塞 UI。
   */
  private probeConnection(timeoutMs = 3000): Promise<boolean> {
    const wsUrl = this.config.wsUrl || this.buildWsUrl();
    const headers = this.buildHeaders();

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, timeoutMs);

      try {
        const ws = createWebSocket(wsUrl, { headers });

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
      } catch {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  /**
   * 文件级转录
   * StreamSTTProvider 不推荐用于文件转录，建议使用 CloudSTTProvider
   * 此处作为 fallback 实现：建立临时流式连接发送完整音频
   *
   * @param audioData 音频数据
   * @param options 转录选项
   */
  async transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<STTResult> {
    const streamOptions: STTStreamOptions = {
      language: options?.language,
      keyterms: options?.keyterms,
      model: options?.model,
    };

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.stream.stt.transcribe',
        attributes: {
          audioSize: audioData.length,
          language: options?.language || 'auto',
        },
      },
      async () => {
        try {
          const text = await this.transcribeViaStream(audioData, streamOptions);

          return {
            text,
            confidence: 1.0,
            isFinal: true,
            language: options?.language,
            provider: 'stream',
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          void handleError(error, {
            module: 'services:voice:streamSTT',
            action: 'transcribe',
          });

          return {
            text: '',
            confidence: 0,
            isFinal: true,
            provider: 'stream',
            error: { code: 'TRANSCRIBE_FAILED', message: errorMsg },
          };
        }
      }
    );
  }

  /**
   * 通过临时流式连接转录完整音频文件
   */
  private transcribeViaStream(
    audioData: Buffer,
    options: STTStreamOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const transcripts: string[] = [];
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const stream = this.createStreamInternal(options);
      const chunkSize = 32_000;

      stream.onTranscript((text, isFinal) => {
        if (isFinal && text.trim()) {
          transcripts.push(text.trim());
        }
      });

      stream.onError((error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });

      stream.onEnd(() => {
        if (timeout) clearTimeout(timeout);
        resolve(transcripts.join(' '));
      });

      timeout = setTimeout(() => {
        stream.close();
        resolve(transcripts.join(' '));
      }, 120_000);

      // 异步流式发送音频块，每 4 个块让出事件循环，避免阻塞主线程
      (async () => {
        let offset = 0;
        while (offset < audioData.length) {
          const chunk = audioData.subarray(offset, offset + chunkSize);
          stream.send(Buffer.from(chunk));
          offset += chunkSize;
          // 每发送 4 个块让出事件循环，防止 WebSocket 发送缓冲区膨胀及主线程阻塞
          if (offset % (chunkSize * 4) === 0) {
            await new Promise<void>((r) => setImmediate(r));
          }
        }
        stream.finalize();
      })().catch((error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * 创建流式转录连接
   *
   * @param options 流式选项
   * @returns 流式连接接口
   */
  createStream(options?: STTStreamOptions): STTStreamConnection {
    const connection = this.createStreamInternal(options);
    this.activeConnection = connection;
    return connection;
  }

  /**
   * 创建内部流式连接
   */
  private createStreamInternal(
    options?: STTStreamOptions
  ): StreamSTTConnectionImpl {
    const wsUrl = this.buildWsUrl(options);
    const headers = this.buildHeaders();

    return new StreamSTTConnectionImpl(wsUrl, headers, options || {});
  }

  /**
   * 构建 WebSocket URL
   * 优先使用 config.wsUrl（自定义端点），否则委托给 urlBuilder 策略
   */
  private buildWsUrl(options?: STTStreamOptions): string {
    if (this.config.wsUrl) {
      return this.config.wsUrl;
    }
    return this._urlBuilder.buildWsUrl(options);
  }

  /**
   * 构建请求头
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Liri/1.0',
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }
}

/**
 * 流式 STT 连接实现
 * 管理 WebSocket 生命周期、KeepAlive、CloseStream 协议
 */
class StreamSTTConnectionImpl implements STTStreamConnection {
  private ws: WebSocket | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private finalized = false;
  private finalizing = false;
  private upgradeRejected = false;

  private resolveFinalize: ((source: FinalizeSource) => void) | null = null;
  private cancelNoDataTimer: (() => void) | null = null;

  private transcriptCallbacks: Array<(text: string, isFinal: boolean) => void> =
    [];
  private errorCallbacks: Array<(error: Error) => void> = [];
  private endCallbacks: Array<() => void> = [];

  private lastTranscriptText = '';

  constructor(
    private wsUrl: string,
    private headers: Record<string, string>,
    private options: STTStreamOptions
  ) {
    this.connect();
  }

  /**
   * 建立 WebSocket 连接
   */
  private connect(): void {
    this.ws = createWebSocket(this.wsUrl, { headers: this.headers });

    if (!this.ws) {
      this.connected = false;
      return;
    }
    const ws = this.ws;

    ws.onopen = () => {
      this.connected = true;

      ws.send(JSON.stringify({ type: 'KeepAlive' }));

      this.keepaliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, KEEPALIVE_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      const raw =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as BufferSource);
      let msg: StreamMessage;

      try {
        msg = JSON.parse(raw) as StreamMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'TranscriptText': {
          const transcript = msg.data || '';
          if (transcript) {
            this.lastTranscriptText = transcript;
            this.emitTranscript(transcript, false);
          }
          break;
        }
        case 'TranscriptEndpoint': {
          const finalText = this.lastTranscriptText;
          this.lastTranscriptText = '';
          if (finalText) {
            this.emitTranscript(finalText, true);
          }
          if (this.finalized) {
            this.resolveFinalize?.('post_closestream_endpoint');
          }
          break;
        }
        case 'TranscriptError': {
          const desc = msg.description || msg.error_code || '转录错误';
          if (!this.finalizing) {
            this.emitError(new Error(desc));
          }
          break;
        }
        case 'error': {
          const detail = msg.message || JSON.stringify(msg);
          if (!this.finalizing) {
            this.emitError(new Error(detail));
          }
          break;
        }
      }
    };

    ws.onerror = () => {
      this.connected = false;
      if (!this.finalizing) {
        this.emitError(new Error('WebSocket 连接错误'));
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.clearKeepalive();

      if (this.lastTranscriptText) {
        const finalText = this.lastTranscriptText;
        this.lastTranscriptText = '';
        this.emitTranscript(finalText, true);
      }

      this.resolveFinalize?.('ws_close');
      this.emitEnd();
    };
  }

  /**
   * 发送音频块
   * 将音频数据发送到 WebSocket 服务端
   *
   * @param chunk 音频数据块
   */
  send(chunk: Buffer): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.finalized) {
      return;
    }

    ws.send(Buffer.from(chunk));
  }

  /**
   * 标记音频结束
   * 发送 CloseStream 消息并等待服务端处理完成
   *
   * @returns 解析为连接关闭来源
   */
  finalize(): Promise<string> {
    if (this.finalizing || this.finalized) {
      return Promise.resolve('ws_already_closed');
    }

    this.finalizing = true;

    return new Promise<FinalizeSource>((resolve) => {
      const safetyTimer = setTimeout(
        () => this.resolveFinalize?.('safety_timeout'),
        FINALIZE_TIMEOUTS.safety
      );

      const noDataTimer = setTimeout(
        () => this.resolveFinalize?.('no_data_timeout'),
        FINALIZE_TIMEOUTS.noData
      );

      this.cancelNoDataTimer = () => {
        clearTimeout(noDataTimer);
        this.cancelNoDataTimer = null;
      };

      this.resolveFinalize = (source: FinalizeSource) => {
        clearTimeout(safetyTimer);
        clearTimeout(noDataTimer);
        this.resolveFinalize = null;
        this.cancelNoDataTimer = null;

        if (this.lastTranscriptText) {
          const t = this.lastTranscriptText;
          this.lastTranscriptText = '';
          this.emitTranscript(t, true);
        }

        resolve(source);
      };

      if (
        !this.ws ||
        this.ws.readyState === WebSocket.CLOSED ||
        this.ws.readyState === WebSocket.CLOSING
      ) {
        this.resolveFinalize('ws_already_closed');
        return;
      }

      const ws = this.ws;
      setTimeout(() => {
        this.finalized = true;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
      }, 0);
    }).then((source) => source);
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.finalized = true;
    this.clearKeepalive();
    this.connected = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    this.ws = null;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected && !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 注册中间结果回调
   *
   * @param callback 回调函数（文本，是否最终结果）
   */
  onTranscript(callback: (text: string, isFinal: boolean) => void): void {
    this.transcriptCallbacks.push(callback);
  }

  /**
   * 注册错误回调
   *
   * @param callback 回调函数
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * 注册结束回调
   *
   * @param callback 回调函数
   */
  onEnd(callback: () => void): void {
    this.endCallbacks.push(callback);
  }

  /**
   * 触发转录回调
   */
  private emitTranscript(text: string, isFinal: boolean): void {
    for (const cb of this.transcriptCallbacks) {
      try {
        cb(text, isFinal);
      } catch {
        // 回调异常不影响其他回调
      }
    }
  }

  /**
   * 触发错误回调
   */
  private emitError(error: Error): void {
    for (const cb of this.errorCallbacks) {
      try {
        cb(error);
      } catch {
        // 回调异常不影响其他回调
      }
    }
  }

  /**
   * 触发结束回调
   */
  private emitEnd(): void {
    for (const cb of this.endCallbacks) {
      try {
        cb();
      } catch {
        // 回调异常不影响其他回调
      }
    }
  }

  /**
   * 清理 KeepAlive 定时器
   */
  private clearKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
