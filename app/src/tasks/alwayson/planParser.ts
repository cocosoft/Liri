/**
 * AlwaysOn 计划解析（U-02，2026-10-20 最小可用自主执行 v1）。
 *
 * 模型只被要求输出**一段 JSON**；本模块负责把它变成 `DiscoveryPlan`，并**fail-closed**：
 * - 提取失败 / 字段缺失 / 动作类型不在白名单 / `riskLevel==='high'` ⇒ `null`（本次不执行）；
 * - 不做"猜字段""补默认计划"（CS04：不造假）。
 */

import type { DiscoveryPlan } from './types';

/** v1 允许的动作类型（执行阶段由模型自行选择工具，这里只做计划分类） */
export const ALWAYSON_ACTION_TYPES = ['inspect', 'test', 'fix'] as const;

/** 风险等级（`high` 直接放弃） */
export const ALWAYSON_RISK_LEVELS = ['low', 'medium', 'high'] as const;

type RiskLevel = (typeof ALWAYSON_RISK_LEVELS)[number];
type ActionType = (typeof ALWAYSON_ACTION_TYPES)[number];

/**
 * 从模型输出里提取第一个 JSON 对象（容忍 ```json 围栏与前后自然语言）。
 *
 * @returns 解析结果；无法解析 ⇒ `null`
 */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析 AlwaysOn discovery 输出。
 *
 * @param text 模型输出原文
 * @param planId 计划 id（调用方生成，写入 `DiscoveryPlan.id`）
 * @returns 合法且非高风险的计划；否则 `null`
 */
export function parseAlwaysOnPlan(
  text: string,
  planId: string
): DiscoveryPlan | null {
  const raw = extractJsonObject(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return null;

  const obj = raw as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!summary) return null;

  const riskLevel = obj.riskLevel;
  if (
    typeof riskLevel !== 'string' ||
    !(ALWAYSON_RISK_LEVELS as readonly string[]).includes(riskLevel)
  ) {
    return null;
  }
  // 高风险计划一律不执行（fail-closed）
  if (riskLevel === 'high') return null;

  const rawActions = obj.actions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) return null;

  const actions: DiscoveryPlan['actions'] = [];
  for (const item of rawActions) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const action = item as Record<string, unknown>;
    const type = action.type;
    const description =
      typeof action.description === 'string' ? action.description.trim() : '';
    if (typeof type !== 'string' || !description) return null;
    if (!(ALWAYSON_ACTION_TYPES as readonly string[]).includes(type)) {
      return null;
    }
    actions.push({
      type: type as ActionType,
      description,
      params: {},
    });
  }

  return {
    id: planId,
    summary,
    actions,
    riskLevel: riskLevel as Exclude<RiskLevel, 'high'>,
  };
}
