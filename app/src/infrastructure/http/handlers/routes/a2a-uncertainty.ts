/**
 * a2a-uncertainty.ts — D5「不确定性」**产出方**（2026-11-18）
 *
 * Spec：`.trae/specs/a2a-acp-uncertainty-field.md` §7（本期只补「产出方」这一缺口）。
 * 设计一页纸：`dev_docs/20261118/D5-不确定性产出方-接线设计-20261118.md`。
 *
 * 链路：`委派新建会话` → `taskId → sessionId` 登记 → 验证器写入「每会话最新结果」
 * → 任务完成时 provider 读取 → `score = 1 - confidence`、`method='verifier'`。
 *
 * 三条硬约束：
 * 1. **默认关**：`A2A_UNCERTAINTY_VERIFIER=true` 才安装 provider；否则维持 `null`（永不写 `liri.*`）；
 * 2. **不造假**（CS04）：无验证器记录 / `confidence` 非有限或越界 ⇒ 返回 `null`，**不发字段**；
 * 3. **只转述**：不重算置信度、不推断 verdict；`rationale` 只写结构化结论（不含反馈原文）。
 *
 * 已知边界（如实）：进程内存储 ⇒ 重启后为空（该任务不发，**不补发**）；仅同步完成路径注入
 * （超阈值异步收尾不注入，与 `a2a-routes.ts` 现状一致）。
 */

import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
// 读「每会话最新验证结果」的 infra 只读投影：本文件在 service 层，**不能**直接依赖
// `packages/query`（app 层）—— `lint:arch` R00-001 会判 `infrastructure → query` 反向依赖。
import {
  getLatestVerifierResult,
  type LatestVerifierResult,
} from '@openliri/infra/system/state/verifierLatestResults';
import type { LiriUncertainty } from '@modules/types/uncertainty';

import type { A2AUncertaintyProvider } from './a2a-routes';

const logger = getLogger('http:a2a:uncertainty');

/** 开关名（默认关；开 ⇒ 安装验证器产出方） */
export const A2A_UNCERTAINTY_VERIFIER_ENV = 'A2A_UNCERTAINTY_VERIFIER';

/** 是否启用「验证器产出方」（默认关 ⇒ 零行为变更） */
export function isA2AUncertaintyVerifierEnabled(): boolean {
  return (
    configManager.env(A2A_UNCERTAINTY_VERIFIER_ENV)?.trim().toLowerCase() ===
    'true'
  );
}

/** `taskId → sessionId` 索引上限（LRU；避免长跑内存增长） */
const MAX_TASK_SESSIONS = 200;

const taskToSession = new Map<string, string>();

/** 委派时登记（`taskId` 由 `runDelegation` 创建任务后给出） */
export function registerA2ATaskSession(
  taskId: string,
  sessionId: string
): void {
  taskToSession.delete(taskId);
  taskToSession.set(taskId, sessionId);
  if (taskToSession.size > MAX_TASK_SESSIONS) {
    const oldest = taskToSession.keys().next().value;
    if (oldest !== undefined) taskToSession.delete(oldest);
  }
}

/** 查询任务对应的会话（未登记 ⇒ `null`） */
export function resolveA2ASessionForTask(taskId: string): string | null {
  return taskToSession.get(taskId) ?? null;
}

/** 重置（测试用；生产不调用） */
export function resetA2ATaskSessions(): void {
  taskToSession.clear();
}

/**
 * 纯映射：验证器最新结果 → `liri.uncertainty` 信号。
 *
 * - 无结果 ⇒ `null`（不发）；
 * - `confidence` 非有限或越界 ⇒ `null` + 告警（**不夹取、不猜测**）；
 * - 否则 `score = 1 - confidence`（本项目统一「不确定性」语义），四舍五入 2 位。
 */
export function toUncertaintySignal(
  latest: LatestVerifierResult | null
): { uncertainty: LiriUncertainty } | null {
  if (!latest) return null;

  const { confidence } = latest;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    logger.warning('a2a.uncertainty.no_confidence', {
      verdict: latest.verdict,
      turn: latest.turn,
    });
    return null;
  }
  if (confidence < 0 || confidence > 1) {
    logger.warning('a2a.uncertainty.confidence_out_of_range', {
      verdict: latest.verdict,
      turn: latest.turn,
      confidence,
    });
    return null;
  }

  const score = Math.round((1 - confidence) * 100) / 100;
  const passRate =
    typeof latest.checkPassRate === 'number' &&
    Number.isFinite(latest.checkPassRate)
      ? `; checkPassRate=${Math.round(latest.checkPassRate * 100) / 100}`
      : '';

  return {
    uncertainty: {
      score,
      method: 'verifier',
      rationale: `verdict=${latest.verdict}${passRate}`,
    },
  };
}

/**
 * 构建 A2A 不确定性产出方（由 `installA2ADelegator` 按开关安装）。
 *
 * 返回 `null` 表示「本次无真实信号」⇒ `enrichWithUncertainty` 不写任何 `liri.*` 键。
 */
export function createVerifierUncertaintyProvider(): A2AUncertaintyProvider {
  return (taskId: string) => {
    const sessionId = resolveA2ASessionForTask(taskId);
    if (!sessionId) return null;
    return toUncertaintySignal(getLatestVerifierResult(sessionId));
  };
}
