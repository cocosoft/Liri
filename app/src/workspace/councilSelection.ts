// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Council 按议题选人（D4 二期 · ③-B，2026-11-14）
 *
 * 背景（`graph-engineering-p0.md` 已登记）：`assignAgentsByGraph` 在生产中**零调用**，
 * 因为不存在"给一个需求 → 按条件挑角色"的点位；Council 此前只会"加载全部启用角色"。
 *
 * 本模块补上该点位：按**议题**（topic）与 agent 的 `expertise` 做**确定性**匹配。
 *
 * 口径（fail-open，避免"没人可开会"）：
 * - topic 为空 ⇒ 原样返回（与改动前一致）；
 * - 有专家命中 ⇒ 「命中专家 + 通才（expertise 为空的 agent）」；
 * - 无专家命中 ⇒ **返回全部**（不静默收窄，Council 仍能开）。
 *
 * 纯函数、无 IO；不做置信度打分（历史成功率事实源尚未按 agent 维度建立，见 spec §5）。
 */

/** 可被议题选择的最小面（`CouncilAgentRole` / `AgentDefinition` 均满足） */
export interface TopicSelectableAgent {
  agentId: string;
  expertise: string[];
}

/** 归一化议题（小写；非字符串/空 ⇒ 空串） */
function normalizeTopic(topic: string | undefined): string {
  return typeof topic === 'string' ? topic.trim().toLowerCase() : '';
}

/** 单个领域的命中判定（领域词长度 <2 ⇒ 视为噪声，不参与匹配） */
function matchesExpertise(topic: string, term: string): boolean {
  const normalized = term.trim().toLowerCase();
  return normalized.length >= 2 && topic.includes(normalized);
}

/**
 * 按议题选择参会 agent（确定性；保持入参顺序）。
 */
export function selectAgentsForTopic<T extends TopicSelectableAgent>(
  agents: readonly T[],
  topic?: string
): T[] {
  const normalized = normalizeTopic(topic);
  if (normalized.length === 0 || agents.length === 0) return [...agents];

  const experts: T[] = [];
  const generalists: T[] = [];
  for (const agent of agents) {
    const terms = (agent.expertise ?? []).filter(
      (term) => typeof term === 'string' && term.trim().length > 0
    );
    if (terms.length === 0) {
      generalists.push(agent);
      continue;
    }
    if (terms.some((term) => matchesExpertise(normalized, term))) {
      experts.push(agent);
    }
  }

  // 无专家命中 ⇒ fail-open（保持改动前"全员参会"的行为）
  if (experts.length === 0) return [...agents];
  return [...experts, ...generalists];
}
