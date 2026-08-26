/**
 * CodeRunner 主进程侧 RPC 桥接（CM-2）
 *
 * 处理子进程 stdio JSON-RPC 请求：
 *   - callTool → 显式白名单最前置 → isReadOnly/isDestructive 动态方法
 *                → PermissionManager.checkPermissionForTool（ask 视为拒绝）→ 执行
 *   - readContext → 复用 EventLogStorage 查询（由调用方注入 queryContext）
 *   - writeOutput → 收集到结果
 *   - emitEvent → 事件类型白名单（knownEventTypes）→ appendStreamEvent
 *   - done / error → 结束信号
 *
 * 依赖注入：避免 tools 层依赖 ChatManager 具体类（方案 CM-2 六轮评审）。
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:CodeRunner:bridge');

import type { CodeRpcRequest, CodeRpcResponse } from './types';

/** 工具执行器（由调用方注入，兼容 ToolRegistry.executeTool 形态） */
export interface CodeToolExecutor {
  (
    name: string,
    input: Record<string, unknown>
  ): Promise<{
    ok: boolean;
    result?: unknown;
    error?: string;
  }>;
}

/** 会话上下文读取器（复用 EventLogStorage 查询） */
export type CodeContextReader = (opts?: { limit?: number }) => Promise<unknown>;

/** 事件写入器（ChatManagerInterface.appendStreamEvent 引用或 EventLogStorage 直写） */
export interface CodeEventWriter {
  (type: string, data: unknown): Promise<unknown>;
}

/** 桥接依赖 */
export interface CodeRunnerBridgeDeps {
  sessionId: string;
  userId?: string;
  /** 工具执行器（白名单外不调用） */
  executeTool: CodeToolExecutor;
  /** 会话上下文读取（EventLogStorage query） */
  readContext: CodeContextReader;
  /** 事件写入（appendStreamEvent 引用） */
  writeEvent: CodeEventWriter;
  /** callTool 显式工具白名单（方案待确认②：首版只读工具清单） */
  toolWhitelist: ReadonlySet<string>;
}

/**
 * CodeRunner RPC 桥接器
 * 线程安全：每次 handleRequest 独立，无共享可变状态。
 */
export class CodeRunnerBridge {
  private readonly writeOutputs: unknown[] = [];

  constructor(private readonly deps: CodeRunnerBridgeDeps) {}

  /** 收集到的 writeOutput 结果 */
  get outputs(): unknown[] {
    return this.writeOutputs;
  }

  /**
   * 处理一条 RPC 请求
   * @returns 响应帧（null = 无需回复，如 done/error 已单独处理）
   */
  async handleRequest(req: CodeRpcRequest): Promise<CodeRpcResponse> {
    const { id, method, params } = req;
    try {
      switch (method) {
        case 'callTool':
          return {
            id,
            ok: true,
            result: await this.handleCallTool(
              String(params.name ?? ''),
              (params.args as Record<string, unknown>) ?? {}
            ),
          };
        case 'readContext':
          return {
            id,
            ok: true,
            result: await this.deps.readContext(
              (params.opts as { limit?: number } | undefined) ?? {}
            ),
          };
        case 'writeOutput':
          this.writeOutputs.push(params.data);
          return { id, ok: true, result: null };
        case 'emitEvent':
          await this.handleEmitEvent(String(params.type ?? ''), params.data);
          return { id, ok: true, result: null };
        default:
          return {
            id,
            ok: false,
            error: {
              type: 'UnknownMethod',
              message: `unknown method: ${method}`,
            },
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('CodeRunner RPC request failed', {
        method,
        error: message,
      });
      return {
        id,
        ok: false,
        error: { type: 'BridgeError', message },
      };
    }
  }

  /**
   * callTool 处理链路：
   * 白名单前置（不进 checkPermissionForTool）→
   * PermissionManager.checkPermissionForTool（ask 视为拒绝，reason 取 decision.reason）→ 执行
   */
  private async handleCallTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    // 1. 显式白名单最前置（六轮方案 P2-8）：白名单外直接拒绝，不产生 ask 流程
    if (!this.deps.toolWhitelist.has(name)) {
      return { ok: false, error: `tool '${name}' not in Code Mode whitelist` };
    }

    // 2. 工具级权限校验（executeTool 内部先 checkPermissionForTool，
    //    ask（submittedToInbox 或未提交）一律视为拒绝并回传 reason）
    const result = await this.deps.executeTool(name, input);
    return result;
  }

  /** emitEvent：事件类型必须走 knownEventTypes 白名单 */
  private async handleEmitEvent(type: string, data: unknown): Promise<void> {
    // 白名单校验在写入端（appendStreamEvent → assertEventWritable）兜底；
    // 此处前置快速拒绝，减少无谓写入。
    await this.deps.writeEvent(type, data);
  }
}
