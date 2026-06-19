/**
 * VoiceSession
 * 语音会话生命周期管理
 * 桥接 WebSocket 连接 ↔ Provider Adapter ↔ VoiceToolBridge
 * 处理 Client→Server 事件路由、状态管理、会话摘要
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */

import { randomUUID } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
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
import type { SessionManager } from '@modules/session/SessionManager';
import type { TranscriptManager } from '@modules/session/TranscriptManager';
import { MessageType, MessageRole } from '@modules/session/types/Message';
import type { UnifiedMessage } from '@modules/session/types/Message';
import { MemoryManagerImpl } from '../memory/MemoryManager';
import { getAlertManager } from '@modules/monitoring/alerts/AlertManager';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';

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

/** 会话集成选项 */
export interface SessionIntegrationOptions {
  sessionManager?: SessionManager;
  transcriptManager?: TranscriptManager;
  memoryManager?: MemoryManagerImpl;
}

export class VoiceSession {
  private logger = new Logger({ level: LogLevel.INFO });

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

  /** 会话管理器（集成注入） */
  private sessionManager: SessionManager | null = null;

  /** 转录管理器（集成注入） */
  private transcriptManager: TranscriptManager | null = null;

  /** 记忆管理器（集成注入） */
  private memoryManager: MemoryManagerImpl | null = null;

  constructor(
    connection: VoiceConnection,
    integrationOptions?: SessionIntegrationOptions
  ) {
    this.id = connection.id;
    this.connection = connection;
    this.eventBus = new VoiceEventBus();
    this.toolBridge = new VoiceToolBridge();
    this.sessionManager = integrationOptions?.sessionManager ?? null;
    this.transcriptManager = integrationOptions?.transcriptManager ?? null;
    this.memoryManager = integrationOptions?.memoryManager ?? null;
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
      this.logger.warn('会话配置 · 无效状态', {
        sessionId: this.id,
        state: this._state,
      });
      this.connection.send({
        type: 'error',
        code: 'INVALID_STATE',
        message: `无法在 ${this._state} 状态下配置会话`,
      });
      return;
    }

    this.logger.info('会话配置 · 开始', {
      sessionId: this.id,
      provider: config.provider,
    });
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

      // Phase 2-3: OTel 追踪——Provider 连接
      const otel = getOTelTracing();
      await otel.wrap(
        {
          name: 'voice.session.connect',
          attributes: {
            'voice.session_id': this.id,
            'voice.provider': config.provider,
          },
        },
        async () => {
          await this.adapter!.connect(
            config,
            (event: VoiceServerEvent) => {
              this.handleProviderEvent(event);
            },
            toolOptions
          );
        }
      );

      this.setState('connected');
      this.logger.info('会话配置 · 成功', {
        sessionId: this.id,
        provider: config.provider,
      });
      this.startTimeoutTimer();

      // 如果配置包含 brainAgent，则注入上下文
      if (config.brainAgent) {
        this.adapter.injectContext(
          `你正在与 ${config.brainAgent} 协作，请根据上下文回答。`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('会话配置 · 失败', {
        sessionId: this.id,
        provider: config.provider,
        error: msg,
      });
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
      this.logger.warn('音频追加 · 适配器未配置', { sessionId: this.id });
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
    if (event.type === 'error') {
      this.logger.error('Provider 错误事件', {
        sessionId: this.id,
        code: event.code,
        message: event.message,
      });
    }

    // 转录完成——持久化到 TranscriptManager
    if (event.type === 'transcript.done') {
      this.logger.info('转录完成', {
        sessionId: this.id,
        textLength: event.text.length,
      });

      if (this.transcriptManager) {
        const message: UnifiedMessage = {
          id: randomUUID(),
          sessionId: this.id,
          type: MessageType.ASSISTANT,
          role: MessageRole.ASSISTANT,
          content: event.text,
          timestamp: Date.now(),
        };

        this.transcriptManager.recordMessage(this.id, message).catch((err) => {
          this.logger.error('转录持久化失败', {
            sessionId: this.id,
            error: String(err),
          });
        });
      }
    }

    // 收集指标
    if (event.type === 'tool.call') {
      this.toolCallCount++;
      this.logger.info('工具调用事件', {
        sessionId: this.id,
        toolName: event.name,
        callId: event.id,
      });

      // Phase 2-3: OTel 追踪——工具调用
      getOTelTracing().wrap(
        {
          name: 'voice.tool.call',
          attributes: {
            'voice.session_id': this.id,
            'voice.tool_name': event.name ?? 'unknown',
            'voice.tool_call_id': event.id ?? 'unknown',
          },
        },
        () => {
          this.toolBridge.onToolCall(event);
        }
      );
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
    // Phase 2-1: 同步 Token 用量到会话系统
    if (this.sessionManager) {
      const totalTokens = this.inputTokens + this.outputTokens;
      if (totalTokens > 0) {
        this.sessionManager.recordTokenConsumption(
          this.id,
          totalTokens,
          'per_session'
        );
        this.logger.info('Token 用量已同步', {
          sessionId: this.id,
          inputTokens: this.inputTokens,
          outputTokens: this.outputTokens,
          totalTokens,
        });
      }
    }

    // Phase 2-2: 上报语音指标到告警系统
    if (this.errors.length > 0) {
      const alertManager = getAlertManager();
      alertManager.evaluateRules({
        'voice.errors_total': [this.errors.length],
      });
    }

    // Phase 2-3: OTel 追踪——会话断开清理
    const otel = getOTelTracing();
    otel.wrap(
      {
        name: 'voice.session.disconnect',
        attributes: {
          'voice.session_id': this.id,
          'voice.reason': reason,
          'voice.duration_ms': String(this._endedAt - this._startedAt),
          'voice.error_count': String(this.errors.length),
          'voice.token_total': String(this.inputTokens + this.outputTokens),
        },
      },
      () => {
        this.logger.info('会话断开', { sessionId: this.id, reason });
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
    );
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
    this.logger.info('会话清理', { sessionId: this.id });
    this.saveSessionToMemory();
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

  /** 将会话摘要保存到记忆系统 */
  private saveSessionToMemory(): void {
    if (!this.memoryManager) {
      return;
    }

    const summary = this.getSummary();
    const durationSec = Math.round(summary.duration / 1000);
    const content = [
      `## 语音会话摘要`,
      ``,
      `**会话 ID**: ${summary.sessionId}`,
      `**开始时间**: ${new Date(summary.startedAt).toISOString()}`,
      summary.endedAt
        ? `**结束时间**: ${new Date(summary.endedAt).toISOString()}`
        : '',
      `**持续时长**: ${durationSec} 秒`,
      `**状态**: ${summary.state}`,
      ``,
      `**音频处理**: ${(summary.totalAudioMs / 1000).toFixed(1)} 秒`,
      `**LLM 处理**: ${(summary.totalLlmMs / 1000).toFixed(1)} 秒`,
      `**输入词元**: ${summary.inputTokens}`,
      `**输出词元**: ${summary.outputTokens}`,
      `**工具调用**: ${summary.toolCalls} 次`,
      summary.errors.length > 0 ? `**错误数**: ${summary.errors.length}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.memoryManager
      .createMemory({
        content,
        metadata: {
          name: `语音会话 ${this.id.slice(0, 8)}`,
          description: `语音会话摘要 (${durationSec} 秒)`,
          type: 'CONVERSATION',
          tags: ['voice', 'session'],
          createdAt: new Date(summary.startedAt),
          updatedAt: new Date(),
        },
      })
      .catch((err: unknown) => {
        this.logger.warn('记忆写入失败', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
