// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 成功轨迹来源 —— 已完成的 PDCA 计划（D10，2026-11-14）
 *
 * 轨迹事实源 = `TaskOrchestrator` 的**计划文件**（`~/.pyapp/data/plans/plan_<id>.json`，
 * 与 `TaskOrchestrator.savePlan` 同一目录、同一格式）—— **不新建轨迹存储**（CS01/R02）。
 *
 * 成功判定（**只用轨迹事实，不看用户可见文案**）：
 * - 计划至少 1 步；
 * - 每步 `status === 'completed'`（复用 `TaskOrchestrator` 导出的状态常量，避免状态字面量扩散）；
 * - 每步有非空 `description`（否则蒸馏出来的步骤是空壳）。
 *
 * 读取失败口径（CS03）：单个文件不可解析 ⇒ 跳过并留痕，不阻断整批；目录不存在 ⇒ 空列表。
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getLogger } from '@openliri/infra/monitoring';
import { resolveDataSubDir } from '@openliri/infra/environment';
import { STEP_STATUS_COMPLETED } from '../TaskOrchestrator';
import type { SopTrajectory, SopTrajectoryStep } from './sopDistill';

const logger = getLogger('tasks:evolution:sop');

/**
 * 单次蒸馏默认取多少条成功轨迹（**设计常量**，非业务阈值：一次产出过多草案会淹没人工确认；
 * 需要更多时用 `/sop distill <n>` 显式指定，不配置化 —— CS03 无实测需求不加可配置面）。
 */
export const SOP_MAX_TRAJECTORIES = 5;

/** 计划文件的**最小形状**（只读字段；多余字段忽略） */
interface StoredPlanLike {
  id?: unknown;
  description?: unknown;
  completedAt?: unknown;
  steps?: unknown;
}

interface StoredStepLike {
  description?: unknown;
  status?: unknown;
  retryCount?: unknown;
  artifacts?: unknown;
  acceptanceCriteria?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 投影一步（形状不合法 ⇒ `null`） */
function toStep(raw: unknown): SopTrajectoryStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const step = raw as StoredStepLike;
  if (step.status !== STEP_STATUS_COMPLETED) return null;
  const description = asString(step.description).trim();
  if (!description) return null;
  const retryCount =
    typeof step.retryCount === 'number' && step.retryCount > 0
      ? step.retryCount
      : 0;
  const artifacts = Array.isArray(step.artifacts)
    ? step.artifacts.filter((a): a is string => typeof a === 'string' && !!a)
    : undefined;
  const acceptanceCriteria = asString(step.acceptanceCriteria).trim();
  return {
    description,
    retryCount,
    ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
  };
}

/**
 * 计划 → 成功轨迹（纯函数）。
 * @returns 非成功轨迹（有未完成/失败步骤、步数为空、缺 id）⇒ `null`
 */
export function toSopTrajectory(plan: StoredPlanLike): SopTrajectory | null {
  const planId = asString(plan.id).trim();
  if (!planId || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return null;
  }
  const steps: SopTrajectoryStep[] = [];
  for (const raw of plan.steps) {
    const step = toStep(raw);
    // 任意一步不是「已完成」⇒ 整条轨迹不算成功（不做部分蒸馏）
    if (!step) return null;
    steps.push(step);
  }
  const completedAt = asString(plan.completedAt).trim();
  return {
    planId,
    goalText: asString(plan.description),
    ...(completedAt ? { completedAt } : {}),
    steps,
  };
}

/**
 * 读取已完成计划文件，按 `completedAt` 倒序（缺则排后），最多 `limit` 条。
 *
 * @param opts.dir 计划目录（测试注入；缺省与 `TaskOrchestrator` 同目录）
 * @param opts.limit 单次上限（缺省 {@link SOP_MAX_TRAJECTORIES}）
 */
export function readCompletedPlanTrajectories(opts?: {
  dir?: string;
  limit?: number;
}): SopTrajectory[] {
  const dir = opts?.dir ?? resolveDataSubDir('plans');
  const limit = opts?.limit ?? SOP_MAX_TRAJECTORIES;
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir).filter(
      (f) => f.startsWith('plan_') && f.endsWith('.json')
    );
  } catch (err) {
    logger.warn('读取计划目录失败，本次不蒸馏', { dir, error: String(err) });
    return [];
  }

  const trajectories: SopTrajectory[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const trajectory = toSopTrajectory(JSON.parse(raw) as StoredPlanLike);
      if (trajectory) trajectories.push(trajectory);
    } catch (err) {
      // @ignore-catch — 单文件损坏不影响整批（留痕后继续）
      logger.warn('计划文件解析失败，已跳过', { file, error: String(err) });
    }
  }

  trajectories.sort((a, b) => {
    const ta = a.completedAt ?? '';
    const tb = b.completedAt ?? '';
    if (ta !== tb) return tb.localeCompare(ta);
    return a.planId.localeCompare(b.planId);
  });
  return trajectories.slice(0, limit);
}
