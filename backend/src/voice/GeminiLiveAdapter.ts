/**
 * GeminiLiveAdapter
 * Gemini Multimodal Live API WebSocket 适配器
 * 实现 VoiceProviderAdapter 接口，对接 Gemini BidiGenerateContent API
 */

import { randomUUID } from 'crypto';
import type {
  VoiceSessionConfigEvent,
  VoiceServerEvent,
  VoiceProviderAdapter,
  VoiceToolDeclaration,
} from './types';

/** Gemini Live API 基础 URL */
const GEMINI_WS_BASE = 'wss://generativelanguage.googleapis.com/ws';

/** 重连延迟基数（毫秒） */
const RECONNECT_BASE_DELAY = 1000;

/** 重连最大延迟（毫秒） */
const RECONNECT_MAX_DELAY = 10000;

/** 默认语音配置 */
const DEFAULT_VOICE_NAME = 'Puck';

/** Gemini Live 配置 */
interface GeminiLiveConfig {
  apiKey: string;
  model: string;
  voiceName: string;
  systemInstruction?: string;
  tools?: VoiceToolDeclaration[];
}

/** 重连状态 */
interface ReconnectState {
  attempt: number;
  maxAttempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** ServerContent 消息中的 Part 结构 */
interface ModelTurnPart {
  inlineData?: { data: string; mimeType?: string };
  text?: string;
}

export class GeminiLiveAdapter implements VoiceProviderAdapter {
  private ws: WebSocket | null = null;
  private config: GeminiLiveConfig;
  private sendToClient: ((event: VoiceServerEvent) => void) | null = null;
  private transcript: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  private reconnect: ReconnectState = {
    attempt: 0,
    maxAttempts: 3,
    timer: null,
  };
  private sessionActive: boolean = false;

  constructor(apiKey: string) {
    this.config = {
      apiKey,
      model: 'models/gemini-2.0-flash-live-001',
      voiceName: DEFAULT_VOICE_NAME,
    };
  }

  /**
   * 建立 WebSocket 连接
   * @param config 会话配置
   * @param sendToClient 向客户端发送事件的回调
   * @param options 可选参数（工具声明）
   */
  async connect(
    config: VoiceSessionConfigEvent,
    sendToClient: (event: VoiceServerEvent) => void,
    options?: { tools?: VoiceToolDeclaration[] }
  ): Promise<void> {
    this.sendToClient = sendToClient;
    this.transcript = [];
    this.reconnect.attempt = 0;

    // 合并配置
    this.config.model = config.model
      ? `models/${config.model}`
      : this.config.model;
    this.config.voiceName = config.voice ?? DEFAULT_VOICE_NAME;
    if (options?.tools) {
      this.config.tools = options.tools;
    }

    await this.createConnection();
  }

  /**
   * 创建 WebSocket 连接
   */
  private createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${GEMINI_WS_BASE}/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.config.apiKey}`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.sessionActive = true;
          this.sendSetupMessage();
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          this.handleMessage(event);
        };

        this.ws.onclose = (event: CloseEvent) => {
          this.sessionActive = false;
          if (this.reconnect.attempt < this.reconnect.maxAttempts) {
            this.scheduleReconnect();
          } else {
            this.sendToClient?.({
              type: 'error',
              code: 'CONNECTION_LOST',
              message: `Gemini Live 连接断开 (code=${event.code})`,
            });
          }
        };

        this.ws.onerror = (err: Event) => {
          reject(new Error(`WebSocket 连接失败: ${err}`));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 发送 setup 消息
   */
  private sendSetupMessage(): void {
    if (!this.ws) return;

    const setup: Record<string, unknown> = {
      model: this.config.model,
      generationConfig: {
        responseModalities: ['TEXT', 'AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: this.config.voiceName,
            },
          },
        },
      },
    };

    if (this.config.systemInstruction) {
      setup.systemInstruction = {
        parts: [{ text: this.config.systemInstruction }],
      };
    }

    if (this.config.tools && this.config.tools.length > 0) {
      setup.tools = [
        {
          functionDeclarations: this.config.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    this.ws.send(JSON.stringify({ setup }));
  }

  /**
   * 处理收到的 WebSocket 消息
   */
  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      // 二进制数据（音频流）
      this.handleBinaryData(event.data);
      return;
    }

    try {
      const msg = JSON.parse(event.data);

      if (msg.setupComplete) {
        this.sendToClient?.({
          type: 'session.ready',
          sessionId: randomUUID(),
        });
        return;
      }

      if (msg.serverContent) {
        this.handleServerContent(msg.serverContent);
        return;
      }

      if (msg.toolCall) {
        this.handleToolCall(msg.toolCall);
        return;
      }

      if (msg.error) {
        this.sendToClient?.({
          type: 'error',
          code: 'GEMINI_ERROR',
          message: msg.error.message ?? 'Gemini API 返回错误',
        });
      }
    } catch {
      // 忽略无法解析的消息
    }
  }

  /**
   * 处理 serverContent 消息
   */
  private handleServerContent(content: Record<string, unknown>): void {
    const modelTurn = content.modelTurn as Record<string, unknown> | undefined;
    const parts = modelTurn?.parts as ModelTurnPart[] | undefined;
    if (!parts) return;

    let transcriptText = '';

    for (const part of parts) {
      if (part.inlineData) {
        // 音频数据
        const data = part.inlineData.data;
        if (data) {
          this.sendToClient?.({
            type: 'audio.delta',
            data,
          });
        }
      }

      if (part.text) {
        transcriptText += part.text;
        this.sendToClient?.({
          type: 'transcript.delta',
          delta: part.text,
        });
      }
    }

    if (content.turnComplete && transcriptText) {
      this.transcript.push({
        role: 'assistant',
        text: transcriptText,
      });
      this.sendToClient?.({
        type: 'transcript.done',
        text: transcriptText,
      });
    }

    if (content.turnComplete) {
      this.sendToClient?.({
        type: 'turn.ended',
      });
    } else if (parts.length > 0) {
      this.sendToClient?.({
        type: 'turn.started',
      });
    }
  }

  /**
   * 处理 toolCall 消息
   */
  private handleToolCall(toolCall: Record<string, unknown>): void {
    const calls =
      (toolCall.functionCalls as Array<Record<string, unknown>>) ?? [];
    for (const call of calls) {
      this.sendToClient?.({
        type: 'tool.call',
        id: (call.id as string) ?? randomUUID(),
        name: call.name as string,
        arguments: JSON.stringify(call.args ?? {}),
      });
    }
  }

  /**
   * 处理二进制音频数据（服务端→客户端）
   */
  private handleBinaryData(data: unknown): void {
    // 将二进制数据转为 base64 后通过 audio.delta 发送
    let base64: string;
    if (data instanceof ArrayBuffer) {
      base64 = Buffer.from(data).toString('base64');
    } else if (typeof data === 'string') {
      base64 = data;
    } else {
      return;
    }

    this.sendToClient?.({
      type: 'audio.delta',
      data: base64,
    });
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.reconnect.attempt++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnect.attempt - 1),
      RECONNECT_MAX_DELAY
    );

    this.reconnect.timer = setTimeout(async () => {
      try {
        await this.createConnection();
      } catch {
        // 重连失败由 onclose 处理
      }
    }, delay);
  }

  /**
   * 发送音频数据（客户端→服务端）
   * @param base64Data Base64 编码的 PCM 数据
   */
  sendAudio(base64Data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: base64Data,
                },
              },
            ],
          },
        ],
        turnComplete: false,
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * 提交音频缓冲区（标记当前轮次结束）
   */
  commitAudio(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      clientContent: {
        turns: [],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * 发送帧数据（图像/视频）
   * @param data Base64 数据
   * @param mimeType MIME 类型
   */
  sendFrame(data: string, mimeType?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType ?? 'image/jpeg',
                  data,
                },
              },
            ],
          },
        ],
        turnComplete: false,
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * 创建 AI 响应（服务端空闲时主动请求响应）
   */
  createResponse(): void {
    // Gemini Live API 在 sendAudio/commitAudio 后自动响应，
    // 此方法用于显式触发服务端处理
    this.commitAudio();
  }

  /**
   * 取消进行中的响应
   */
  cancelResponse(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      interrupt: true,
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * 开始异步工具调用
   * Gemini 协议中工具调用返回后自动等待结果，无需显式通知
   */
  beginAsyncToolCall(_callId: string): void {
    void _callId;
    // Gemini Live API 不需要显式的 beginAsyncToolCall
  }

  /**
   * 完成异步工具调用
   */
  finishAsyncToolCall(_callId: string): void {
    void _callId;
    // Gemini Live API 不需要显式的 finishAsyncToolCall
  }

  /**
   * 发送工具执行结果
   * @param callId 工具调用 ID
   * @param output 工具输出
   */
  sendToolResult(callId: string, output: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = { result: output };
    }

    const msg = {
      toolResponse: {
        functionResponses: [
          {
            id: callId,
            response: parsed,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * 注入上下文文本
   * @param text 文本
   */
  injectContext(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * 获取会话转录
   * @returns 对话记录
   */
  getTranscript(): Array<{ role: 'user' | 'assistant'; text: string }> {
    return [...this.transcript];
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.sessionActive = false;

    if (this.reconnect.timer) {
      clearTimeout(this.reconnect.timer);
      this.reconnect.timer = null;
    }

    if (this.ws) {
      this.ws.close(1000, '客户端主动断开');
      this.ws = null;
    }

    this.sendToClient?.({
      type: 'session.ended',
      summary: '客户端主动断开连接',
      duration: 0,
    });
  }
}
