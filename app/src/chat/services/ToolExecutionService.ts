// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ToolExecutionService — 工具执行服务
 *
 * P3（08-09）：从 ChatManager 提取 executeTool + _executeToolInternal，
 * 降低 ChatManager 上帝类复杂度。
 *
 * 依赖注入：所有 ChatManager 实例依赖通过构造函数注入，服务本身无状态。
 */

import fs from 'fs';
import { join } from 'path';
import {
  getLogger,
  getOTelTracing,
  runWithActiveSpan,
} from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { ErrorHandler, feature } from '@openliri/kernel';
import { convergenceDetector } from '../services/ConvergenceDetector.js';
import { eventNotificationService } from '../services/EventNotificationService.js';
import { toolResultRegistry } from '../../tool/ToolResultRegistry.js';
import { resolveDataDir } from '@openliri/kernel/paths';
import { resolveToolCwd } from './toolCwdScope';
// 多租户 P0 阶段 2：请求级权限角色（桌面/后台无请求作用域 ⇒ null ⇒ 保持既有回退语义）
import {
  getRequestPermissionRole,
  getRequestPrincipal,
} from '@openliri/kernel/identity/requestScope.js';
import { ToolExecutionStatus } from '@modules/utils/toolContract/ToolResult';
import { isMediaOutputToolName } from '@modules/utils/toolContract/toolRoles';
// U-02 v2 / P3（2026-10-20）：工作区边界判定（与 LRO 共用同一纯函数，实现落 utils 避免 chat↔tasks 环）
import { findWorkspaceEscape } from '@modules/utils/toolContract';
import type { ToolName } from '@modules/constants/toolNames.generated';
import { FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME } from '@modules/constants';
// R07-3（2026-10-07）：非幂等工具「重试」判定（唯一实现 = tools/toolEffects）
// S2-6（2026-10-11）：工具调用统一指标（工具名/结果/耗时/入参字节/估算 tokens）—— 唯一实现 = tools/monitoring
import {
  isBlockedForUntrustedOrigin,
  isNonIdempotentRetry,
  recordToolInvocation,
} from '@modules/tools';
// PR-3a（2026-10-23）：本次执行的沙箱信号（唯一解析点 = sandbox/sandboxExecutionSignal）
import {
  resolveFileIoToolModeHint,
  resolveSandboxExecutionSignal,
} from '@modules/sandbox';
import type { Tool, SandboxExecutionSignal } from '../../tools/types/Tool';
import { estimateTokens } from '@modules/ai';
import { configManager } from '@modules/config';
import { withToolTimeout } from './ToolTimeoutWrapper.js';
import {
  createFileStateCacheWithSizeLimit,
  type FileStateCache,
} from '../../utils/fileStateCache';
import type {
  ToolCall,
  ToolResult,
  ToolFailureKind,
  ToolIntegration,
} from '@modules/session/types/tool.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ImageContextService } from '../services/ImageContextService.js';
import type { RollbackIntegration, FileOperation } from '@modules/security';
// S1-1（2026-10-11）：审批作用域 / 快照类型（**仅类型导入**，运行时判定在 permission 层）
// LRO-07（2026-10-26）：deny 结构化依据（ruleId/来源/解除入口）⇒ 进工具结果 metadata
import type {
  ApprovalScope,
  ApprovalSnapshot,
  PermissionDenyInfo,
} from '@modules/permission';
// D2（2026-10-11）：权限管理器注入断言（生产 fail-fast，G9）
import {
  assertPermissionManagerInjected,
  resolveApprovalFingerprint,
} from '@modules/permission';

/**
 * **工具执行瞬态**状态（状态机方案 阶段 1.3 取证抽出；消除裸字面量，CS02）。
 *
 * 按方案 阶段 2.3 裁断：这类"人在环"瞬态**不进** `ToolCallStatus` 持久化枚举（保护序列化完整性）。
 * - `awaiting_approval` 的**唯一事实源** = 本常量；
 * - `requires_approval` 的**唯一事实源** = `ToolExecutionStatus` 枚举（本文件**不复制**其字面量，
 *   守住"数出同源"）。
 */
const TRANSIENT_AWAITING_APPROVAL = 'awaiting_approval' as const;

const logger = getLogger('chat:toolExecution');

/** O3-2（2026-09-24「会话暴露问题分析与优化方案」§五）：工具单次执行耗时告警阈值默认值（ms） */
export const DEFAULT_SLOW_TOOL_WARN_MS = 15_000;

/**
 * O3-2：工具耗时告警阈值（ms）。
 *
 * 事实来源：env `TOOL_SLOW_WARN_MS`，**经 `configManager.env()` 统一读取**（遵循架构规则
 * R05-012「env 统一出入口」；与 [PathGuard.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/query/PathGuard.ts)
 * 的既有做法一致）。缺失/非法 ⇒ 默认 15s；纯函数（入参可注入便于单测）。
 */
export function resolveSlowToolWarnMs(
  raw: string | undefined = readSlowToolWarnEnv()
): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SLOW_TOOL_WARN_MS;
}

/** 读取 env 统一出入口；配置层不可用（如单测未初始化）⇒ 返回 undefined 走默认值 */
function readSlowToolWarnEnv(): string | undefined {
  try {
    return configManager.env('TOOL_SLOW_WARN_MS');
  } catch {
    // @ignore-catch — 配置层不可用等价于"未配置"，退化为默认阈值；不影响工具执行（CS03）
    return undefined;
  }
}

/* ===================================================================
 *  #5（2026-09-24）耗时构成分解：把"慢"拆成可行动的线索（只观测）
 *  ---------------------------------------------------------------
 *  原 O3-2 只回答"多慢"；本组函数回答"**慢在哪**"：
 *   · `summarizeToolScope`  ⇒ 作用范围（路径 / pattern / include…）→ 判断是否范围过大
 *   · `summarizeToolScale`  ⇒ 结果规模 + **遍历规模**（工具自报）→ 区分"遍历太多"与"单文件慢"
 *   · `resolveToolReportedMs`⇒ 工具内部耗时 → 与出口总耗时相减得**包装/排队开销**
 *  全部只读真实存在的字段，工具未提供则**省略该字段**（不臆造，CS06）。
 * =================================================================== */

/** 入参中代表"作用范围"的白名单键（只取这些，避免把正文/敏感值写进日志） */
const SCOPE_ARG_KEYS = [
  'searchPath',
  'path',
  'dir',
  'directory',
  'file_path',
  'filePath',
  'glob',
  'include',
  'pattern',
  'query',
  'type',
] as const;

/** 单个范围值的最大字符数（超出则截断并标注原长） */
const SCOPE_VALUE_MAX_CHARS = 120;

/**
 * #5：从工具入参提取「作用范围」线索。
 * @returns 无任何白名单键 ⇒ `undefined`（调用方省略该字段）
 */
export function summarizeToolScope(
  args: unknown
): Record<string, string> | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const source = args as Record<string, unknown>;
  const scope: Record<string, string> = {};
  for (const key of SCOPE_ARG_KEYS) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value);
    scope[key] =
      text.length > SCOPE_VALUE_MAX_CHARS
        ? `${text.slice(0, SCOPE_VALUE_MAX_CHARS)}…(共 ${text.length} 字)`
        : text;
  }
  return Object.keys(scope).length > 0 ? scope : undefined;
}

/** 工具 `data` 中代表"规模"的白名单键（只读；缺失即不出现） */
const SCALE_DATA_KEYS = [
  'matchCount',
  'fileCount',
  'truncated',
  'durationMs',
  'skipped',
  'totalItems',
  'lineCount',
] as const;

/**
 * #5：从**工具自报 payload** 提取「结果规模 / 遍历规模」。
 *
 * 入参是工具自报的数据对象本身 —— 在 chat 域它是 `ToolResultEntry.result`
 * （`_executeInternal` 的 `result: toolResult.data`），
 * 在 tools 域是 `ToolResult.data`，**二者同物**。故本函数不依赖任一侧的 `ToolResult` 类型。
 *
 * `entries`/`files` 摊平为 `scannedEntries`/`scannedFiles`（统一口径便于日志聚合）。
 * 注：chat 域结果**不携带返回正文**，故不产出 `outputChars`（不臆造，CS06）。
 */
export function summarizeToolScale(
  payload: unknown
): Record<string, unknown> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const scale: Record<string, unknown> = {};
  const source = payload as Record<string, unknown>;
  for (const key of SCALE_DATA_KEYS) {
    const value = source[key];
    if (typeof value === 'number' || typeof value === 'boolean') {
      scale[key] = value;
    }
  }
  const stats = source['stats'];
  if (typeof stats === 'object' && stats !== null) {
    const nested = stats as Record<string, unknown>;
    if (typeof nested['entries'] === 'number') {
      scale['scannedEntries'] = nested['entries'];
    }
    if (typeof nested['files'] === 'number') {
      scale['scannedFiles'] = nested['files'];
    }
  }
  return Object.keys(scale).length > 0 ? scale : undefined;
}

/**
 * #5：工具自报耗时（`data.durationMs`）。
 * @returns 未提供或非有限数 ⇒ `undefined`（调用方不得据此臆测开销）
 */
export function resolveToolReportedMs(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const value = (data as Record<string, unknown>)['durationMs'];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/* ===================================================================
 *  ToolExecutionDeps — 服务依赖接口
 * =================================================================== */

export interface ToolExecutionDeps {
  getToolRegistry: () => unknown;
  getToolIntegration: () => ToolIntegration | null;
  getPermissionManager: () => unknown;
  imageContextService: ImageContextService;
  rollbackIntegrations: Map<string, RollbackIntegration>;
  sessionGateway: {
    getSession(sessionId: string): Promise<unknown>;
  };
  chatSessions: Map<string, ChatSession>;
  currentSessionId: string;
  enableErrorHandler: boolean;
  submitToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string | undefined,
    toolCallId: string,
    approvalReason?: string,
    /** S1-1：工具声明的执行作用域（随审批卡片一并记录，执行时须一致） */
    approvalScope?: ApprovalScope,
    /** S1-1：审批快照（原始命令 / 规范化命令 / 改写项），供审批卡与执行字符串对账 */
    approvalSnapshot?: ApprovalSnapshot
  ): Promise<string | null>;
  getSessionWorkspacePath(sessionId?: string): string | null | undefined;
  getSessionWorkspaceId(sessionId?: string): string | undefined;
  /**
   * U-02 v2 / P3（2026-10-20）：会话是否声明**工作区严格边界**
   * （`metadata.workspaceStrict === true`，目前仅 AlwaysOn 隔离轮设置）。
   *
   * 为 true 时，工具路径入参必须落在 `getSessionWorkspacePath()` 内（绝对路径 / `../`
   * 越界直接拒绝）；未注入或为 false ⇒ **零行为变更**（普通会话的绝对路径语义不变）。
   */
  isSessionWorkspaceStrict?: (sessionId?: string) => boolean;
  /**
   * PR-3（2026-10-23）：会话级审批模式（会话元数据 `approvalMode`，缺省 `ask`）。
   *
   * `auto-local` ⇒ 在**风险默认档**额外放行「本地写 + 路径全在会话工作区内」
   * （由 `PermissionChecker` 判定；受 `FEATURE_SESSION_AUTO_LOCAL` 开关约束）。
   */
  getSessionApprovalMode?: (sessionId?: string) => 'ask' | 'auto-local';
  isCommandApproved(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
    /** PR-2：工具声明的授权维度（缺省 = 全参数稳定 JSON，零行为变更） */
    approvalFingerprint?: string
  ): Promise<boolean>;
  /**
   * R3（2026-09-21）：会话级流式中断控制器（ChatManager 拥有，本服务仅读取）。
   *
   * 用于给工具执行 context 注入 `abortController` —— 修复前主聊天路径构造的 context
   * **没有该字段**（被下方 `registry` 的内联类型断言掩盖）⇒ `tool.execute` 收到
   * `context.abortController === undefined`，AgentTool 的"父级取消信号桥接"在真机**空转**：
   * 用户点停止只能中止 LLM 流，无法传导到并行批次（未启动的 worker 照常投递）。
   */
  getSessionAbortController?: (
    sessionId?: string
  ) => AbortController | undefined;
  /**
   * C 阶段（2026-09-02，P1）：session_lookup 取回执行回调（ChatManager 拥有事件日志
   * 与派生器，负责实现；本服务仅转发）。返回按页格式化原文与下一页起点。
   */
  sessionLookup?: (args: {
    sessionId: string;
    fromSeq?: number;
    toSeq?: number;
    offset?: number;
    limit?: number;
  }) => Promise<{
    ok: boolean;
    content?: string;
    nextFromSeq?: number;
    reason?: string;
  }>;
}

/* ===================================================================
 *  ToolExecutionService
 * =================================================================== */

export class ToolExecutionService {
  constructor(public readonly deps: ToolExecutionDeps) {}

  /** B1：按会话维护的文件状态快照缓存（read-before-edit 的基础） */
  private readonly _readFileStateCaches = new Map<string, FileStateCache>();

  /** B1：获取/创建指定会话的文件状态缓存 */
  getReadFileStateCache(sessionId: string | undefined): FileStateCache {
    const key = sessionId || 'default';
    let cache = this._readFileStateCaches.get(key);
    if (!cache) {
      cache = createFileStateCacheWithSizeLimit(100);
      this._readFileStateCaches.set(key, cache);
    }
    return cache;
  }

  /**
   * 语义护栏「便宜版」（2026-10-21）：取该会话**最近一条用户消息**作为意图文本。
   *
   * 只读、零副作用；找不到（无会话 / 无用户消息 / 内容为空）⇒ `undefined`
   * ⇒ 权限侧的偏离检查**不判**（宁漏勿误，见 `utils/toolContract/intentActionDeviation.ts`）。
   */
  private _resolveIntentText(sessionId?: string): string | undefined {
    const sid = sessionId ?? this.deps.currentSessionId;
    const session = this.deps.chatSessions.get(sid);
    if (!session) return undefined;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const message = session.messages[i];
      if (!message) continue;
      if (String(message.role).toLowerCase() !== 'user') continue;
      const content =
        typeof message.content === 'string' ? message.content.trim() : '';
      if (content) return content;
    }
    return undefined;
  }

  /**
   * R07-3（2026-10-07）：非幂等工具「重试」⇒ 返回把该次调用**升级为审批**的理由；无需升级 ⇒ `undefined`。
   *
   * - 判据唯一实现 = `tools/toolEffects.ts#isNonIdempotentRetry`（同工具名 + **同参数** + 上次失败）；
   * - 历史 = 本会话已记录的工具调用（`toolResultRegistry`，**进程内**）⇒ 重启后历史清空，
   *   故"跨重启重放"不被判定（spec §7-2 已如实登记）；
   * - 无 `sessionId` ⇒ 无历史可比 ⇒ 不升级（CS03：不猜测）。
   */
  private _resolveNonIdempotentRetryReason(
    name: string,
    args: Record<string, unknown>,
    sessionId?: string
  ): string | undefined {
    if (!sessionId) return undefined;
    const history = toolResultRegistry.listBySession(sessionId).map((c) => ({
      toolName: c.toolName,
      arguments: c.arguments,
      error: c.result?.error,
    }));
    if (!isNonIdempotentRetry(name, args, history)) return undefined;
    return (
      `非幂等工具 '${name}' 的「重试」需要用户审批：本会话中**同参数**的上一次调用已失败，` +
      '原样重放可能造成副作用重复（重复写入 / 发送 / 扣费）。请确认后再执行。'
    );
  }

  /**
   * 取已注册的工具对象（未注册 / 懒加载未解包 ⇒ `undefined`）。
   *
   * 两处消费同口径（2026-10-23）：① 权限判定按工具**声明**派生风险（PR-0）；
   * ② 文件类工具的 `modeHint`（方案 A：只有 `sandboxLevel === 'file-io'` 才可能
   * 在容器/远端工作区里执行）。取不到 ⇒ 调用方各自回退（不猜）。
   */
  private _resolveRegisteredTool(name: string): Tool | undefined {
    try {
      const registry = this.deps.getToolRegistry() as {
        getTool?: (name: string) => Tool | undefined;
      } | null;
      return registry?.getTool?.(name);
    } catch {
      return undefined;
    }
  }

  /* ===============================================================
   *  execute() — 工具执行入口（原 ChatManager.executeTool）
   * =============================================================== */

  async execute(
    toolCall: ToolCall,
    // 2026-08-24 进度链路打通：opts 增加 onProgress（工具细粒度进度回调）
    opts?: {
      useErrorHandler?: boolean;
      onProgress?: (progress: {
        toolUseID: string;
        data: Record<string, unknown>;
      }) => void;
    }
  ): Promise<ToolResult> {
    const otel = getOTelTracing();
    const toolSpan = otel.startSpan(`chat.executeTool.${toolCall.name}`, {
      'tool.name': toolCall.name,
    });
    // 让工具 span 在执行期间**活动**：下游出站（MCP 等）据此注入 traceparent（§6-#6）
    const runTool = () =>
      runWithActiveSpan(toolSpan, () =>
        this._executeInternal(toolCall, opts?.onProgress)
      );
    const startedAt = Date.now();
    // #5（2026-09-24）：留存本次结果，供 finally 的耗时构成分解读取（工具自报规模/耗时）
    let latestResult: ToolResult | undefined;
    try {
      // Phase 2: ErrorHandler 双路径
      if (opts?.useErrorHandler && this.deps.enableErrorHandler) {
        try {
          const handled = await ErrorHandler.handleAsync(
            () => withToolTimeout(runTool, toolCall),
            { recoveryStrategy: 'retry', maxRetries: 2 }
          );
          const resolved: ToolResult =
            handled.success && handled.result
              ? handled.result
              : {
                  toolCallId: toolCall.id ?? '',
                  toolName: toolCall.name,
                  error: handled.error
                    ? String(handled.error)
                    : 'Tool execution failed',
                };
          latestResult = resolved;
          return resolved;
        } catch (err) {
          await handleError(err, {
            module: 'chat:toolExecution',
            action: 'executeTool_errorHandler_fallback',
          });
          logger.warn('ErrorHandler failed, falling back to direct execution', {
            error: err instanceof Error ? err.message : String(err),
          });
          latestResult = await withToolTimeout(runTool, toolCall);
          return latestResult;
        }
      }
      const result = await withToolTimeout(runTool, toolCall);
      latestResult = result;
      // Phase 2: 收敛检测
      try {
        convergenceDetector.recordToolCall(
          toolCall.sessionId ?? '',
          toolCall.name,
          !result.error,
          toolCall.arguments as Record<string, unknown> | undefined
        );
      } catch (err) {
        logger.debug('convergenceDetector.recordToolCall skipped', {
          toolName: toolCall.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return result;
    } catch (err) {
      await handleError(err, {
        module: 'chat:toolExecution',
        action: 'executeTool_fallback',
      });
      // S2-6：把 catch 的终态也落到 `latestResult`，使 `finally` 的统一指标能如实记 `result=error`
      latestResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
      return latestResult;
    } finally {
      // S2-6（2026-10-11）：**工具调用统一指标**（唯一出口 ⇒ 一处插桩覆盖全部路径）。
      // 误调用率 = `tools.invocation.total{tool,result=error}` / 同 tool 的 total（派生，CS02 不做文案分类）。
      const inputJson = JSON.stringify(toolCall.arguments ?? {});
      recordToolInvocation({
        toolName: toolCall.name,
        durationMs: Date.now() - startedAt,
        success: latestResult !== undefined && !latestResult.error,
        inputBytes: inputJson.length,
        estimatedTokens: estimateTokens(inputJson),
      });
      // O3-2（2026-09-24「会话暴露问题分析与优化方案」§五）：**工具耗时探针**。
      // 现象来源：导出记录 §二 的实测读数（grep 56.3s / file_read 56.0s / glob·grep 30.4s×3），
      // 与"静默终止"叠加放大"长时间无反馈"的观感（问题清单 P2）。此前**无统一耗时观测点**
      //（各搜索工具自报的 `durationMs` 不覆盖全部工具，也无阈值告警）。
      // 本处是工具执行的统一出口 ⇒ 一处插桩覆盖全部路径（只观测，不改行为）。
      const elapsedMs = Date.now() - startedAt;
      toolSpan.setAttribute('tool.elapsed_ms', elapsedMs);
      const slowWarnMs = resolveSlowToolWarnMs();
      if (elapsedMs >= slowWarnMs) {
        // #5（2026-09-24，本次追加）：把"慢"分解为可行动的构成 ——
        //  · `scope`：作用范围（路径/pattern/include…）⇒ 判断是否范围过大
        //  · `scale`：结果规模 + **遍历规模**（工具自报）⇒ 区分"遍历范围大"与"单文件读取慢"
        //  · `toolReportedMs` / `overheadMs`：工具内部耗时 vs 出口总耗时 ⇒ 包装/排队开销
        // 工具未提供对应数据时**省略该字段**（不臆造，CS06）。
        const scope = summarizeToolScope(toolCall.arguments);
        // chat 域 `ToolResult.result` 即工具自报 payload（见 `_executeInternal` 的
        // `result: toolResult.data || toolResult.result`）
        const scale = summarizeToolScale(latestResult?.result);
        const toolReportedMs = resolveToolReportedMs(latestResult?.result);
        logger.warn('工具执行耗时超过告警阈值（O3-2 探针）', {
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          sessionId: toolCall.sessionId ?? '',
          elapsedMs,
          thresholdMs: slowWarnMs,
          ...(scope ? { scope } : {}),
          ...(scale ? { scale } : {}),
          ...(toolReportedMs !== undefined
            ? { toolReportedMs, overheadMs: elapsedMs - toolReportedMs }
            : {}),
        });
      }
      toolSpan.end();
    }
  }

  /* ===============================================================
   *  _executeInternal() — 工具执行核心逻辑（原 ChatManager._executeToolInternal）
   * =============================================================== */

  /**
   * T25-07（2026-10-25）：该会话是否被标记为**不可信来源**（渠道入站驱动）。
   *
   * 判定：会话元数据 `origin === 'channel'`（由 `streamMessageToolLoop` 在渠道轮次打标，
   * **只升不降**）。无会话 / 无标记 ⇒ **可信**（桌面 / REPL / CLI 零行为变更）。
   * 只读内存态（同一会话对象），无 DB 往返。
   */
  private _isUntrustedSession(sessionId?: string): boolean {
    if (!sessionId) return false;
    const session = this.deps.chatSessions.get(sessionId);
    return session?.metadata?.['origin'] === 'channel';
  }

  private async _executeInternal(
    toolCall: ToolCall,
    // 2026-08-24 进度链路打通：透传 onProgress 到 registry.executeTool → tool.execute
    onProgress?: (progress: {
      toolUseID: string;
      data: Record<string, unknown>;
    }) => void
  ): Promise<ToolResult> {
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments as Record<string, unknown>,
    };

    // ── 本地查询工具 ──
    if (normalizedToolCall.name === 'get_tool_result') {
      const targetId = normalizedToolCall.arguments.tool_call_id as string;
      const stored = toolResultRegistry.findByCallId(targetId);
      logger.info('LLM 查询工具结果', {
        toolCallId: toolCall.id,
        targetId,
        found: !!stored,
      });
      if (!stored) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: { found: false, toolCallId: targetId },
          error: undefined,
        };
      }
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: { found: true, toolCall: stored },
        error: undefined,
      };
    }

    // ── C 阶段（2026-09-02，P1）：session_lookup — 按事件区间取回被切早期原文 ──
    if (normalizedToolCall.name === 'session_lookup') {
      const args = normalizedToolCall.arguments as {
        sessionId?: string;
        fromSeq?: number;
        toSeq?: number;
        offset?: number;
        limit?: number;
      };
      if (!this.deps.sessionLookup) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: {
            ok: false,
            error:
              'session_lookup 未在当前运行环境注册（分层关闭或非会话上下文）',
          },
          error: undefined,
        };
      }
      const sessionId = args.sessionId || this.deps.currentSessionId || '';
      const lookup = await this.deps.sessionLookup({
        sessionId,
        fromSeq: args.fromSeq,
        toSeq: args.toSeq,
        offset: args.offset,
        limit: args.limit,
      });
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: {
          ok: lookup.ok,
          ...(lookup.ok
            ? { content: lookup.content ?? '', nextFromSeq: lookup.nextFromSeq }
            : { error: lookup.reason ?? '取回失败' }),
        },
        error: undefined,
      };
    }

    if (normalizedToolCall.name === 'list_tool_calls') {
      const targetRound = normalizedToolCall.arguments.round as
        | number
        | undefined;
      const sessionId =
        (normalizedToolCall.arguments.sessionId as string) ||
        this.deps.currentSessionId ||
        '';
      let calls: Array<{
        toolCallId: string;
        toolName: string;
        round: number;
        hasError: boolean;
        timestamp: number;
      }>;
      if (targetRound && sessionId) {
        calls = toolResultRegistry
          .listByRound(sessionId, targetRound)
          .map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            round: c.round,
            hasError: !!c.result.error,
            timestamp: c.timestamp,
          }));
      } else if (sessionId) {
        calls = toolResultRegistry.listBySession(sessionId).map((c) => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          round: c.round,
          hasError: !!c.result.error,
          timestamp: c.timestamp,
        }));
      } else {
        calls = toolResultRegistry
          .listAll()
          .map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            round: c.round,
            hasError: !!c.result.error,
            timestamp: c.timestamp,
          }))
          .slice(0, 50);
      }
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: {
          toolCalls: calls,
          total: calls.length,
          sessionId: sessionId || undefined,
        },
        error: undefined,
      };
    }

    // ── T25-07（2026-10-25 用户裁定）：渠道来源 Taint（不可信输入）──
    // 会话由外部通道入站驱动 ⇒ `sideEffect !== 'none'` 的工具一律拒绝（external + local）。
    // 判定复用 `tools/toolEffects.ts`（唯一事实源，不按工具名硬编码）；未声明效果（MCP/插件）fail-closed。
    if (
      feature('CHANNEL_UNTRUSTED_TAINT') &&
      this._isUntrustedSession(toolCall.sessionId) &&
      isBlockedForUntrustedOrigin(normalizedToolCall.name)
    ) {
      logger.warn(
        'chat:untrusted_origin_blocked — 渠道来源会话拒绝副作用工具',
        {
          toolName: normalizedToolCall.name,
          toolCallId: toolCall.id,
          sessionId: toolCall.sessionId,
        }
      );
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: { blocked: true, reason: 'UNTRUSTED_ORIGIN' },
        error:
          `该会话由外部通道入站驱动（不可信来源），已拒绝执行有副作用的工具「${normalizedToolCall.name}」。` +
          '如需执行，请在桌面端 / REPL 继续该会话。',
      };
    }

    // ── 权限检查 ──
    // D2（2026-10-11 用户裁定「启动 fail-fast 断言」）：权限管理器未注入是**装配异常** ⇒
    // 生产/开发路径 **fail-fast**（抛错拒绝执行，不再 fail-open 静默跳过）；测试环境保留 fail-open。
    // 原（2026-10-08）仅补 warn、语义仍 fail-open（G9）。
    if (!this.deps.getPermissionManager()) {
      logger.warn(
        '权限管理器未注入 ⇒ 权限检查缺失；生产路径预期由 CoreAPIImpl 注入 createPermissionManager()' +
          '（测试环境按约定 fail-open，其余环境将 fail-fast 拒绝执行）',
        { toolName: normalizedToolCall.name, toolCallId: toolCall.id }
      );
      assertPermissionManagerInjected(
        this.deps.getPermissionManager(),
        'chat:toolExecution'
      );
    }
    if (this.deps.getPermissionManager()) {
      const pm = this.deps.getPermissionManager() as {
        checkPermissionForTool: (
          name: string,
          args: Record<string, unknown>,
          context?: {
            sessionId?: string;
            /** 多租户 P0 阶段 2：请求级角色（缺省 ⇒ 权限层回退进程级角色） */
            userRole?: string;
            forceAskReason?: string;
            /** 语义护栏「便宜版」（2026-10-21）：意图文本（最近一条用户消息） */
            metadata?: { goalText?: string };
            /** PR-3：会话级审批模式（`auto-local` = 只读 + 工作区内本地写自动执行） */
            approvalMode?: 'ask' | 'auto-local';
            /** PR-3：会话工作区路径（自动执行的写边界） */
            workspacePath?: string;
            /** PR-3a：本次执行的沙箱上下文（审批卡留证；不改判定） */
            sandbox?: SandboxExecutionSignal;
          }
        ) => Promise<{
          allowed: boolean;
          reason?: string;
          decision?: { behavior: string; reason?: string };
          submittedToInbox?: boolean;
          /** U-06-5：已提交的 Inbox 项 id（前端就地审批） */
          inboxItemId?: string;
          /** LRO-07：规则拒绝的结构化依据（缺省 = 非规则拒绝或无依据） */
          denyInfo?: PermissionDenyInfo;
        }>;
      };
      // R07-3（2026-10-07）：非幂等工具的「重试」⇒ 执行前**主动分流**为审批
      // （原实现仅把 `[重试注意]` 写进 tool 结果回传模型，属**被动**提示）。
      // 多租户 P0 阶段 2：把**请求作用域**里的角色带进权限判定 ——
      // 已认证请求各带各的角色（并发登录不再互相覆盖）；本地/后台 ⇒ null ⇒ 不传，
      // 权限层回退进程级角色，桌面端行为与改造前一致。
      const requestRole = getRequestPermissionRole();
      // PR-0（2026-10-23）：把**工具对象**带进权限判定 —— 风险类别按工具声明派生
      // （`riskClass`/`riskClassFor`/`TOOL_EFFECTS`/`sandboxLevel`），不再按工具名猜。
      // 取不到（未注册/懒加载未解包）⇒ 传 undefined，权限层回退旧启发式（行为零变更）。
      const permissionTool = this._resolveRegisteredTool(
        normalizedToolCall.name
      );
      const permissionResult = await pm.checkPermissionForTool(
        normalizedToolCall.name,
        normalizedToolCall.arguments,
        {
          sessionId: toolCall.sessionId,
          ...(requestRole ? { userRole: requestRole } : {}),
          ...(permissionTool ? { tool: permissionTool } : {}),
          // PR-3：会话级审批模式 + 工作区边界（自动执行只放行工作区内的本地写）
          approvalMode:
            this.deps.getSessionApprovalMode?.(toolCall.sessionId) ?? 'ask',
          workspacePath:
            this.deps.getSessionWorkspacePath(toolCall.sessionId) ?? undefined,
          // PR-3a（2026-10-23）：沙箱信号 —— 审批卡留证 + PR-3b 豁免判定。
          // 方案 A（同批）：文件类工具（`file-io`）若真在容器/远端工作区执行，则由
          // `modeHint` 如实上报（Landlock 只包命令子进程，不代表文件 IO 被隔离）；
          // 无映射/本地工作区 ⇒ 不给提示（保持 `none`，fail-closed）。
          sandbox: resolveSandboxExecutionSignal({
            modeHint: resolveFileIoToolModeHint(permissionTool?.sandboxLevel),
          }),
          forceAskReason: this._resolveNonIdempotentRetryReason(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId
          ),
          // 语义护栏「便宜版」：把本轮意图文本带进权限判定（缺失 ⇒ 护栏不判）
          metadata: {
            goalText: this._resolveIntentText(toolCall.sessionId),
          },
        }
      );

      if (!permissionResult.allowed) {
        if (permissionResult.decision?.behavior === 'ask') {
          const approvedHit = await this.deps.isCommandApproved(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId,
            resolveApprovalFingerprint(
              permissionTool ?? normalizedToolCall.name,
              normalizedToolCall.arguments
            )
          );
          if (!approvedHit) {
            if (permissionResult.submittedToInbox === true) {
              // 企业审批镜像（**默认关**）：把同一条审批投给企业审批流，
              // 由企业侧批准/拒绝后再回灌 Inbox（单一赢家由 CAS 保证）。
              // 动态 import：该路径**只在实际出现 ASK 时**走到，且镜像模块会连带加载
              // 企业审批管理器 —— 静态引入会让它进启动面（棘轮 +1.3KB）。
              void import('@modules/runtime/execApprovalBridge.js')
                .then(({ mirrorAskToEnterpriseApproval }) => {
                  mirrorAskToEnterpriseApproval({
                    inboxItemId: permissionResult.inboxItemId,
                    toolName: normalizedToolCall.name,
                    toolInput: normalizedToolCall.arguments,
                    requester: getRequestPrincipal().userId,
                    description: permissionResult.reason ?? '工具执行需要审批',
                    sessionId: toolCall.sessionId,
                  });
                })
                .catch((error: unknown) => {
                  // @ignore-catch — 镜像失败不影响原审批流程（Inbox 卡片仍然有效）
                  logger.debug('企业审批镜像加载失败（忽略）', {
                    toolName: normalizedToolCall.name,
                    error: String(error),
                  });
                });
              const approvalResult = {
                status: TRANSIENT_AWAITING_APPROVAL,
                message: `工具 '${normalizedToolCall.name}' 需要审批，已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
                // U-06-5：Inbox 项 id —— 前端工具卡片就地审批（无则退回卡片/收件箱入口）
                inboxId: permissionResult.inboxItemId,
              } as const;
              eventNotificationService.emitCustomEvent('tool:completed', {
                toolName: normalizedToolCall.name,
                sessionId: toolCall.sessionId,
                toolCallId: toolCall.id,
                resultData: approvalResult,
              });
              return {
                toolCallId: toolCall.id,
                toolName: normalizedToolCall.name,
                result: approvalResult,
                error: undefined,
              };
            }
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              // P0-2（2026-10-27）：审批通道不可用必须**可见**。
              // 此前只回「需要用户确认」，用户以为在等审批，而审批卡从未生成（实测会话
              // `session_mvoqs1ho875ea6b95e` 连续 13 次因此被判失败且无人可批）。
              error:
                `需要用户确认，但审批通道不可用（${permissionResult.reason || 'Inbox 提交失败'}）：` +
                '本次调用未排队；请先修复审批通道（如数据库迁移/权限目录）后重新发起。',
              // LRO-09：审批未能提交（Inbox 不可用等）⇒ 环境层阻塞，非模型输出问题
              failureKind: 'permission_denied',
              metadata: { approvalChannelDown: true },
            };
          }
        } else {
          return {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
            result: null,
            error: `Permission denied: ${permissionResult.reason || 'Tool execution not allowed'}`,
            // LRO-09：权限决策为 DENY（结构化依据）⇒ 重试不会改变结果
            failureKind: 'permission_denied',
            // LRO-07（2026-10-26）：把「哪条规则、来源、怎么解除」**结构化**带进工具结果
            //（此前只有一句 reason，`decision.context` 在归一化时被截断 ⇒ 上游只能看到文案）
            ...(permissionResult.denyInfo
              ? { metadata: { permissionDeny: permissionResult.denyInfo } }
              : {}),
          };
        }
      }
    }

    // 排查 J-1.4：权限通过（含放行缓存命中）后继续执行——记录 sessionId 是否透传（BashTool 放行缓存依赖）
    logger.info('executeTool: 权限通过，继续执行', {
      toolName: normalizedToolCall.name,
      toolCallId: toolCall.id,
      sessionId: toolCall.sessionId,
    });

    // ── 回滚：文件操作前追踪 ──
    if (
      normalizedToolCall.name === FILE_WRITE_TOOL_NAME ||
      normalizedToolCall.name === FILE_EDIT_TOOL_NAME
    ) {
      const filePath = normalizedToolCall.arguments?.file_path as
        | string
        | undefined;
      if (filePath && toolCall.sessionId) {
        const integration = this.deps.rollbackIntegrations.get(
          toolCall.sessionId
        );
        if (integration) {
          const op: FileOperation = { path: filePath, type: 'modified' };
          integration.onToolBeforeExecute(op).catch((err) => {
            logger.warn('回滚：文件操作前追踪失败', { error: String(err) });
            handleError(err, {
              module: 'chat:toolExecution',
              action: 'rollback:onToolBeforeExecute',
            }).catch(() => {});
          });
        }

        this.deps.sessionGateway
          .getSession(toolCall.sessionId)
          .then((rawSess) => {
            const sess = rawSess as ChatSession | null | undefined;
            const parentId = sess?.metadata?.parentSessionId as
              | string
              | undefined;
            if (parentId) {
              const parentIntegration =
                this.deps.rollbackIntegrations.get(parentId);
              if (parentIntegration) {
                const op: FileOperation = { path: filePath, type: 'modified' };
                parentIntegration.onToolBeforeExecute(op).catch((err) => {
                  logger.debug('子Agent操作继承失败', {
                    error: String(err),
                    parentSessionId: parentId,
                  });
                });
              }
            }
          })
          .catch(() => {
            // 非关键路径
          });
      }
    }

    // ── 图像路径校验 ──
    // 2026-09-29（P2-3 / T2）：真名由 `satisfies readonly ToolName[]` 编译期校验（拼错 ⇒ typecheck 报错）
    const IMAGE_INPUT_TOOL_NAME_LIST = [
      'image_analysis',
      'image',
    ] as const satisfies readonly ToolName[];
    const IMAGE_INPUT_TOOLS = new Set<string>(IMAGE_INPUT_TOOL_NAME_LIST);
    const IMAGE_TOOL_NAME_LIST = [
      ...IMAGE_INPUT_TOOL_NAME_LIST,
      'image_svg_generate',
      'canvas',
    ] as const satisfies readonly ToolName[];
    const IMAGE_TOOL_NAMES = new Set<string>(IMAGE_TOOL_NAME_LIST);
    if (IMAGE_INPUT_TOOLS.has(normalizedToolCall.name) && toolCall.sessionId) {
      const args = normalizedToolCall.arguments;
      let inputPath = (args.inputPath || args.file_path || args.path) as
        | string
        | undefined;

      if (!inputPath && normalizedToolCall.name === 'canvas') {
        const elements = args.elements as Array<{ src?: string }> | undefined;
        if (Array.isArray(elements) && elements.length > 0 && elements[0].src) {
          inputPath = elements[0].src;
        }
      }

      if (!inputPath) {
        const ctx = this.deps.imageContextService.getImageContext(
          toolCall.sessionId
        );
        if (ctx) {
          if (normalizedToolCall.name === 'image') {
            inputPath =
              ctx.lastEditedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastAnalyzedImage?.filePath;
          } else {
            inputPath =
              ctx.lastAnalyzedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastEditedImage?.filePath;
          }
          if (inputPath) {
            logger.info('工具调用 inputPath 为空，从 imageContext 自动补全', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              autoFilledPath: inputPath,
            });
            normalizedToolCall.arguments = { ...args, inputPath };
          }
        }
      }

      if (inputPath) {
        let knownPaths = this.deps.imageContextService.getKnownImagePaths(
          toolCall.sessionId
        );

        try {
          const session = this.deps.chatSessions.get(toolCall.sessionId);
          const projectId = session?.metadata?.projectId as string | undefined;
          if (projectId) {
            const { createProjectStore } =
              await import('../../workspace/ProjectStore.js');
            const { WorkItemStore } =
              await import('../../workspace/WorkItemStore.js');
            const store = createProjectStore(
              resolveDataDir(),
              new WorkItemStore(resolveDataDir())
            );
            const project = store.get(projectId);
            if (project?.sandboxPath && fs.existsSync(project.sandboxPath)) {
              const SANDBOX_IMAGE_EXTS = [
                '.png',
                '.jpg',
                '.jpeg',
                '.svg',
                '.webp',
              ];
              const collect = (dir: string, depth: number): string[] => {
                if (depth > 3) return [];
                let out: string[] = [];
                let entries: import('fs').Dirent[] = [];
                try {
                  entries = fs.readdirSync(dir, { withFileTypes: true });
                } catch {
                  return out;
                }
                for (const e of entries) {
                  if (out.length >= 200) break;
                  const full = join(dir, e.name);
                  if (e.isDirectory()) {
                    if (e.name.startsWith('_')) continue;
                    out = out.concat(collect(full, depth + 1));
                  } else if (
                    e.isFile() &&
                    SANDBOX_IMAGE_EXTS.some((x) =>
                      e.name.toLowerCase().endsWith(x)
                    )
                  ) {
                    out.push(full);
                  }
                }
                return out;
              };
              knownPaths = knownPaths.concat(collect(project.sandboxPath, 0));
            }
          }
        } catch {
          // @ignore-catch
        }

        if (knownPaths.length > 0 && !knownPaths.includes(inputPath)) {
          const closestPath = this.deps.imageContextService.findClosestPath(
            inputPath,
            knownPaths
          );

          if (closestPath) {
            logger.warn('工具调用路径不匹配，自动修正为最接近的已知路径', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              correctedPath: closestPath,
            });
            normalizedToolCall.arguments = { ...args, inputPath: closestPath };
          } else {
            logger.error('工具调用路径不在已知集合中，拒绝执行', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              knownPaths,
            });
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              error: `Invalid path: ${inputPath} is not in known image paths. Available paths: ${knownPaths.join(', ')}`,
            };
          }
        }
      }
    }

    // ── 工具执行 ──
    if (this.deps.getToolRegistry()) {
      try {
        // R3（2026-09-21）：取本会话的流式中断控制器（见 `ToolExecutionDeps` 说明）
        const sessionAbortController = this.deps.getSessionAbortController?.(
          toolCall.sessionId
        );
        const sessionWorkspacePath = this.deps.getSessionWorkspacePath(
          toolCall.sessionId
        );
        // 多租户 P3：cwd 按请求身份分治（本地身份与改造前逐字相同；已认证身份只落在
        // 自己的 `<scoped>/workspace` 内，越界的会话工作区被忽略）
        const cwdDecision = resolveToolCwd(sessionWorkspacePath);
        const context = {
          toolUseId: normalizedToolCall.id,
          sessionId: toolCall.sessionId,
          // PR-3a（2026-10-23）：注入本次执行的沙箱信号（审批卡证据；PR-3b 的豁免判定读它）。
          // 无隔离证据 ⇒ `mode: 'none'`（fail-closed，不当成"沙箱内已放行"）；
          // 文件类工具在隔离工作区执行时按 `modeHint` 如实上报（与权限判定同口径）。
          sandbox: resolveSandboxExecutionSignal({
            modeHint: resolveFileIoToolModeHint(
              this._resolveRegisteredTool(normalizedToolCall.name)?.sandboxLevel
            ),
          }),
          options: {
            cwd: cwdDecision.cwd,
            workspaceId: this.deps.getSessionWorkspaceId(toolCall.sessionId),
            // R05-012：整份 env 经统一出入口取快照（浅拷贝；消费方为 `{...process.env, ...options.env}`
            // 合并用法，语义等价且不会被工具经该引用改写进程环境）
            env: configManager.envSnapshot(),
          },
          // B1：注入会话级文件状态缓存（FileReadTool 记录 / FileEditTool 校验新鲜度）
          readFileState: this.getReadFileStateCache(toolCall.sessionId),
          // R3（2026-09-21）：注入**会话级**中断控制器 —— 用户点"停止"时
          // `ChatManager._sessionAbortControllers.get(sid).abort()` 由此一路传导到
          // 工具内部（AgentTool 并行批次据它短路未投递的 worker、中止在飞的 worker）。
          // 取不到（无会话 / 非流式调用）时**不注入**：宁缺勿造假 controller ——
          // `getEmptyToolUseContext()` 那种"new 一个没人 abort 的 controller"正是
          // 桥接空转的成因，禁止在此复刻。
          ...(sessionAbortController
            ? { abortController: sessionAbortController }
            : {}),
        };

        // U-02 v2 / P3（2026-10-20）：**仅当会话显式声明工作区严格边界**（AlwaysOn 隔离轮）
        // 才做越界拒绝 —— 普通项目会话的绝对路径语义保持历史行为（零变更）。
        if (
          sessionWorkspacePath &&
          this.deps.isSessionWorkspaceStrict?.(toolCall.sessionId) === true
        ) {
          const escape = findWorkspaceEscape(
            sessionWorkspacePath,
            normalizedToolCall.arguments
          );
          if (escape) {
            logger.warn('工具路径越界，已拒绝执行（会话工作区严格边界）', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              argKey: escape.key,
              argValue: escape.value,
              resolved: escape.resolved,
              via: escape.via,
              workspace: sessionWorkspacePath,
            });
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              error:
                `路径越界：${escape.key}=${escape.value} 不在会话工作区内；` +
                '请改用工作区内相对路径。',
            };
          }
        }

        const registry = this.deps.getToolRegistry() as unknown as {
          executeTool: (
            params: { toolName: string; input: Record<string, unknown> },
            context: {
              toolUseId: string;
              options: Record<string, unknown>;
            },
            // 2026-08-24 进度链路打通：registry.executeTool 透传 onProgress
            onProgress?: (progress: {
              toolUseID: string;
              data: Record<string, unknown>;
            }) => void
          ) => Promise<{
            data?: unknown;
            error?: string;
            metadata?: { error?: string };
            output?: string;
            status?: string;
            requireApproval?: boolean;
            approvalReason?: string;
            // LRO-09：工具侧的结构化失败分类（如 BashTool 预处理 ⇒ safety_blocked）
            failureKind?: ToolFailureKind;
          }>;
        };
        const toolResult = await registry.executeTool(
          {
            toolName: normalizedToolCall.name,
            input: normalizedToolCall.arguments,
          },
          context,
          onProgress
        );

        // 工具返回"需要审批"
        if (
          (toolResult as { requireApproval?: boolean }).requireApproval ===
            true ||
          (toolResult as { status?: string }).status ===
            (ToolExecutionStatus.REQUIRES_APPROVAL as string)
        ) {
          const approvalReason = (toolResult as { approvalReason?: string })
            .approvalReason;
          // S1-1：若工具在结果 metadata 中声明了审批作用域（如 BashTool 的 cwd/env/平台），
          // 随卡片提交 ⇒ 批准时写入放行缓存 ⇒ 执行端作用域不一致即不命中（fail-closed）。
          const approvalScope = (
            toolResult as { metadata?: { approvalScope?: ApprovalScope } }
          ).metadata?.approvalScope;
          const approvalSnapshot = (
            toolResult as { metadata?: { approvalSnapshot?: ApprovalSnapshot } }
          ).metadata?.approvalSnapshot;
          // PR-1（2026-10-23）：已批准过**同一指纹** ⇒ 不再建卡，直接复跑一次
          // （工具内部会命中 `isToolCallApproved` 并真正执行；仅重试一次，避免递归）。
          if (
            await this.deps.isCommandApproved(
              normalizedToolCall.name,
              normalizedToolCall.arguments,
              toolCall.sessionId,
              resolveApprovalFingerprint(
                (() => {
                  try {
                    const lookup = (
                      this.deps.getToolRegistry() as {
                        getTool?: (n: string) => Tool | undefined;
                      } | null
                    )?.getTool?.(normalizedToolCall.name);
                    return lookup ?? normalizedToolCall.name;
                  } catch {
                    return normalizedToolCall.name;
                  }
                })(),
                normalizedToolCall.arguments
              )
            )
          ) {
            logger.info('工具级审批已命中放行缓存，直接复跑（不再建卡）', {
              toolName: normalizedToolCall.name,
              toolCallId: toolCall.id,
            });
            const retried = await registry.executeTool(
              {
                toolName: normalizedToolCall.name,
                input: normalizedToolCall.arguments,
              },
              context,
              onProgress
            );
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: retried.data ?? retried.output,
              error:
                typeof retried.error === 'string' ? retried.error : undefined,
            };
          }
          const submitted = await this.deps.submitToolApproval(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId,
            toolCall.id,
            approvalReason,
            approvalScope,
            approvalSnapshot
          );
          if (submitted) {
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: {
                status: TRANSIENT_AWAITING_APPROVAL,
                message: `工具 '${normalizedToolCall.name}' 需要审批（${
                  approvalReason || '高风险操作'
                }），已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
                // U-06-5：Inbox 项 id —— 前端工具卡片就地审批
                inboxId: submitted,
              },
              error: undefined,
            };
          }
          const rawError =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : toolResult.metadata?.error
                ? String(toolResult.metadata.error)
                : undefined;
          return {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
            result:
              (toolResult as { output?: string }).output || toolResult.data,
            error: rawError,
          };
        }

        // 检查错误
        let error: string | undefined;
        if (toolResult.error) {
          error =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : JSON.stringify(toolResult.error);
        } else if (toolResult.metadata?.error) {
          error =
            typeof toolResult.metadata.error === 'string'
              ? toolResult.metadata.error
              : JSON.stringify(toolResult.metadata.error);
        }

        // 注册图像工具输出路径
        const resultData = toolResult.data as
          | Record<string, unknown>
          | undefined;
        if (resultData && !error && toolCall.sessionId) {
          const extractedPaths =
            this.deps.imageContextService.extractImagePathsFromResult(
              normalizedToolCall.name,
              resultData
            );
          if (extractedPaths.length > 0) {
            this.deps.imageContextService.registerImagePaths(
              toolCall.sessionId,
              extractedPaths
            );
          }

          this.deps.imageContextService.updateImageContext(
            toolCall.sessionId,
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            resultData
          );

          if (
            (normalizedToolCall.name === 'glob' ||
              normalizedToolCall.name === 'FileSearch') &&
            Array.isArray(resultData) &&
            toolCall.sessionId
          ) {
            const searchPath =
              (normalizedToolCall.arguments?.path as string) || process.cwd();
            this.deps.imageContextService.confirmedPaths.addDirectoryListing(
              searchPath,
              resultData as string[]
            );
          }

          if (
            // A-4（2026-10-18）：媒体交付类工具改走角色集合；`create_project` 是该工具**自身契约**
            // （导航建议 + 会话关联），不属角色判定，保留显式比较。
            isMediaOutputToolName(normalizedToolCall.name) ||
            normalizedToolCall.name === 'create_project'
          ) {
            eventNotificationService.emitCustomEvent('tool:completed', {
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              toolCallId: toolCall.id,
              images: (resultData as Record<string, unknown>).images,
              resultData,
            });
          }
        }

        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: toolResult.data,
          error,
          metadata: toolResult.metadata as Record<string, unknown> | undefined,
          // LRO-09：工具在结构化拒绝处写入的分类（如 BashTool 预处理 ⇒ safety_blocked）随结果透传
          failureKind: toolResult.failureKind,
        };
      } catch (error) {
        handleError(error, {
          module: 'chat:toolExecution',
          action: '工具执行失败',
          context: {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
          },
        }).catch(() => {});
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else if (this.deps.getToolIntegration()) {
      try {
        return this.deps.getToolIntegration()!.executeTool(toolCall);
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      throw new AppError(
        'No tool integration or tool registry initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }
}
