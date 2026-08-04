/**
 * OpenAIRealtimeAdapter
 * OpenAI Realtime API WebSocket 适配器
 * 实现 VoiceProviderAdapter 接口，对接 OpenAI Realtime API
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import type {
  VoiceSessionConfigEvent,
  VoiceServerEvent,
  VoiceProviderAdapter,
  VoiceToolDeclaration,
} from './types';
import { randomUUID } from 'crypto';

/** OpenAI Realtime API 端点 */
const OPENAI_WS_BASE = 'wss://api.openai.com/v1/realtime';

/** 默认模型 */
const DEFAULT_MODEL = '';

/** 语音配置 */
const DEFAULT_VOICE = 'alloy';

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 10000;

/** OpenAI Realtime 事件类型 */
const OA_EVENT = {
  SESSION_UPDATE: 'session.update',
  INPUT_AUDIO_APPEND: 'input_audio_buffer.append',
  INPUT_AUDIO_COMMIT: 'input_audio_buffer.commit',
  INPUT_AUDIO_CLEAR: 'input_audio_buffer.clear',
  RESPONSE_CREATE: 'response.create',
  RESPONSE_CANCEL: 'response.cancel',
  CONVERSATION_ITEM_CREATE: 'conversation.item.create',
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  INPUT_AUDIO_SPEECH_STARTED: 'input_audio_buffer.speech_started',
  INPUT_AUDIO_SPEECH_STOPPED: 'input_audio_buffer.speech_stopped',
  CONVERSATION_ITEM_CREATED: 'conversation.item.created',
  RESPONSE_CREATED: 'response.created',
  RESPONSE_AUDIO_DELTA: 'response.audio.delta',
  RESPONSE_AUDIO_DONE: 'response.audio.done',
  RESPONSE_TEXT_DELTA: 'response.text.delta',
  RESPONSE_TEXT_DONE: 'response.text.done',
  RESPONSE_FUNCTION_CALL_DELTA: 'response.function_call_arguments.delta',
  RESPONSE_FUNCTION_CALL_DONE: 'response.function_call_arguments.done',
  RESPONSE_DONE: 'response.done',
  ERROR: 'error',
  RATE_LIMITS_UPDATED: 'rate_limits.updated',
} as const;

/** 重连状态 */
interface ReconnectState {
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Bun 环境下带自定义头的 WebSocket 工厂 */
type WsOptions = { headers?: Record<string, string> };
function createWsWithHeaders(url: string, options: WsOptions): WebSocket {
  const Constructor = WebSocket as unknown as new (
    url: string,
    opts: WsOptions
  ) => WebSocket;
  return new Constructor(url, options);
}

export class OpenAIRealtimeAdapter implements VoiceProviderAdapter {
  private logger = new Logger({ level: LogLevel.INFO });
  private ws: WebSocket | null = null;

  private apiKey: string;

  private model: string;

  private voice: string;

  private tools: VoiceToolDeclaration[] = [];

  private sendToClient: ((event: VoiceServerEvent) => void) | null = null;

  private transcript: Array<{ role: 'user' | 'assistant'; text: string }> = [];

  private sessionActive: boolean = false;

  private reconnect: ReconnectState = { attempt: 0, timer: null };

  /** 待处理的工具调用片段 */
  private pendingToolCallArgs: Map<string, string> = new Map();

  constructor(apiKey: string, model?: string, voice?: string) {
    this.apiKey = apiKey;
    this.model = model ?? DEFAULT_MODEL;
    this.voice = voice ?? DEFAULT_VOICE;
  }

  async connect(
    config: VoiceSessionConfigEvent,
    sendToClient: (event: VoiceServerEvent) => void,
    options?: { tools?: VoiceToolDeclaration[] }
  ): Promise<void> {
    this.sendToClient = sendToClient;
    this.tools = options?.tools ?? [];

    if (config.voice) {
      this.voice = config.voice;
    }

    this.reconnect.attempt = 0;
    return this.createConnection();
  }

  private createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${OPENAI_WS_BASE}?model=${encodeURIComponent(this.model)}`;

        this.ws = createWsWithHeaders(wsUrl, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        });

        this.ws.onopen = () => {
          this.logger.info('OpenAI Realtime WebSocket 连接已建立');
          this.sessionActive = true;
          this.sendSessionUpdate();
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          this.handleMessage(event);
        };

        this.ws.onclose = () => {
          this.logger.warn('OpenAI Realtime WebSocket 连接关闭', {
            reconnectAttempt: this.reconnect.attempt,
          });
          this.sessionActive = false;
          if (this.reconnect.attempt < 3) {
            this.scheduleReconnect();
          } else {
            this.sendToClient?.({
              type: 'error',
              code: 'CONNECTION_CLOSED',
              message: 'OpenAI Realtime 连接已断开，重连失败',
            });
          }
        };

        this.ws.onerror = () => {
          this.logger.error('OpenAI Realtime WebSocket 连接失败');
          reject(new Error('WebSocket 连接失败'));
        };
      } catch (err) {
        void handleError(err, { module: 'voice:openai', action: 'createConnection' });
        this.logger.error('OpenAI Realtime WebSocket 创建异常', {
          error: String(err),
        });
        reject(err);
      }
    });
  }

  private sendSessionUpdate(): void {
    const modalities = ['text', 'audio'];
    const update: Record<string, unknown> = {
      type: OA_EVENT.SESSION_UPDATE,
      session: {
        modalities,
        voice: this.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
    };

    if (this.tools.length > 0) {
      (update.session as Record<string, unknown>).tools = this.tools.map(
        (t) => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })
      );
      (update.session as Record<string, unknown>).tool_choice = 'auto';
    }

    this.ws?.send(JSON.stringify(update));
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      if (event.data instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(event.data);
        this.dispatchOpenAIEvent(text);
      }
      return;
    }
    this.dispatchOpenAIEvent(event.data);
  }

  private dispatchOpenAIEvent(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      void handleError(new Error('OpenAI 消息解析失败'), {
        module: 'voice:openai',
        action: 'parseMessage',
      });
      this.logger.warn('OpenAI 消息解析失败', { raw: raw.slice(0, 100) });
      return;
    }

    const type = parsed.type as string;

    switch (type) {
      case OA_EVENT.SESSION_CREATED:
        this.sendToClient?.({
          type: 'session.ready',
          sessionId: randomUUID(),
        });
        break;

      case OA_EVENT.SESSION_UPDATED:
      case OA_EVENT.RATE_LIMITS_UPDATED:
      case OA_EVENT.RESPONSE_CREATED:
      case OA_EVENT.CONVERSATION_ITEM_CREATED:
        break;

      case OA_EVENT.INPUT_AUDIO_SPEECH_STARTED:
        this.sendToClient?.({
          type: 'turn.started',
        });
        break;

      case OA_EVENT.INPUT_AUDIO_SPEECH_STOPPED:
        this.sendToClient?.({
          type: 'turn.ended',
        });
        break;

      case OA_EVENT.RESPONSE_AUDIO_DELTA: {
        const delta = parsed.delta as string;
        if (delta) {
          this.sendToClient?.({
            type: 'audio.delta',
            data: delta,
          });
        }
        break;
      }

      case OA_EVENT.RESPONSE_TEXT_DELTA: {
        const delta = parsed.delta as string;
        if (delta) {
          this.sendToClient?.({
            type: 'transcript.delta',
            delta,
          });
        }
        break;
      }

      case OA_EVENT.RESPONSE_TEXT_DONE: {
        const text = parsed.text as string;
        if (text) {
          this.sendToClient?.({
            type: 'transcript.done',
            text,
          });
        }
        break;
      }

      case OA_EVENT.RESPONSE_FUNCTION_CALL_DELTA: {
        const callId = parsed.call_id as string;
        const argsDelta = parsed.delta as string;
        if (callId && argsDelta) {
          const existing = this.pendingToolCallArgs.get(callId) ?? '';
          this.pendingToolCallArgs.set(callId, existing + argsDelta);
        }
        break;
      }

      case OA_EVENT.RESPONSE_FUNCTION_CALL_DONE: {
        const callId = parsed.call_id as string;
        const funcName = parsed.name as string;
        const fullArgs =
          this.pendingToolCallArgs.get(callId) ??
          (parsed.arguments as string) ??
          '{}';
        this.pendingToolCallArgs.delete(callId);

        if (callId && funcName) {
          this.sendToClient?.({
            type: 'tool.call',
            id: callId,
            name: funcName,
            arguments: fullArgs,
          });
        }
        break;
      }

      case OA_EVENT.RESPONSE_DONE:
        this.sendToClient?.({
          type: 'turn.ended',
        });
        break;

      case OA_EVENT.ERROR: {
        const errBody = (parsed.error as Record<string, unknown>) ?? {};
        this.logger.error('OpenAI API 错误', {
          message: errBody.message,
          code: errBody.code,
        });
        this.sendToClient?.({
          type: 'error',
          code: 'PROVIDER_ERROR',
          message: `OpenAI: ${(errBody.message as string) ?? '未知错误'}`,
        });
        break;
      }

      default:
        break;
    }
  }

  sendAudio(base64Data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: OA_EVENT.INPUT_AUDIO_APPEND,
        audio: base64Data,
      })
    );
  }

  commitAudio(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: OA_EVENT.INPUT_AUDIO_COMMIT,
      })
    );
  }

  sendFrame(_data: string, _mimeType?: string): void {
    void _data;
    void _mimeType;
    // OpenAI Realtime API 不直接支持图像帧输入
  }

  createResponse(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: OA_EVENT.RESPONSE_CREATE,
      })
    );
  }

  cancelResponse(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: OA_EVENT.RESPONSE_CANCEL,
      })
    );
  }

  beginAsyncToolCall(_callId: string): void {
    void _callId;
    // OpenAI 流的工具调用是异步的，不需要特殊处理
  }

  finishAsyncToolCall(_callId: string): void {
    void _callId;
    // OpenAI 流的工具调用是异步的，不需要特殊处理
  }

  sendToolResult(callId: string, output: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: OA_EVENT.CONVERSATION_ITEM_CREATE,
        item: {
          type: 'function_call_output',
          call_id: callId,
          output,
        },
      })
    );

    this.createResponse();
  }

  injectContext(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: OA_EVENT.CONVERSATION_ITEM_CREATE,
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      })
    );
  }

  getTranscript(): Array<{ role: 'user' | 'assistant'; text: string }> {
    return [...this.transcript];
  }

  private scheduleReconnect(): void {
    this.reconnect.attempt++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnect.attempt - 1),
      RECONNECT_MAX_DELAY
    );

    this.reconnect.timer = setTimeout(() => {
      if (!this.sessionActive) {
        // @ignore-catch — 断线自动重连fire-and-forget，失败由重连逻辑自身处理
        this.createConnection().catch(() => {});
      }
    }, delay);
  }

  disconnect(): void {
    this.logger.info('OpenAI Realtime 断开连接');
    this.sessionActive = false;

    if (this.reconnect.timer) {
      clearTimeout(this.reconnect.timer);
      this.reconnect.timer = null;
    }

    if (this.ws) {
      this.ws.close(1000, '用户主动断开');
      this.ws = null;
    }

    this.pendingToolCallArgs.clear();
  }
}
