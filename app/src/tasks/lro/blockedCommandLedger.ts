// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * blockedCommandLedger —— LRO-13（2026-10-26）：**已判定不可执行的命令台账**。
 *
 * **要解决的问题**：同一会话连续两次「请继续」时，模型会把被安全门硬拒的**同一条命令**
 * 原样再撞一次（真机窗口：`bash` 被 `path_safety` / `dangerous_command` 拦下 → 步骤失败 →
 * 续跑 → 同命令再拦一次）。拦截本身是**确定性**的（同命令 + 同 cwd + 同策略版本 ⇒ 同结论），
 * 因此续跑时应当**直接短路并附既有结论**，而不是重放。
 *
 * **键的构成**：`sha256(toolName \0 规范化命令 \0 cwd \0 策略版本)` 取前 32 位。
 * - 规范化：`trim` + 连续空白折叠为单空格（shell 语义下空白不影响命令身份）；
 * - cwd：同一命令在不同目录的判定可能不同（路径类拦截）；
 * - 策略版本：策略强度/规则集合变化即让旧结论**自动失效**（见 `commandPolicyVersion.ts`）。
 *
 * **只在显式标记下记账**（CS02：禁止用错误文案做状态判断）：只认
 * `metadata.securityIntercepted === true`（与 `lro/stepHelpers.isSecurityIntercepted` 同源）。
 * 普通工具报错（文件不存在、参数错）**不入账**——那不是"确定性撞墙"，重放有意义。
 */

import { createHash } from 'node:crypto';
import type { ToolFailureKind } from '@modules/session/types/tool.js';
import { isSecurityIntercepted } from './stepHelpers.js';

/** 台账上限（保留最近 N 条；超出丢最旧，避免 checkpoint 无限膨胀） */
export const BLOCKED_COMMAND_MAX_ENTRIES = 50;

/** 具备"命令"语义、可参与短路重放的工具（其它工具不参与，避免误伤） */
const REPLAYABLE_COMMAND_TOOLS = new Set(['bash', 'powershell']);

/** 一条已判定不可执行的命令记录（随 checkpoint 持久化） */
export interface BlockedCommandEntry {
  /** 见 `blockedCommandKey` */
  key: string;
  toolName: string;
  /** 规范化后的命令原文（供人读/日志） */
  command: string;
  cwd: string;
  policyVersion: string;
  /** 既有结论（安全门给出的 reason，如 `path_safety`） */
  reason: string;
  recordedAt: number;
  taskId?: string;
}

/** 短路查询入参（完整版：`policyVersion` 由 host 补） */
export interface BlockedCommandProbe {
  toolName: string;
  args?: Record<string, unknown>;
  cwd: string;
  policyVersion: string;
}

/** 记账入参（完整版：`policyVersion` / `taskId` 由 host 补） */
export interface BlockedCommandCandidate {
  toolName: string;
  args?: Record<string, unknown>;
  cwd: string;
  policyVersion: string;
  /** 工具原始返回（用于读 `metadata.securityIntercepted` / reason） */
  result: unknown;
  taskId?: string;
  now?: number;
}

/** 调用方（步骤执行）传给 host 的查询入参（不含策略版本） */
export type BlockedCommandProbeInput = Pick<
  BlockedCommandProbe,
  'toolName' | 'args' | 'cwd'
>;

/** 调用方（步骤执行）传给 host 的记账入参（不含策略版本/任务 id） */
export type BlockedCommandCandidateInput = Pick<
  BlockedCommandCandidate,
  'toolName' | 'args' | 'cwd' | 'result'
>;

/** 命令规范化（只折叠空白：shell 语义下 `a  b` 与 `a b` 是同一条命令） */
export function normalizeBlockedCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/** 该工具是否参与短路重放 */
export function isCommandTool(toolName: string): boolean {
  return REPLAYABLE_COMMAND_TOOLS.has(toolName);
}

/** 从工具入参里取命令文本（非命令工具/缺参 ⇒ undefined） */
export function readCommandFromArgs(
  args: Record<string, unknown> | undefined
): string | undefined {
  const command = args?.command;
  if (typeof command !== 'string' || command.trim() === '') return undefined;
  return normalizeBlockedCommand(command);
}

/** 台账键：`(工具, 规范化命令, cwd, 策略版本)` */
export function blockedCommandKey(input: {
  toolName: string;
  command: string;
  cwd: string;
  policyVersion: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.toolName,
        normalizeBlockedCommand(input.command),
        input.cwd,
        input.policyVersion,
      ].join('\u0000')
    )
    .digest('hex')
    .slice(0, 32);
}

/** 读既有结论（优先安全门写的 `metadata.reason`，其次错误/正文摘要） */
export function readBlockedReason(result: unknown): string {
  const r = result as
    | { metadata?: { reason?: unknown }; error?: unknown; data?: unknown }
    | null
    | undefined;
  const reason = r?.metadata?.reason;
  if (typeof reason === 'string' && reason.trim() !== '') {
    return reason.trim().slice(0, 120);
  }
  for (const text of [r?.error, r?.data]) {
    if (typeof text === 'string' && text.trim() !== '') {
      return text.trim().slice(0, 200);
    }
  }
  return 'security-intercepted';
}

/**
 * 由一次工具结果生成台账条目（不满足条件 ⇒ undefined，调用方无需再判断）。
 *
 * 入账条件（全部满足）：命令工具 **且** 入参含命令 **且** 结果是**安全门硬拦截**
 * （`metadata.securityIntercepted === true`）。
 */
export function makeBlockedCommandEntry(
  input: BlockedCommandCandidate
): BlockedCommandEntry | undefined {
  if (!isCommandTool(input.toolName)) return undefined;
  const command = readCommandFromArgs(input.args);
  if (!command) return undefined;
  if (!isSecurityIntercepted(input.result)) return undefined;
  return {
    key: blockedCommandKey({ ...input, command }),
    toolName: input.toolName,
    command,
    cwd: input.cwd,
    policyVersion: input.policyVersion,
    reason: readBlockedReason(input.result),
    recordedAt: input.now ?? Date.now(),
    ...(input.taskId ? { taskId: input.taskId } : {}),
  };
}

/** 短路查询：命中则返回既有条目（`policyVersion` 已进键 ⇒ 换策略后自然不命中） */
export function findBlockedReplay(
  entries: readonly BlockedCommandEntry[],
  probe: BlockedCommandProbe
): BlockedCommandEntry | undefined {
  if (!isCommandTool(probe.toolName)) return undefined;
  const command = readCommandFromArgs(probe.args);
  if (!command) return undefined;
  const key = blockedCommandKey({ ...probe, command });
  return entries.find((e) => e.key === key);
}

/** 追加/覆盖一条记录（同键覆盖为最新），并按上限裁剪最旧 */
export function pushBlockedCommand(
  entries: readonly BlockedCommandEntry[],
  entry: BlockedCommandEntry,
  max: number = BLOCKED_COMMAND_MAX_ENTRIES
): BlockedCommandEntry[] {
  const next = entries.filter((e) => e.key !== entry.key);
  next.push(entry);
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * 从 checkpoint 原始值恢复台账（**不可信输入**：逐条校验字段类型，丢弃残缺项）。
 *
 * 只做结构校验，不重新计算 `key`（key 已含策略版本；重算会让"旧版本结论"变成"新版本"，
 * 反而绕过失效语义）。
 */
export function restoreBlockedCommands(raw: unknown): BlockedCommandEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockedCommandEntry[] = [];
  for (const item of raw) {
    const e = item as Partial<BlockedCommandEntry> | null | undefined;
    if (!e) continue;
    if (
      typeof e.key !== 'string' ||
      typeof e.toolName !== 'string' ||
      typeof e.command !== 'string' ||
      typeof e.cwd !== 'string' ||
      typeof e.policyVersion !== 'string' ||
      typeof e.reason !== 'string'
    ) {
      continue;
    }
    out.push({
      key: e.key,
      toolName: e.toolName,
      command: e.command,
      cwd: e.cwd,
      policyVersion: e.policyVersion,
      reason: e.reason,
      recordedAt: typeof e.recordedAt === 'number' ? e.recordedAt : 0,
      ...(typeof e.taskId === 'string' ? { taskId: e.taskId } : {}),
    });
  }
  return out.slice(-BLOCKED_COMMAND_MAX_ENTRIES);
}

/** 宿主（LRTO）注入的台账读写面依赖 */
export interface HostBlockedCommandLedgerDeps {
  getEntries: () => readonly BlockedCommandEntry[];
  setEntries: (value: BlockedCommandEntry[]) => void;
  taskId: string;
  /** 步首取定的策略版本（进键 ⇒ 策略变化后旧结论失效） */
  policyVersion: string;
  /** 入账成功回调（宿主用于结构化日志；可选） */
  onRecorded?: (entry: BlockedCommandEntry, total: number) => void;
}

/**
 * 宿主侧台账读写面（步骤执行经 `StepExecutionDeps.blockedCommands` 使用）。
 *
 * 把"补策略版本/任务 id + 去重裁剪 + 回写宿主字段"收敛在这一处，
 * 宿主只持有数组本身（并随 checkpoint 持久化）。
 */
export function createHostBlockedCommandLedger(
  deps: HostBlockedCommandLedgerDeps
) {
  return {
    find: (probe: BlockedCommandProbeInput) =>
      findBlockedReplay(deps.getEntries(), {
        ...probe,
        policyVersion: deps.policyVersion,
      }),
    record: (probe: BlockedCommandCandidateInput) => {
      const entry = makeBlockedCommandEntry({
        ...probe,
        policyVersion: deps.policyVersion,
        taskId: deps.taskId,
      });
      if (!entry) return;
      const next = pushBlockedCommand(deps.getEntries(), entry);
      deps.setEntries(next);
      deps.onRecorded?.(entry, next.length);
    },
  };
}

/** 短路结果（**不执行工具**）：把既有结论原样交给模型，附上"不要重复"的明确指令 */
export function blockedReplayResult(
  entry: BlockedCommandEntry,
  call: { id?: string; name: string }
): {
  toolCallId?: string;
  toolName: string;
  error: string;
  failureKind: ToolFailureKind;
} {
  return {
    toolCallId: call.id,
    toolName: call.name,
    error:
      `[BLOCKED_REPLAY] 该命令此前已被判定为不可执行（原因：${entry.reason}，工作目录：${entry.cwd}），` +
      '本次续跑**不再重放**。请改用其它命令/路径，或先解除该限制后再试；原样重复不会改变结论。',
    failureKind: 'safety_blocked',
  };
}
