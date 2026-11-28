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

import {
  getLogger,
  getOTelTracing,
  runWithActiveSpan,
} from '@openliri/infra/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@openliri/infra/error';
import { ErrorHandler } from '@openliri/kernel';
import { convergenceDetector } from '../services/ConvergenceDetector.js';
import { toolResultRegistry } from '@modules/tool/ToolResultRegistry.js';
import { resolveToolCwd } from './toolCwdScope';
// 2026-11-28：回滚录制的相对路径基准目录与工具 cwd 同源（会话工作区，缺省项目根）
import { resolveProjectRoot } from '@openliri/infra/environment';
// G8（2026-11-03）：会话工作区不可用时向事件流投影一次提示（界面可见）
import type { LiriEvent } from '@modules/session/types/events';
// T3 stage 7（2026-11-17）：媒体交付事件随图像结果登记外移至 `./imageResultRegistration`
// U-02 v2 / P3（2026-10-20）：工作区边界参数字段（与 LRO 共用同一纯函数，实现落 utils 避免 chat↔tasks 环）
import { PATH_ARG_KEYS } from '@openliri/infra/utils/toolContract';
// R07-3（2026-10-07）：非幂等工具「重试」判定（唯一实现 = tools/toolEffects）
// S2-6（2026-10-11）：工具调用统一指标（工具名/结果/耗时/入参字节/估算 tokens）—— 唯一实现 = tools/monitoring
import {
  isNonIdempotentRetry,
  recordToolInvocation,
  // 2026-11-02：工具级重试预算（幂等声明 ⇒ 允许盲目重试；非幂等/未声明 ⇒ 禁止）
  resolveToolRetryBudget,
} from '@modules/tools';
// PR-3a（2026-10-23）：本次执行的沙箱信号（唯一解析点 = sandbox/sandboxExecutionSignal）
import {
  resolveFileIoToolModeHint,
  resolveSandboxExecutionSignal,
} from '@modules/sandbox';
import type { Tool } from '../../tools/types/Tool';
import { estimateTokens } from '@modules/ai';
import { configManager } from '@openliri/infra/config';
// D7 三期（2026-11-14）：把文件副作用归属到"当前正在执行的计划步骤"（无则不属于任何计划）
import { taskOrchestrator } from '@modules/tasks';
import { withToolTimeout } from './ToolTimeoutWrapper.js';
// T3（2026-11-17）：本地查询工具（get_tool_result / session_lookup / list_tool_calls）短路
import { tryHandleLocalQueryTool } from './localQueryTools';
// T3 stage 2（2026-11-17）：入口预检守卫（渠道来源 Taint / 用户「拒绝」终态）
import { evaluateToolPreflight } from './toolPreflight';
// T3 stage 3（2026-11-17）：权限闸门（注入断言 / authorizeToolCall / ask·deny 四出口）
import { applyToolPermissionGate } from './permissionGate';
// T3 stage 4（2026-11-17）：图像输入路径守卫（补全 / 最接近修正 / 无参照拒绝）
import { guardImageInputPath } from './imagePathGuard';
// T3 stage 5（2026-11-17）：文件操作前回滚追踪（fire-and-forget）
import { trackFileOpBeforeExecute } from './rollbackTracker';
// T3 stage 6（2026-11-17）：工作区严格边界守卫（越界判定 / 失效 fail-fast / 审批分型）
import {
  formatWorkspaceRootsHint,
  guardWorkspaceBoundary,
} from './workspaceBoundaryGuard';
// 既有导入路径兼容：三个越界文案纯函数已外移，此处按原模块名 re-export
export {
  formatWorkspaceEscapeError,
  formatWorkspaceInvalidError,
  formatWorkspaceRootsHint,
} from './workspaceBoundaryGuard';
// T3 stage 7（2026-11-17）：工具「需要审批」结果整形 + 图像结果登记/媒体事件
import { resolveToolApprovalOutcome } from './toolApprovalOutcome';
import { registerImageToolResults } from './imageResultRegistration';
import {
  createFileStateCacheWithSizeLimit,
  type FileStateCache,
} from '@openliri/infra/utils/fileStateCache';
import type {
  ToolCall,
  ToolResult,
  ToolFailureKind,
  ToolIntegration,
} from '@modules/session/types/tool.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ImageContextService } from '../services/ImageContextService.js';
import type { RollbackIntegration } from '@openliri/infra/security';
// S1-1（2026-10-11）：审批作用域 / 快照类型（**仅类型导入**，运行时判定在 permission 层）
// LRO-07（2026-10-26）：deny 结构化依据（ruleId/来源/解除入口）⇒ 进工具结果 metadata
import type {
  ApprovalScope,
  ApprovalSnapshot,
  PermissionMode,
} from '@openliri/infra/permission';
// D2（2026-10-11）：权限管理器注入断言（生产 fail-fast，G9）
// T3 stage 3（2026-11-17）：权限闸门（注入断言 / authorizeToolCall / 四条出口）已外移
// `./permissionGate`；审批结果整形与指纹计算外移 `./toolApprovalOutcome`。
import type { ToolPermissionPort } from '@openliri/infra/permission';

/**
 * **工具执行瞬态**状态（状态机方案 阶段 1.3 取证抽出；消除裸字面量，CS02）。
 *
 * 按方案 阶段 2.3 裁断：这类"人在环"瞬态**不进** `ToolCallStatus` 持久化枚举（保护序列化完整性）。
 * - `awaiting_approval` 的**唯一事实源** = 本常量；
 * - `requires_approval` 的**唯一事实源** = `ToolExecutionStatus` 枚举（本文件**不复制**其字面量，
 *   守住"数出同源"）。
 */
export const TRANSIENT_AWAITING_APPROVAL = 'awaiting_approval' as const;

const logger = getLogger('chat:toolExecution');

/** O3-2（2026-09-24「会话暴露问题分析与优化方案」§五）：工具单次执行耗时告警阈值默认值（ms） */
export const DEFAULT_SLOW_TOOL_WARN_MS = 15_000;

/**
 * O3-2：工具耗时告警阈值（ms）。
 *
 * 事实来源：env `TOOL_SLOW_WARN_MS`，**经 `configManager.env()` 统一读取**（遵循架构规则
 * R05-012「env 统一出入口」；与 [PathGuard.ts](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/PathGuard.ts)
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
   * B1（2026-10-30，issue #35）：会话的**工作区根列表**（首根 = 主工作区）。
   *
   * 仅在 `FEATURE_WORKSPACE_MULTI_ROOT` 开启时消费；未注入或返回空 ⇒ 回落单根
   * `getSessionWorkspacePath()`（与改造前逐字一致）。
   */
  getSessionWorkspaceRoots?: (sessionId?: string) => string[];
  /**
   * PR-3（2026-10-23）：会话级审批模式（会话元数据 `approvalMode`，缺省 `ask`）。
   *
   * `auto-local` ⇒ 在**风险默认档**额外放行「本地写 + 路径全在会话工作区内」
   * （由 `PermissionChecker` 判定；受 `FEATURE_SESSION_AUTO_LOCAL` 开关约束）。
   */
  getSessionApprovalMode?: (sessionId?: string) => 'ask' | 'auto-local';
  /**
   * P1（2026-11-04）：会话级权限模式（会话元数据 `permission_mode`）。
   *
   * 缺省 / 脏值 ⇒ `undefined` ⇒ `PermissionManager` 回退**进程默认档**（`PERMISSION_MODE`）。
   * 以**每次调用传参**的方式生效，不改全局单例（并发会话不串档）。
   */
  getSessionPermissionMode?: (sessionId?: string) => PermissionMode | undefined;
  /**
   * P0（2026-11-17）：会话自主度（`metadata.autonomy`）。
   *
   * `demand`（许愿式）⇒ 权限层把分类器的非危险 `ask` 降级为自动放行
   * （工作区外写仍人工），兑现"中途最多问一次"。未注入 ⇒ `interactive`（零行为变更）。
   */
  getSessionAutonomy?: (sessionId?: string) => 'interactive' | 'demand';
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
   * G8（2026-11-03）：把「会话工作区不可用」投影到会话事件流（持久化 + 界面可见）。
   *
   * 缺省（未注入）⇒ 只保留日志、不投影（不伪造观测面，与 `emitSuspensionSettled` 同口径）。
   */
  appendStreamEvent?: (sessionId: string, event: LiriEvent) => Promise<unknown>;
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

  /**
   * 形态④：解析本轮可访问根（列表优先，缺省回落单根 `workspacePath`）。
   *
   * 只在入参**含路径参数**时返回提示 —— 结构判定（`PATH_ARG_KEYS`），
   * 不做文案匹配（CS02），也不会给「无路径语义」的 ask 添噪声。
   */
  private _workspaceRootsHint(
    sessionId: string | undefined,
    args: Record<string, unknown> | undefined
  ): string {
    if (!args) return '';
    const hasPathArg = PATH_ARG_KEYS.some(
      (key) =>
        typeof args[key] === 'string' && (args[key] as string).trim() !== ''
    );
    if (!hasPathArg) return '';
    const listed = this.deps.getSessionWorkspaceRoots?.(sessionId) ?? [];
    const primary = this.deps.getSessionWorkspacePath(sessionId);
    const roots = listed.length > 0 ? listed : primary ? [primary] : [];
    return formatWorkspaceRootsHint(roots);
  }

  /**
   * 2026-11-03 P0：会话工作区目录原本不存在、已在托管项目根下自动重建 ⇒ 首次投影提示。
   *
   * 为什么不静默：重建出的是**空目录**，原内容可能已被删除/移走 —— 用户必须知道
   * "任务能继续跑，但之前的产物不在里面了"（否则会误判为"文件被吞了"）。
   */
  private async notifyRecreatedSessionWorkspace(
    sessionId: string,
    workspacePath: string
  ): Promise<void> {
    const appendStreamEvent = this.deps.appendStreamEvent;
    if (!appendStreamEvent) return;
    const event: LiriEvent<'assistant/status'> = {
      type: 'assistant/status',
      schemaVersion: 1,
      seq: 0,
      time: Date.now(),
      sessionId,
      data: {
        content:
          `会话工作区不存在，已自动重建为空目录：${workspacePath}\n` +
          '任务会继续执行；但原目录里的文件可能已被删除或移走（如属误删，请用「重新定位」指回原目录）。',
        statusType: 'workspace_recreated',
      },
    };
    try {
      await appendStreamEvent(sessionId, event);
    } catch (err) {
      logger.warning('会话工作区重建提示投影失败', {
        sessionId,
        workspacePath,
        error: String(err),
      });
    }
  }

  /**
   * G8（2026-11-03）：把「会话工作区不可用」投影为 `assistant/status`（`statusType=workspace_invalid`）。
   *
   * 为什么走事件流：该提示需要**持久化 + 重载可见**（用户下次打开会话仍能看到根因），
   * 而 `logger.warning` 只在服务端日志里。投影失败**不影响**工具执行（如实记日志，不静默吞）。
   */
  private async notifyInvalidSessionWorkspace(
    sessionId: string,
    workspacePath: string
  ): Promise<void> {
    const appendStreamEvent = this.deps.appendStreamEvent;
    if (!appendStreamEvent) return;
    const event: LiriEvent<'assistant/status'> = {
      type: 'assistant/status',
      schemaVersion: 1,
      seq: 0,
      time: Date.now(),
      sessionId,
      data: {
        content:
          `会话工作区不可用：${workspacePath}\n` +
          '工具会以该无效目录启动子进程并失败（这不是 cmd.exe 缺失）。' +
          '请修正项目 sandboxPath，或为该会话指定一个真实存在的 workspacePath。',
        statusType: 'workspace_invalid',
      },
    };
    try {
      await appendStreamEvent(sessionId, event);
    } catch (err) {
      logger.warning('会话工作区无效提示投影失败', {
        sessionId,
        workspacePath,
        error: String(err),
      });
    }
  }

  /** B1：按会话维护的文件状态快照缓存（read-before-edit 的基础） */
  private readonly _readFileStateCaches = new Map<string, FileStateCache>();

  /**
   * 工作区访问申请的在途去重键（`sessionId|归一化目标路径`）。
   *
   * 并行批次里多个工具同时越界到同一目标时，DB 的 pending 去重会因并发查不到而失效
   * （实测同一目标 2–3 张卡）⇒ 用进程内集合把「正在提交」的窗口也覆盖掉。
   */
  private readonly _workspaceScopeInFlight = new Set<string>();

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
   * B1（2026-10-30，issue #35）：越界时提交「允许本会话访问 `<target>`」审批卡。
   *
   * 同一会话 + 同一目标**只建一张**（查询既有 pending 卡去重，避免每轮重复刷屏）。
   * 批准后的加根与续跑在 `runtime/inboxApproval.ts` 的统一批准副作用里落地。
   *
   * 2026-11-04（运行态排查 P0-1）：DB 去重只覆盖「已落库的 pending」，而同一轮
   * `parallel_batch_execute` 里多个工具**并发**越界到同一目标时，都会在对方 submit 之前
   * 查不到卡 ⇒ 实测同一目标出现 2–3 张卡。这里加一层**进程内在途去重**弥补竞态。
   *
   * @returns 是否已有/已建审批卡（`false` = 提交失败，调用方据此如实告知模型）
   */
  private async _requestWorkspaceScopeApproval(
    sessionId: string | undefined,
    targetPath: string
  ): Promise<boolean> {
    if (!sessionId) return false;
    // 目标键归一（大小写 / 结尾分隔符），只用于进程内去重；DB 里的原值不动。
    const inFlightKey = `${sessionId}|${targetPath
      .replace(/[\\/]+$/, '')
      .toLowerCase()}`;
    if (this._workspaceScopeInFlight.has(inFlightKey)) return true;
    this._workspaceScopeInFlight.add(inFlightKey);
    try {
      const { inboxManager, INBOX_STATUS_PENDING } =
        await import('@openliri/service/runtime/InboxManager');
      const { items } = await inboxManager.list({
        sessionId,
        // 用规范常量（状态字面量棘轮：`pending` 不得裸写）
        status: INBOX_STATUS_PENDING,
        type: 'approval',
        limit: 50,
      });
      const duplicated = items.some(
        (item) =>
          item.metadata?.kind === 'workspace-scope' &&
          item.metadata?.workspaceScopeRoot === targetPath
      );
      if (duplicated) return true;

      await inboxManager.submit({
        sessionId,
        type: 'approval',
        title: `工作区访问申请: ${targetPath}`,
        message:
          `模型请求访问会话工作区之外的路径：\n${targetPath}\n\n` +
          '批准后该路径将加入本会话的工作区根，被拒的工具调用会自动重试；' +
          '拒绝则该调用保持被拒。',
        options: ['approve', 'deny'],
        offlineCapable: true,
        source: 'permission',
        metadata: {
          kind: 'workspace-scope',
          workspaceScopeRoot: targetPath,
          sourceModule: 'workspace-boundary',
          approvalScopeKind: 'once',
        },
      });
      logger.info('工作区越界审批卡已提交', { sessionId, targetPath });
      return true;
    } catch (error) {
      logger.warn('工作区越界审批卡提交失败（按未申请处理）', {
        sessionId,
        targetPath,
        error: String(error),
      });
      return false;
    } finally {
      // 提交结束即释放：之后同一目标的重复请求由 DB 的 pending 卡去重接住。
      this._workspaceScopeInFlight.delete(inFlightKey);
    }
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
          // 2026-11-02 根因修复：盲目重试必须过「幂等声明」闸门（唯一事实源 = tools/toolEffects）。
          // 此前对所有工具写死 retry×2 ⇒ bash / file_write 等**已产生副作用后抛错**会被原样重放。
          // 2026-11-20（第 ② 步）：按 op 覆盖 —— 复合工具的只读子操作（vfs read/cron list…）可重试；
          // 不传/判别值缺失时自动回退工具级声明（保守）。
          const retryBudget = resolveToolRetryBudget(
            toolCall.name,
            toolCall.arguments
          );
          const handled = await ErrorHandler.handleAsync(
            () => withToolTimeout(runTool, toolCall),
            retryBudget
          );
          if (!handled.success && retryBudget.maxRetries === 0) {
            logger.warn('工具执行失败，且按幂等声明不自动重试', {
              toolName: toolCall.name,
            });
          }
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

    // ── 本地查询工具（T3，2026-11-17：实现外移 `./localQueryTools`，行为逐字保留）──
    const localQueryResult = await tryHandleLocalQueryTool(normalizedToolCall, {
      sessionLookup: this.deps.sessionLookup,
      currentSessionId: this.deps.currentSessionId,
    });
    if (localQueryResult) return localQueryResult;

    // ── 预检守卫（T3 stage 2，2026-11-17：实现外移 `./toolPreflight`，行为逐字保留）──
    // 顺序不变：渠道来源 Taint（不可信输入）→ 用户「拒绝」终态，均先于权限链。
    const preflightResult = evaluateToolPreflight({
      toolCall,
      isUntrustedSession: () => this._isUntrustedSession(toolCall.sessionId),
    });
    if (preflightResult) return preflightResult;

    // ── 权限检查（T3 stage 3，2026-11-17：实现外移 `./permissionGate`，行为逐字保留）──
    // 四条出口（ask 已批准 / ask 等审批 / ask 审批通道不可用 / DENY）与判上下文透传均不变。
    const permissionGate = await applyToolPermissionGate({
      toolCall,
      args: normalizedToolCall.arguments,
      deps: {
        getPermissionManager: () =>
          this.deps.getPermissionManager() as
            | ToolPermissionPort
            | null
            | undefined,
        resolveRegisteredTool: (name) => this._resolveRegisteredTool(name),
        getSessionApprovalMode: this.deps.getSessionApprovalMode,
        getSessionPermissionMode: this.deps.getSessionPermissionMode,
        getSessionWorkspacePath: (sessionId) =>
          this.deps.getSessionWorkspacePath(sessionId),
        getSessionWorkspaceRoots: this.deps.getSessionWorkspaceRoots,
        getSessionAutonomy: this.deps.getSessionAutonomy,
        isCommandApproved: (name, callArgs, sessionId, fingerprint) =>
          this.deps.isCommandApproved(name, callArgs, sessionId, fingerprint),
        workspaceRootsHint: (sessionId, callArgs) =>
          this._workspaceRootsHint(sessionId, callArgs),
        resolveNonIdempotentRetryReason: (name, callArgs, sessionId) =>
          this._resolveNonIdempotentRetryReason(name, callArgs, sessionId),
        resolveIntentText: (sessionId) => this._resolveIntentText(sessionId),
        awaitingApprovalStatus: TRANSIENT_AWAITING_APPROVAL,
      },
    });
    if (permissionGate.result) return permissionGate.result;
    // P3（2026-11-07，方案 §2.3-4）：会话权限档自动放行的来源（供下方稳态日志标注）
    const permissionAutoInfo = permissionGate.autoInfo;

    // 排查 J-1.4：权限通过（含放行缓存命中）后继续执行——记录 sessionId 是否透传（BashTool 放行缓存依赖）
    // P2-1（2026-11-04）：这是"一切正常"的逐工具稳态日志（实测 2 039 条）⇒ debug；
    // 拒绝/审批/异常路径各自仍打 warn/error，安全信号不降级。
    logger.debug('executeTool: 权限通过，继续执行', {
      toolName: normalizedToolCall.name,
      toolCallId: toolCall.id,
      sessionId: toolCall.sessionId,
      // P3（2026-11-07，方案 §2.3-4）：标注「自动放行」来源，避免与用户批准混同
      ...(permissionAutoInfo ?? {}),
    });

    // ── 回滚：文件操作前追踪（T3 stage 5，2026-11-17：实现外移 `./rollbackTracker`）──
    // 2026-11-21：改为 **await** —— 集成要在工具写入前落 pre-image 备份（undo 的内容唯一来源）；
    // 备份失败只记日志、不阻断执行（catch 在 `trackFileOpBeforeExecute` 内部）。
    await trackFileOpBeforeExecute({
      toolCall,
      args: normalizedToolCall.arguments,
      deps: {
        rollbackIntegrations: this.deps.rollbackIntegrations,
        getSession: (sessionId) =>
          this.deps.sessionGateway.getSession(sessionId),
        getRunningStep: (sessionId) =>
          taskOrchestrator.getRunningStepForSession(sessionId),
        // 2026-11-28：相对路径按工具 cwd 解析（与 `file_write` 的 `resolveFilePath` 同源），
        // 否则 pre-image/undo 会落到进程 cwd 而不是模型真实写入的位置
        getToolBaseDir: (sessionId) =>
          this.deps.getSessionWorkspacePath(sessionId) ?? resolveProjectRoot(),
      },
    });

    // ── 图像路径校验（T3 stage 4，2026-11-17：实现外移 `./imagePathGuard`，行为逐字保留）──
    // inputPath 补全 / 最接近路径修正 / 无参照拒绝 三段均不变；修正结果回填入参。
    const imageGuard = await guardImageInputPath({
      toolCall,
      args: normalizedToolCall.arguments,
      deps: {
        imageContextService: this.deps.imageContextService,
        getSession: (sessionId) => this.deps.chatSessions.get(sessionId),
        // P1-2（2026-11-28）：工作区内图件放行（模型自己写出的 SVG 等可被 image 工具读回）
        getSessionWorkspacePath: (sessionId) =>
          this.deps.getSessionWorkspacePath(sessionId),
      },
    });
    if (imageGuard.result) return imageGuard.result;
    if (imageGuard.patchedArgs) {
      normalizedToolCall.arguments = imageGuard.patchedArgs;
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
        // P2-4（2026-10-27）：本地身份的**裸会话**在编译版下改用会话级 workspace（传 sessionId）
        const cwdDecision = resolveToolCwd(sessionWorkspacePath, undefined, {
          sessionId: toolCall.sessionId,
        });
        // G8（2026-11-03）：会话工作区不可用 ⇒ 首次向事件流投影一条系统提示。
        // 修复前只写 `logger.warning`，用户看不到「项目路径失效」才是根因（导出记录里
        // 用户与模型都在猜 `cmd.exe` 缺失）。去重由 `toolCwdScope` 按（会话, 路径）完成。
        if (
          toolCall.sessionId &&
          cwdDecision.shouldNotifyInvalidWorkspace &&
          cwdDecision.invalidSessionWorkspace
        ) {
          await this.notifyInvalidSessionWorkspace(
            toolCall.sessionId,
            cwdDecision.invalidSessionWorkspace
          );
        }
        // 2026-11-03 P0：目录已被自动重建 ⇒ 首次投影一条提示（用户需知道"原内容可能已丢失"）
        if (
          toolCall.sessionId &&
          cwdDecision.shouldNotifyRecreatedWorkspace &&
          cwdDecision.recreatedSessionWorkspace
        ) {
          await this.notifyRecreatedSessionWorkspace(
            toolCall.sessionId,
            cwdDecision.recreatedSessionWorkspace
          );
        }
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

        // ── 工作区严格边界（T3 stage 6，2026-11-17：实现外移 `./workspaceBoundaryGuard`）──
        // 越界判定（单根/多根灰度）、工作区失效 fail-fast、审批卡与分型口径均不变。
        const boundaryBlock = await guardWorkspaceBoundary({
          toolCall,
          args: normalizedToolCall.arguments,
          sessionWorkspacePath: sessionWorkspacePath ?? undefined,
          deps: {
            isSessionWorkspaceStrict: this.deps.isSessionWorkspaceStrict,
            getSessionWorkspaceRoots: this.deps.getSessionWorkspaceRoots,
            requestWorkspaceScopeApproval: (sessionId, resolved) =>
              this._requestWorkspaceScopeApproval(sessionId, resolved),
          },
        });
        if (boundaryBlock) return boundaryBlock;

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

        // 工具返回"需要审批"（T3 stage 7，2026-11-17：实现外移 `./toolApprovalOutcome`）
        // 已批准指纹复跑 / 提交审批卡 / 提交失败回传工具错误，三段口径不变。
        const approvalOutcome = await resolveToolApprovalOutcome({
          toolCall,
          args: normalizedToolCall.arguments,
          toolResult,
          executeAgain: () =>
            registry.executeTool(
              {
                toolName: normalizedToolCall.name,
                input: normalizedToolCall.arguments,
              },
              context,
              onProgress
            ),
          deps: {
            isCommandApproved: (name, callArgs, sessionId, fingerprint) =>
              this.deps.isCommandApproved(
                name,
                callArgs,
                sessionId,
                fingerprint
              ),
            submitToolApproval: (
              name,
              callArgs,
              sessionId,
              toolCallId,
              reason,
              scope,
              snapshot
            ) =>
              this.deps.submitToolApproval(
                name,
                callArgs,
                sessionId,
                toolCallId,
                reason,
                scope,
                snapshot
              ),
            resolveRegisteredTool: (name) => this._resolveRegisteredTool(name),
            awaitingApprovalStatus: TRANSIENT_AWAITING_APPROVAL,
          },
        });
        if (approvalOutcome) return approvalOutcome;

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

        // 注册图像工具输出路径 + 媒体交付事件
        // （T3 stage 7，2026-11-17：实现外移 `./imageResultRegistration`，判据口径不变）
        registerImageToolResults({
          toolCall,
          args: normalizedToolCall.arguments,
          resultData: toolResult.data as Record<string, unknown> | undefined,
          hasError: Boolean(error),
          deps: { imageContextService: this.deps.imageContextService },
        });

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
