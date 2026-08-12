/**
 * VoiceToolBridge
 * 实时语音流中的工具调用 ↔ Agent 工具系统桥接
 * 采用异步模式：beginAsyncToolCall → Agent 执行 → finishAsyncToolCall + sendToolResult
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import type { VoiceToolCallEvent, VoiceToolDeclaration } from './types';

/** 活跃工具调用记录 */
interface ActiveToolCall {
  name: string;
  input: string;
  startTime: number;
}

/** 工具执行器接口——由外部注入，降低对具体工具系统的耦合 */
export interface ToolExecutorDelegate {
  executeTool(name: string, input: Record<string, unknown>): Promise<string>;
  getToolDeclarations(): VoiceToolDeclaration[];
}

/** 工具执行结果回调 */
export type ToolResultCallback = (callId: string, output: string) => void;

/** 工具进度回调 */
export type ToolProgressCallback = (callId: string, summary: string) => void;

export class VoiceToolBridge {
  private logger = getLogger('voice:tool-bridge');

  /** 工具声明缓存 */
  private declarations: VoiceToolDeclaration[] = [];

  /** 活跃工具调用 */
  private activeTools: Map<string, ActiveToolCall> = new Map();

  /** 工具超时（毫秒） */
  private timeoutMs: number;

  /** 外部工具执行委托 */
  private delegate: ToolExecutorDelegate | null = null;

  /** 工具结果回调 */
  private onToolResult: ToolResultCallback = () => {};

  /** 工具进度回调 */
  private onToolProgress: ToolProgressCallback = () => {};

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  /** 设置工具执行委托 */
  setDelegate(delegate: ToolExecutorDelegate): void {
    this.delegate = delegate;
    this.declarations = delegate.getToolDeclarations();
  }

  /** 设置工具结果回调 */
  setOnToolResult(callback: ToolResultCallback): void {
    this.onToolResult = callback;
  }

  /** 设置工具进度回调 */
  setOnToolProgress(callback: ToolProgressCallback): void {
    this.onToolProgress = callback;
  }

  /** 获取工具声明列表 */
  getDeclarations(): VoiceToolDeclaration[] {
    return this.declarations;
  }

  /** 获取活跃工具调用 */
  getActiveTools(): Map<string, ActiveToolCall> {
    return new Map(this.activeTools);
  }

  /** 处理工具调用事件 */
  async onToolCall(call: VoiceToolCallEvent): Promise<void> {
    if (!this.delegate) {
      this.logger.warn('工具桥接 · 工具系统未就绪', {
        callId: call.id,
        toolName: call.name,
      });
      this.onToolResult(call.id, JSON.stringify({ error: '工具系统未就绪' }));
      return;
    }

    this.logger.info('工具桥接 · 开始执行工具', {
      callId: call.id,
      toolName: call.name,
    });

    const record: ActiveToolCall = {
      name: call.name,
      input: call.arguments,
      startTime: Date.now(),
    };

    this.activeTools.set(call.id, record);

    // 启动超时计时器
    const timeoutId = setTimeout(() => {
      if (this.activeTools.has(call.id)) {
        this.activeTools.delete(call.id);
        this.logger.warn('工具桥接 · 工具执行超时', {
          callId: call.id,
          toolName: call.name,
        });
        this.onToolResult(
          call.id,
          JSON.stringify({ error: `工具 ${call.name} 执行超时` })
        );
      }
    }, this.timeoutMs);

    try {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(call.arguments);
      } catch (e) {
        void handleError(e, {
          module: 'voice:toolbridge',
          action: 'parseArgs',
        });
        input = { _raw: call.arguments };
      }

      this.onToolProgress(call.id, `正在执行工具: ${call.name}`);

      const output = await this.delegate.executeTool(call.name, input);

      if (this.activeTools.has(call.id)) {
        clearTimeout(timeoutId);
        this.activeTools.delete(call.id);
        const elapsed = Date.now() - record.startTime;
        this.logger.info('工具桥接 · 工具执行完成', {
          callId: call.id,
          toolName: call.name,
          elapsed,
        });
        this.onToolProgress(call.id, `工具 ${call.name} 执行完成`);
        this.onToolResult(call.id, output);
      }
    } catch (err) {
      void handleError(err, {
        module: 'voice:toolbridge',
        action: 'executeTool',
      });
      clearTimeout(timeoutId);
      this.activeTools.delete(call.id);
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('工具桥接 · 工具执行失败', {
        callId: call.id,
        toolName: call.name,
        error: msg,
      });
      this.onToolResult(call.id, JSON.stringify({ error: msg }));
    }
  }
}
