/**
 * 围栏规则（G4 / M2）：把审计事件流归一为**可判定的信号**，不参与任何 allow/ask/deny。
 *
 * 本步只实现设计文档 §4 的三条（默认**只观察**，不阻断）：
 * - **S1 静默放行空转**：`behavior=allow` + `riskLevel=high` + 无命中规则，连续 N 次。
 *   依据：主进程把「无规则匹配 ⇒ 默认放行」标为 `high`（`decisionTelemetry.auditDecision`）。
 * - **S2 deny 后重试**：同一条命令（归一后）在 deny 之后 T 秒内再次出现。
 * - **S4 沙箱姿态 fail-open**：由 `runtime` 基于姿态快照的 `openRiskCodes` 变化判定（见 `runtime.ts`）。
 *
 * 三条都遵守同一纪律：**没有证据就不判定**（时间戳缺失/不可解析 ⇒ S2 不判定；规则空序列不臆造）。
 */
import type { FenceAlertKind } from './types';

/** 审计事件里围栏真正用到的字段（其余字段原样存在但不参与判定） */
export interface FenceAuditEvent {
  timestamp: string;
  /** 裁决实际作用的命令（无 `originalCommand` 时的回退） */
  command: string;
  /** 归一后的命令（去首尾空白 + 折叠内部空白） */
  normalizedCommand: string;
  behavior: 'allow' | 'ask' | 'deny' | string;
  riskLevel: string;
  matchedRulesCount: number;
}

/** 规则阈值（B 类运行参数，见 `constants/defaults.ts`） */
export interface FenceRuleConfig {
  /** S1：连续多少次「默认放行空转」才告警 */
  silentAllowRunLength: number;
  /** S2：deny 之后多久内再次出现同命令算"重试"（毫秒） */
  denyRetryWindowMs: number;
}

/** 规则命中 → 一条告警（`kind` 与 `FenceAlertKind` 对齐） */
export interface FenceRuleFinding {
  kind: Extract<
    FenceAlertKind,
    'silent-allow-streak' | 'deny-retry' | 'sandbox-fail-open'
  >;
  detail: string;
}

/** 跨 tick 的规则状态 */
export interface FenceRuleState {
  /** S1 当前连续计数（命中告警后清零，避免同一次空转刷屏） */
  silentAllowStreak: number;
  /** S2：归一命令 → 最近一次 deny 时刻（毫秒） */
  deniedAt: Map<string, number>;
}

/** 已跟踪的命令上限（防 `deniedAt` 无界增长；超限丢最早插入的） */
const MAX_TRACKED_DENIED_COMMANDS = 500;

/**
 * S4 判定的 fail-open 编码（与主进程 `sandboxPosture.ts` 的语言中立编码同源）。
 *
 * 只认这两个：`mode-none`（无隔离证据）与 `landlock-fail-open`（初始化失败会退回无约束执行）。
 */
export const FENCE_FAIL_OPEN_CODES: readonly string[] = [
  'mode-none',
  'landlock-fail-open',
];

export function createFenceRuleState(): FenceRuleState {
  return { silentAllowStreak: 0, deniedAt: new Map() };
}

/**
 * 解析一行审计 JSON（失败返回 `undefined` —— 调用方计数并告警，不在此猜测）。
 */
export function parseAuditEvent(line: string): FenceAuditEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // @ignore-catch — 坏行由调用方计为 audit-line-invalid
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.timestamp !== 'string') return undefined;
  const rawCommand =
    typeof record.originalCommand === 'string' && record.originalCommand
      ? record.originalCommand
      : typeof record.command === 'string'
        ? record.command
        : undefined;
  if (rawCommand === undefined) return undefined;
  return {
    timestamp: record.timestamp,
    command: rawCommand,
    normalizedCommand: normalizeCommand(rawCommand),
    behavior: typeof record.behavior === 'string' ? record.behavior : 'unknown',
    riskLevel:
      typeof record.riskLevel === 'string' ? record.riskLevel : 'unknown',
    matchedRulesCount: Array.isArray(record.matchedRules)
      ? record.matchedRules.length
      : 0,
  };
}

/** 命令归一：去首尾空白 + 折叠内部空白（只用于"是否同一条命令"的比较） */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/**
 * 对**单个**审计事件求值（纯函数；S4 不在本函数内，它依赖姿态快照）。
 *
 * 返回本事件触发的告警；同时按需更新 `state`（S1 连续计数 / S2 deny 时刻表）。
 */
export function evaluateAuditEvent(
  event: FenceAuditEvent,
  state: FenceRuleState,
  config: FenceRuleConfig
): FenceRuleFinding[] {
  const findings: FenceRuleFinding[] = [];
  const atMs = Date.parse(event.timestamp);

  // ── S2：deny 后重试（先判历史，再登记本次 deny）──────────────────────────
  if (!Number.isNaN(atMs)) {
    pruneDeniedAt(state.deniedAt, atMs, config.denyRetryWindowMs);
    const deniedAt = state.deniedAt.get(event.normalizedCommand);
    if (deniedAt !== undefined && atMs - deniedAt <= config.denyRetryWindowMs) {
      findings.push({
        kind: 'deny-retry',
        detail: `命令在 ${atMs - deniedAt}ms 前被拒绝后再次出现: ${previewCommand(event.command)}`,
      });
    }
  }
  if (event.behavior === 'deny' && !Number.isNaN(atMs)) {
    state.deniedAt.set(event.normalizedCommand, atMs);
    if (state.deniedAt.size > MAX_TRACKED_DENIED_COMMANDS) {
      const oldest = state.deniedAt.keys().next().value;
      if (oldest !== undefined) state.deniedAt.delete(oldest);
    }
  }

  // ── S1：默认放行空转（连续 N 次）────────────────────────────────────────
  const isSilentAllow =
    event.behavior === 'allow' &&
    event.riskLevel === 'high' &&
    event.matchedRulesCount === 0;
  if (isSilentAllow) {
    state.silentAllowStreak += 1;
    if (state.silentAllowStreak >= config.silentAllowRunLength) {
      findings.push({
        kind: 'silent-allow-streak',
        detail: `连续 ${state.silentAllowStreak} 次"无规则匹配 ⇒ 默认放行": ${previewCommand(event.command)}`,
      });
      // 已告警 ⇒ 重新计数（同一次空转不再逐条刷屏）
      state.silentAllowStreak = 0;
    }
  } else {
    state.silentAllowStreak = 0;
  }

  return findings;
}

/** 丢弃窗口外的 deny 记录（时间戳不可解析时不做清理，保持"不猜"） */
function pruneDeniedAt(
  deniedAt: Map<string, number>,
  nowMs: number,
  windowMs: number
): void {
  for (const [command, atMs] of deniedAt) {
    if (nowMs - atMs > windowMs) deniedAt.delete(command);
  }
}

/** 告警里只放截断后的命令预览（避免把长命令整段写进告警文件） */
function previewCommand(command: string): string {
  const oneLine = command.replace(/\s+/g, ' ');
  return oneLine.length <= 120 ? oneLine : `${oneLine.slice(0, 117)}...`;
}
