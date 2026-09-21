// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * yield 轮次登记（阶段 A / N-28 修复）
 *
 * 抽取自 `ReActToolLoop.act()` 的内联逻辑，供**两条工具执行链路共用**：
 * - stream 路径：`chat/ReActToolLoop.ts`
 * - batch  路径：`query/TAORLoop.ts`（非流式 `/v1/chat/completions` 走此路径）
 *
 * 背景（台账 N-28）：此前只在 stream 路径登记，实测模型在 batch 路径真实调用
 * `sessions_yield` 后既不登记等待、骨架也不短路（`actResult.yielded` 恒 undefined）。
 *
 * 说明：turn 编号此刻尚不可知（只有收尾点写 `turn/end` 时可知）⇒ 记 0，
 * 由收尾点用 `YieldRegistry.updateTurn` 回填。
 */

import { getYieldRegistry, type YieldWaitingEntry } from './YieldRegistry';
import { YIELD_TOOL_NAME } from './constants';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:yield:registration');

/** 参与判定所需的最小工具结果形态（`ToolResultEntry` 的结构化子集，避免跨层依赖） */
export interface YieldCandidateResult {
  name: string;
  status: string;
  toolCallId: string;
}

/**
 * 活跃子代理 run 探针（B1/O1-3）。
 *
 * 返回"该会话是否仍有在途子代理 run"，由装配处（`ChatManager`）注入 ——
 * 本模块**不直接 import 子代理实现**，避免 `session/yield → tools` 的反向依赖与循环导入。
 */
export type ActiveSubagentRunProbe = (sessionId: string) => boolean;

let activeRunProbe: ActiveSubagentRunProbe | null = null;

/** 装配活跃 run 探针（传 `null` 卸载） */
export function setActiveSubagentRunProbe(
  probe: ActiveSubagentRunProbe | null
): void {
  activeRunProbe = probe;
}

/** 探针是否已装配（供测试与观测） */
export function hasActiveSubagentRunProbe(): boolean {
  return activeRunProbe !== null;
}

/**
 * 从一轮工具结果中检出**成功的 yield** 并登记等待。
 *
 * B1/O1-3（A10 修断链）：结算通知只由子代理侧发出（并行批次 / 后台任务结算），
 * 若此刻该会话**没有任何在途子代理 run**，通知永不触发 ⇒ 登记即为永久等待。
 * 故无 run 时**拒绝登记**（等价于"不发生 yield"，本轮正常继续而不是挂起）。
 *
 * @returns 登记条目；本轮未成功 yield、或无可等待的在途子代理时返回 `null`
 */
export function registerYieldFromResults(
  results: ReadonlyArray<YieldCandidateResult>,
  sessionId: string
): YieldWaitingEntry | null {
  const hit = results.find(
    (r) => r.name === YIELD_TOOL_NAME && r.status === 'success'
  );
  if (!hit) return null;

  // 探针未装配（非 ChatManager 装配链路，如单测）时不阻断登记，保持既有行为
  if (activeRunProbe && !activeRunProbe(sessionId)) {
    logger.warn('sessions_yield 被忽略：该会话无在途子代理 run', {
      sessionId,
      toolCallId: hit.toolCallId,
    });
    return null;
  }

  return getYieldRegistry().register({
    sessionId,
    turn: 0, // 收尾点回填
    toolCallId: hit.toolCallId,
  });
}
