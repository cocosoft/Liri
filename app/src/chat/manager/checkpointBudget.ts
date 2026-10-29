// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * checkpointBudget — 「检查点边界」与「预算挂起/放行装配」的编排外移
 * （issue #8 · Cut A，2026-10-29）
 *
 * 迁出来源：`ChatManager.ts` 的两个 `_ensure*` 方法的**方法体**（判定/装配逻辑本身），
 * 依赖一律**显式参数注入**（沿用 `app/src/chat/manager/` 既有做法，**不建全局单例**）。
 *
 * 行为不变红线（issue #8）：不新增配置项、不改默认值、不改事件名。
 * 调用点、调用顺序、日志文案与返回语义**逐字保持**迁移前状态。
 */

import { feature as coreFeature } from '@openliri/kernel';
import { getLogger } from '@modules/monitoring';
import {
  decideCheckpointBoundary,
  isCheckpointBoundaryTool,
} from '@modules/tools';
import { getDailyBudget } from '../../query/DailyBudgetManager';
import { getBudgetSuspendCoordinator } from '../../query/budgetSuspend';

const logger = getLogger('chat:checkpointBudget');

/** 检查点协调器的最小取用面（ChatManager 侧为 `resumeCoordinator`） */
export interface CheckpointCoordinatorLike {
  getLatestCheckpoint(sessionId: string): Promise<unknown | null>;
  createCheckpoint(
    sessionId: string,
    label?: string,
    metadata?: Record<string, unknown>
  ): Promise<string>;
}

export interface EnsureCheckpointBoundaryInput {
  toolName: string;
  /** 当前会话 id（调用时读取，避免快照过期；ChatManager 侧为 `string | null`） */
  currentSessionId: string | null | undefined;
  resumeCoordinator: CheckpointCoordinatorLike;
}

/**
 * 不可逆工具执行前的 checkpoint 边界判定（迁移自 `ChatManager._ensureCheckpointBoundary`）。
 *
 * @returns `null` = 放行（含"未启用 / 只读工具 / 无会话 / 已有快照 / 补建成功"）；
 *          否则为**拒绝原因**（不可逆操作前无法保证可回滚）。
 */
export async function ensureCheckpointBoundary(
  input: EnsureCheckpointBoundaryInput
): Promise<string | null> {
  // ⚠️ 动态导入（**不改启动面**）：AC-28 的 eager 棘轮只允许减少；本策略是"按工具调用
  // 才需要"的配置读取，进静态图会让 eager +1 文件。ESM 缓存 ⇒ 首次之后零成本。
  const { readCheckpointBoundaryConfig } =
    await import('@modules/config/settings/CheckpointBoundaryConfig');
  const config = readCheckpointBoundaryConfig();
  if (!config.enabled) return null;
  const sessionId = input.currentSessionId;
  // 无会话（纯 CLI / 单次调用）⇒ 无从判定"同会话是否有快照"⇒ 不阻断（与既有 checkpoint 语义一致）
  if (!sessionId) return null;
  if (!isCheckpointBoundaryTool(input.toolName)) return null;

  let hasCheckpoint = false;
  try {
    hasCheckpoint =
      !!(await input.resumeCoordinator.getLatestCheckpoint(sessionId));
  } catch (error) {
    // @ignore-catch — 查询失败按"无快照"处理（随后由 strict/relaxed 决定：拒绝或补建）
    logger.warn('Checkpoint 边界：查询最新快照失败 ⇒ 按无快照处理', {
      sessionId,
      toolName: input.toolName,
      error: String(error),
    });
    hasCheckpoint = false;
  }

  const decision = decideCheckpointBoundary({
    toolName: input.toolName,
    hasCheckpoint,
    mode: config.mode,
  });
  if (decision.decision === 'allow') return null;
  if (decision.decision === 'deny') {
    return (
      decision.reason ??
      `不可逆操作 ${input.toolName} 之前缺少 checkpoint（strict 边界）`
    );
  }

  // create-then-allow：先补建快照再执行；建失败 ⇒ 拒绝（fail-closed）
  try {
    await input.resumeCoordinator.createCheckpoint(
      sessionId,
      'auto:before-irreversible',
      { checkpointBoundaryTool: input.toolName }
    );
    return null;
  } catch (error) {
    logger.error(
      'Checkpoint 边界：补建快照失败 ⇒ 拒绝执行不可逆工具（fail-closed）',
      {
        sessionId,
        toolName: input.toolName,
        error: String(error),
      }
    );
    return `不可逆操作 ${input.toolName} 之前无法创建 checkpoint ⇒ 已拒绝执行（relaxed 边界 fail-closed）`;
  }
}

export interface BudgetSuspendWiringInput {
  /** 是否已装配（幂等守卫；由调用方持有状态） */
  alreadyWired: boolean;
  /** 装配成功后置位 */
  markWired: () => void;
  /** 记录 `onReliefApplied` 返回的解绑函数（供 cleanup 使用） */
  setUninstall: (fn: (() => void) | null) => void;
  /** 放行时的会话唤醒（会话级入口把唤醒收窄到本会话）；返回是否成功唤醒 */
  resumeSuspendedSession: (
    sessionId: string,
    chain: unknown
  ) => Promise<boolean>;
}

/**
 * 预算挂起/放行装配（迁移自 `ChatManager._ensureBudgetSuspendResumeInstalled`）。
 *
 * 幂等：`alreadyWired` 为真或特性开关关闭 ⇒ 直接返回（**零行为变更**）。
 */
export function installBudgetSuspendResume(
  input: BudgetSuspendWiringInput
): void {
  if (input.alreadyWired) return;
  if (!coreFeature('BUDGET_SUSPEND_RESUME')) return; // 关（=false）⇒ 不注册（零行为变更）
  input.markWired();

  const coordinator = getBudgetSuspendCoordinator();
  const uninstall = getDailyBudget().onReliefApplied((e) => {
    // `targetSessionId` 原样透传（可选）：会话级入口（挂起卡片「继续」）把唤醒收窄到本会话，
    // 缺省 ⇒ 旧口径（全局，时间序 + 上限）。
    void coordinator.onReliefApplied(e.kind, e.targetSessionId).catch((err) => {
      logger.warn('budgetSuspend:onReliefApplied failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  input.setUninstall(uninstall);

  coordinator.setResumeHandler((sessionId, chain) =>
    input.resumeSuspendedSession(sessionId, chain)
  );
}
