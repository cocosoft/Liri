/**
 * VoiceSession
 * 语音会话生命周期管理
 * 桥接 WebSocket 连接 ↔ Provider Adapter ↔ VoiceToolBridge
 * 处理 Client→Server 事件路由、状态管理、会话摘要
 */

import { VoiceEventBus } from './VoiceEventBus';
import { VoiceToolBridge } from './VoiceToolBridge';
import type {
  VoiceConnection,
  VoiceClientEvent,
  VoiceServerEvent,
  VoiceSessionConfigEvent,
  VoiceSessionSummary,
  VoiceSessionState,
  VoiceProviderAdapter,
} from './types';
import { GeminiLiveAdapter } from './GeminiLiveAdapter';
import { OpenAIRealtimeAdapter } from './OpenAIRealtimeAdapter';
import { globalToolManager } from '../tools/core/ToolManager';
import type { ToolExecutorDelegate } from './VoiceToolBridge';

/** 提供商标识到构造函数的映射 */
const PROVIDER_ADAPTERS: Record<
  string,
  new (apiKey: string) => VoiceProviderAdapter
> = {
  gemini: GeminiLiveAdapter,
  openai: OpenAIRealtimeAdapter,
};

/** 默认超时（毫秒） */
const DEFAULT_SESSION_TIMEOUT = 10 * 60 * 1000;

export class VoiceSession {
  /** 会话唯一标识 */
  readonly id: string;

  /** WebSocket 连接 */
  private connection: VoiceConnection;

  /** 事件总线 */
  private eventBus: VoiceEventBus;

  /** 工具桥接 */
  private toolBridge: VoiceToolBridge;

  /** Provider 适配器 */
  private adapter: VoiceProviderAdapter | null = null;

  /** 会话状态 */
  private _state: VoiceSessionState = 'idle';

  /** 会话开始时间 */
  private _startedAt: number = 0;

  /** 会话结束时间 */
  private _endedAt: number = 0;

  /** 累计音频处理时间（毫秒） */
  private totalAudioMs: number = 0;

  /** 累计 LLM 处理时间（毫秒） */
  private totalLlmMs: number = 0;

  /** 输入 Token 数 */
  private inputTokens: number = 0;

  /** 输出 Token 数 */
  private outputTokens: number = 0;

  /** 工具调用次数 */
  private toolCallCount: number = 0;

  /** 错误记录 */
  private errors: string[] = [];

  /** 会话超时计时器 */
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  /** 连接断开展开函数 */
  private disconnectConnection: (() => void) | null = null;

  /** 活跃音频流计时器 */
  private audioTimerStart: number = 0;

  constructor(connection: VoiceConnection) {
    this.id = connection.id;
    this.connection = connection;
    this.eventBus = new VoiceEventBus();
    this.toolBridge = new VoiceToolBridge();
    this.setupConnectionHandlers();
    this.setupEventBusHandlers();
  }

  /** 获取当前状态 */
  get state(): VoiceSessionState {
    return this._state;
  }

  /** 获取事件总线 */
  get bus(): VoiceEventBus {
    return this.eventBus;
  }

  /** 获取工具桥接 */
  get tools(): VoiceToolBridge {
    return this.toolBridge;
  }

  /** 设置内部状态并更新事件总线 */
  private setState(state: VoiceSessionState): void {
    this._state = state;
    this.eventBus.setState(state);
  }

  /** 设置 WebSocket 连接的消息/关闭/错误处理器 */
  private setupConnectionHandlers(): void {
    this.connection.onMessage((event: VoiceClientEvent) => {
      this.eventBus.emitToServer(event);
    });

    this.connection.onClose((code: number, reason: string) => {
      this.handleDisconnect(`连接关闭 (code=${code}, reason=${reason})`);
    });

    this.connection.onError((error: Error) => {
      this.eventBus.emitError(error);
    });
  }

  /** 设置事件总线处理器 */
  private setupEventBusHandlers(): void {
    this.eventBus.onServerEvent((event: VoiceServerEvent) => {
      this.connection.send(event);
    });

    this.eventBus.onError((error: Error) => {
      this.errors.push(error.message);
      this.connection.send({
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    });

    this.eventBus.onStateChange((state: VoiceSessionState) => {
      if (state === 'disconnected' || state === 'error') {
        this.cleanup();
      }
    });

    this.eventBus.onClientEvent((event: VoiceClientEvent) => {
      this.handleClientEvent(event);
    });
  }

  /** 处理来自客户端的各类事件 */
  private handleClientEvent(event: VoiceClientEvent): void {
    switch (event.type) {
      case 'session.config':
        this.handleConfig(event);
        break;

      case 'audio.append':
        this.handleAudioAppend(event);
        break;

      case 'audio.commit':
        this.handleAudioCommit();
        break;

      case 'frame.append':
        this.handleFrameAppend(event);
        break;

      case 'response.create':
        this.handleResponseCreate();
        break;

      case 'response.cancel':
        this.handleResponseCancel();
        break;

      case 'tool.result':
        this.handleToolResult(event);
        break;
    }
  }

  /** 处理 session.config 事件 */
  private async handleConfig(config: VoiceSessionConfigEvent): Promise<void> {
    if (this._state !== 'idle' && this._state !== 'disconnected') {
      this.connection.send({
        type: 'error',
        code: 'INVALID_STATE',
        message: `无法在 ${this._state} 状态下配置会话`,
      });
      return;
    }

    this.setState('connecting');
    this._startedAt = Date.now();

    try {
      const AdapterClass = PROVIDER_ADAPTERS[config.provider];
      if (!AdapterClass) {
        throw new Error(`不支持的提供商: ${config.provider}`);
      }

      const apiKey = this.resolveApiKey(config.provider);
      this.adapter = new AdapterClass(apiKey);

      // 设置工具桥接委托——连接 VoiceToolBridge 到全局 ToolManager
      const toolDelegate: ToolExecutorDelegate = {
        executeTool: async (name, input) => {
          try {
            const result = await globalToolManager.executeTool(name, input, {
              sessionId: this.id,
            });
            return JSON.stringify(result);
          } catch (err) {
            return JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
        getToolDeclarations: () => {
          return globalToolManager.getAllTools().map((t) => ({
            name: t.name,
            description: t.description,
            parameters: {
              type: 'object',
              properties: t.params.reduce(
                (acc, p) => {
                  acc[p.name] = { type: p.type, description: p.description };
                  return acc;
                },
                {} as Record<string, unknown>
              ),
            },
          }));
        },
      };
      this.toolBridge.setDelegate(toolDelegate);

      // 设置工具桥接的进度回调
      this.toolBridge.setOnToolProgress((callId, summary) => {
        this.connection.send({
          type: 'tool.progress',
          callId,
          summary,
        });
      });

      // 设置工具桥接的结果回调
      this.toolBridge.setOnToolResult((callId, output) => {
        this.adapter?.sendToolResult(callId, output);
      });

      // 将工具声明列表传递给适配器
      const toolOptions = {
        tools: toolDelegate.getToolDeclarations(),
      };

      // 连接适配器
      await this.adapter.connect(
        config,
        (event: VoiceServerEvent) => {
          this.handleProviderEvent(event);
        },
        toolOptions
      );

      this.setState('connected');
      this.startTimeoutTimer();

      // 如果配置包含 brainAgent，则注入上下文
      if (config.brainAgent) {
        this.adapter.injectContext(
          `你正在与 ${config.brainAgent} 协作，请根据上下文回答。`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errors.push(msg);
      this.setState('error');
      this.connection.send({
        type: 'error',
        code: 'CONFIG_FAILED',
        message: msg,
      });
    }
  }

  /** 处理 audio.append 事件 */
  private handleAudioAppend(event: { data: string }): void {
    if (!this.adapter) {
      this.connection.send({
        type: 'error',
        code: 'NOT_CONFIGURED',
        message: '会话未配置',
      });
      return;
    }

    if (this._state !== 'connected' && this._state !== 'active') {
      this.setState('active');
    }

    this.adapter.sendAudio(event.data);
  }

  /** 处理 audio.commit 事件 */
  private handleAudioCommit(): void {
    if (!this.adapter) return;

    this.adapter.commitAudio();
  }

  /** 处理 frame.append 事件 */
  private handleFrameAppend(event: { data: string; mimeType?: string }): void {
    if (!this.adapter) return;

    this.adapter.sendFrame(event.data, event.mimeType);
  }

  /** 处理 response.create 事件 */
  private handleResponseCreate(): void {
    if (!this.adapter) return;

    this.adapter.createResponse();
  }

  /** 处理 response.cancel 事件 */
  private handleResponseCancel(): void {
    if (!this.adapter) return;

    this.adapter.cancelResponse();
  }

  /** 处理 tool.result 事件 */
  private handleToolResult(event: { callId: string; output: string }): void {
    if (!this.adapter) return;

    this.adapter.sendToolResult(event.callId, event.output);
  }

  /** 处理来自 Provider 的事件 */
  private handleProviderEvent(event: VoiceServerEvent): void {
    // 收集指标
    if (event.type === 'tool.call') {
      this.toolCallCount++;

      // 将工具调用转给工具桥接处理
      this.toolBridge.onToolCall(event);
      return;
    }

    if (event.type === 'latency.metrics') {
      this.totalAudioMs += event.audioMs;
      this.totalLlmMs += event.llmMs;
    }

    if (event.type === 'usage.metrics') {
      this.inputTokens += event.inputTokens;
      this.outputTokens += event.outputTokens;
    }

    this.connection.send(event);
  }

  /** 处理断开连接 */
  private handleDisconnect(reason: string): void {
    this.setState('disconnected');
    this._endedAt = Date.now();

    this.disconnectAdapter();
    this.clearTimeoutTimer();

    this.connection.send({
      type: 'session.ended',
      summary: reason,
      duration: this._endedAt - this._startedAt,
    });
  }

  /** 断开适配器连接 */
  private disconnectAdapter(): void {
    if (this.adapter) {
      try {
        this.adapter.disconnect();
      } catch {
        // 忽略断开时的错误
      }
      this.adapter = null;
    }
  }

  /** 清理资源 */
  private cleanup(): void {
    this.disconnectAdapter();
    this.clearTimeoutTimer();
    this.eventBus.clear();
    this.toolBridge.getActiveTools().clear();
  }

  /** 启动会话超时计时器 */
  private startTimeoutTimer(): void {
    this.clearTimeoutTimer();

    this.timeoutTimer = setTimeout(() => {
      this.connection.send({
        type: 'session.ended',
        summary: '会话超时',
        duration: Date.now() - this._startedAt,
      });

      this.disconnectAdapter();
      this.setState('disconnected');
    }, DEFAULT_SESSION_TIMEOUT);
  }

  /** 清除超时计时器 */
  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /** 获取会话摘要 */
  getSummary(): VoiceSessionSummary {
    return {
      sessionId: this.id,
      state: this._state,
      startedAt: this._startedAt,
      endedAt: this._endedAt || undefined,
      duration: this._endedAt
        ? this._endedAt - this._startedAt
        : Date.now() - this._startedAt,
      totalAudioMs: this.totalAudioMs,
      totalLlmMs: this.totalLlmMs,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      toolCalls: this.toolCallCount,
      errors: this.errors,
    };
  }

  /**
   * 解析提供商 API Key
   * 按优先级：环境变量 → 配置
   */
  private resolveApiKey(provider: string): string {
    const envKey = `${provider.toUpperCase()}_API_KEY`;
    const key = process.env[envKey] || process.env[`${provider}_API_KEY`] || '';

    if (!key) {
      throw new Error(`未设置 ${provider} API Key，请设置环境变量 ${envKey}`);
    }

    return key;
  }

  /** 主动断开会话 */
  close(): void {
    this.handleDisconnect('用户主动结束');
  }
}
