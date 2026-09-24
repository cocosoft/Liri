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
import { getLogger, getOTelTracing } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { ErrorHandler } from '@modules/core';
import { convergenceDetector } from '../services/ConvergenceDetector.js';
import { eventNotificationService } from '../services/EventNotificationService.js';
import { toolResultRegistry } from '../../tool/ToolResultRegistry.js';
import { resolveDataDir, resolveProjectRoot } from '@modules/core/paths';
import { FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME } from '@modules/constants';
import { configManager } from '@modules/config';
import { withToolTimeout } from './ToolTimeoutWrapper.js';
import {
  createFileStateCacheWithSizeLimit,
  type FileStateCache,
} from '../../utils/fileStateCache';
import type { ToolCall, ToolResult, ToolIntegration } from '../types/tool.js';
import type { ChatSession } from '../types/session.js';
import type { ImageContextService } from '../services/ImageContextService.js';
import type { RollbackIntegration, FileOperation } from '@modules/security';

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
 * 入参是工具自报的数据对象本身 —— 在 chat 域它是 `ToolResult.result`
 * （`_executeInternal` 的 `result: toolResult.data || toolResult.result`），
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
    approvalReason?: string
  ): Promise<boolean>;
  getSessionWorkspacePath(sessionId?: string): string | null | undefined;
  getSessionWorkspaceId(sessionId?: string): string | undefined;
  isCommandApproved(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string
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
    const startedAt = Date.now();
    // #5（2026-09-24）：留存本次结果，供 finally 的耗时构成分解读取（工具自报规模/耗时）
    let latestResult: ToolResult | undefined;
    try {
      // Phase 2: ErrorHandler 双路径
      if (opts?.useErrorHandler && this.deps.enableErrorHandler) {
        try {
          const handled = await ErrorHandler.handleAsync(
            () =>
              withToolTimeout(
                () => this._executeInternal(toolCall, opts?.onProgress),
                toolCall
              ),
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
          latestResult = await withToolTimeout(
            () => this._executeInternal(toolCall, opts?.onProgress),
            toolCall
          );
          return latestResult;
        }
      }
      const result = await withToolTimeout(
        () => this._executeInternal(toolCall, opts?.onProgress),
        toolCall
      );
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
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
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

    // ── 权限检查 ──
    if (this.deps.getPermissionManager()) {
      const pm = this.deps.getPermissionManager() as {
        checkPermissionForTool: (
          name: string,
          args: Record<string, unknown>,
          context?: { sessionId?: string }
        ) => Promise<{
          allowed: boolean;
          reason?: string;
          decision?: { behavior: string; reason?: string };
          submittedToInbox?: boolean;
        }>;
      };
      const permissionResult = await pm.checkPermissionForTool(
        normalizedToolCall.name,
        normalizedToolCall.arguments,
        { sessionId: toolCall.sessionId }
      );

      if (!permissionResult.allowed) {
        if (permissionResult.decision?.behavior === 'ask') {
          const approvedHit = await this.deps.isCommandApproved(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId
          );
          if (!approvedHit) {
            if (permissionResult.submittedToInbox === true) {
              const approvalResult = {
                status: 'awaiting_approval',
                message: `工具 '${normalizedToolCall.name}' 需要审批，已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
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
              error: `需要用户确认: ${permissionResult.reason || 'Tool requires approval'}`,
            };
          }
        } else {
          return {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
            result: null,
            error: `Permission denied: ${permissionResult.reason || 'Tool execution not allowed'}`,
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
    const IMAGE_INPUT_TOOLS = new Set(['image_analysis', 'image']);
    const IMAGE_TOOL_NAMES = new Set([
      ...IMAGE_INPUT_TOOLS,
      'image_svg_generate',
      'canvas',
    ]);
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
              const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
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
                    IMAGE_EXTS.some((x) => e.name.toLowerCase().endsWith(x))
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
        const context = {
          toolUseId: normalizedToolCall.id,
          sessionId: toolCall.sessionId,
          options: {
            cwd:
              this.deps.getSessionWorkspacePath(toolCall.sessionId) ??
              resolveProjectRoot(),
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
            result?: unknown;
            data?: unknown;
            error?: string;
            metadata?: { error?: string };
            output?: string;
            status?: string;
            requireApproval?: boolean;
            approvalReason?: string;
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
          (toolResult as { status?: string }).status === 'requires_approval'
        ) {
          const approvalReason = (toolResult as { approvalReason?: string })
            .approvalReason;
          const submitted = await this.deps.submitToolApproval(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId,
            toolCall.id,
            approvalReason
          );
          if (submitted) {
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: {
                status: 'awaiting_approval',
                message: `工具 '${normalizedToolCall.name}' 需要审批（${
                  approvalReason || '高风险操作'
                }），已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
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
              (toolResult as { output?: string }).output ||
              toolResult.data ||
              toolResult.result,
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
        const resultData = (toolResult.data || toolResult.result) as
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
            normalizedToolCall.name === 'image_generate' ||
            normalizedToolCall.name === 'image_display' ||
            normalizedToolCall.name === 'video_display' ||
            normalizedToolCall.name === 'audio_play' ||
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
          result: toolResult.data || toolResult.result,
          error,
          metadata: toolResult.metadata as Record<string, unknown> | undefined,
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
