/**
 * Checkpoint 边界策略（P5-4，2026-10-28）—— 规格见 `.trae/specs/p5-runtime-hardening-specs.md` §3
 *
 * ## 要解决的问题
 * 现有 `CheckpointService` 是**按需触发**的文件/消息快照。「边界」指的是一条**派生规则**：
 * > 不可逆操作（**有副作用 ∧ 非幂等**）执行**之前**，同会话必须存在一个 checkpoint；
 * > 否则按模式处理 —— `strict` 拒绝执行，`relaxed` 先补建一个再执行（建失败 ⇒ 拒绝）。
 *
 * ## 为什么是"派生"而不是清单
 * 不可逆性的事实源是 `tools/toolEffects.ts` 的 `TOOL_EFFECTS`（`Record<ToolName, …>`，漏声明
 * 编译失败）。手写"需要 checkpoint 的工具清单"必然与它漂移（CS01 / AC-11 同源）。
 *
 * ## 未声明工具（MCP / 插件）
 * 判为**需要** checkpoint（fail-closed：无法证明只读 ⇒ 当不可逆处理）。与
 * `isBlockedForUntrustedOrigin` / `resolveToolRecoveryPolicy` 的"未声明即保守"口径一致。
 *
 * ## 接线状态（如实标注，2026-10-28）
 * 本模块**纯函数、零副作用、尚无运行时消费者**。接线到 `ChatManager.executeTool` 需要新增
 * `default-off` 开关，而内核 `featureFlags.ts` 的体量棘轮（K08：`loc=13727 ≤ 13727`）**已顶格**
 * ⇒ 新增一行即红。抬基线与"只减不增"冲突，故先交付**可判定的策略与门禁**，接线待开关归属裁定
 * （方案附录 D.6）。
 */

import { TOOL_EFFECTS, resolveToolEffect } from '../toolEffects';
import type { ToolEffect } from '../toolEffects';

/** 边界模式：`strict` 缺快照即拒；`relaxed` 先补建再执行（建失败仍拒） */
export type CheckpointBoundaryMode = 'strict' | 'relaxed';

/** 判定结果（三态；无第四种"悄悄放行"） */
export type CheckpointBoundaryDecision = 'allow' | 'create-then-allow' | 'deny';

export interface CheckpointBoundaryInput {
  /** 工具 wire 名（`resolveToolEffect` 同口径） */
  toolName: string;
  /** 同会话是否已存在 checkpoint（调用方查询 `ResumeCoordinator.getLatestCheckpoint()`） */
  hasCheckpoint: boolean;
  mode: CheckpointBoundaryMode;
}

export interface CheckpointBoundaryResult {
  decision: CheckpointBoundaryDecision;
  /** 拒绝原因（`decision === 'deny'` 时必非空） */
  reason?: string;
}

/**
 * 该工具是否落在 checkpoint 边界内（**未声明 ⇒ 需要**，fail-closed）。
 *
 * 判据：`sideEffect !== 'none'` ∧ `!idempotent`。只读（`none`）与幂等操作**不触发**
 * —— 后者重复执行等价，补快照只会制造噪声。
 */
export function isCheckpointBoundaryTool(toolName: string): boolean {
  const effect = resolveToolEffect(toolName);
  if (!effect) return true;
  return effect.sideEffect !== 'none' && !effect.idempotent;
}

/** 派生边界清单（**不手写**；用于门禁断言与可观测报表） */
export function deriveCheckpointBoundaryTools(
  effects: Readonly<Record<string, ToolEffect>> = TOOL_EFFECTS
): string[] {
  return Object.entries(effects)
    .filter(([, e]) => e.sideEffect !== 'none' && !e.idempotent)
    .map(([name]) => name)
    .sort();
}

/** 纯决策（见规格 §3.1 两档策略） */
export function decideCheckpointBoundary(
  input: CheckpointBoundaryInput
): CheckpointBoundaryResult {
  if (!isCheckpointBoundaryTool(input.toolName)) return { decision: 'allow' };
  if (input.hasCheckpoint) return { decision: 'allow' };
  if (input.mode === 'strict') {
    return {
      decision: 'deny',
      reason: `不可逆操作 ${input.toolName} 之前缺少 checkpoint（strict 边界）`,
    };
  }
  return { decision: 'create-then-allow' };
}
