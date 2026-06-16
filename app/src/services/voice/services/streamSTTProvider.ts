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

import { Logger } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
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

/** Anthropic voice_stream 路径 */
const ANTHROPIC_STREAM_PATH = '/api/ws/speech_to_text/voice_stream';

/** 流式连接来源类型 */
type FinalizeSource =
  | 'post_closestream_endpoint'
  | 'no_data_timeout'
  | 'safety_timeout'
  | 'ws_close'
  | 'ws_already_closed';

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

  constructor(config: StreamSTTConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<StreamSTTConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 检查提供者是否可用
   */
  isAvailable(): boolean {
    if (this.config.wsUrl) {
      return true;
    }
    return !!this.config.apiKey;
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      void handleError(error, { module: 'services:voice:streamSTT', action: 'transcribe' });

      return {
        text: '',
        confidence: 0,
        isFinal: true,
        provider: 'stream',
      };
    }
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

      let offset = 0;
      while (offset < audioData.length) {
        const chunk = audioData.subarray(offset, offset + chunkSize);
        stream.send(Buffer.from(chunk));
        offset += chunkSize;
      }

      stream.finalize();
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
   */
  private buildWsUrl(options?: STTStreamOptions): string {
    if (this.config.wsUrl) {
      return this.config.wsUrl;
    }

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

    const baseUrl = 'wss://api.anthropic.com';
    return `${baseUrl}${ANTHROPIC_STREAM_PATH}?${params.toString()}`;
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
    try {
      // Bun 运行时支持传入 headers 的 WebSocket 初始化选项
      this.ws = new (WebSocket as any)(this.wsUrl, {
        headers: this.headers,
      });
    } catch {
      this.ws = new WebSocket(this.wsUrl);
    }

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
