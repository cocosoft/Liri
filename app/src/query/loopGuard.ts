// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * loopGuard — ReActLoop 无进展熔断判定（D 项，2026-08-30）
 *
 * 抽取为纯函数模块：ReActLoop 骨架与测试均引用此处，避免测试直接加载
 * ReActLoop 类触发 TAORLoop↔ReActLoop 深层循环依赖 TDZ（项目已知问题）。
 * 2026-08-30 补修：内联结构化类型（不再 import ReActLoop）——否则
 * `ReActLoop → loopGuard → ReActLoop` 构成静态循环（madge 检出 #8）。
 */

/**
 * 轮签名计算的输入结构（ActResult 的子集，结构兼容即可）
 */
export interface RoundSignatureSource {
  results: Array<{ name: string; status: string; toolCallId?: string }>;
  /** 本轮工具调用的参数（按 id 对应 results），用于参数级无进展检测 */
  toolInputs?: Array<{ id: string; input: Record<string, unknown> }>;
}

/** 参数归一化：键排序 + 字符串化（截断避免超长签名；失败返回空串不参与签名） */
function normalizeArgs(args: Record<string, unknown>): string {
  try {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(args).sort()) {
      const v = args[k];
      sorted[k] =
        v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    const json = JSON.stringify(sorted);
    return json.length > 200 ? json.slice(0, 200) : json;
  } catch {
    return '';
  }
}

/**
 * 构建轮签名：工具名+状态+归一化参数排序拼接。
 * 用于检测"不同工具组合反复尝试但无实质进展"的循环
 *（与 checkCircuitBreaker 的 all-error 熔断互补）。
 *
 * 2026-08-31 增强：签名纳入工具参数归一化——实测死循环中模型反复
 * `tool_search select:skills_list`（工具名+状态相同但组合略有变化时
 * 旧签名抓不到），参数级签名可覆盖"相同工具+相同参数反复调用"。
 */
export function buildRoundSignature(actResult: RoundSignatureSource): string {
  const argsByCallId = new Map(
    (actResult.toolInputs ?? []).map((t) => [t.id, t.input])
  );
  return [...actResult.results]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((r) => {
      const args = argsByCallId.get(r.toolCallId ?? '');
      const argsSig = args ? normalizeArgs(args) : '';
      return `${r.name}:${r.status}${argsSig ? `:${argsSig}` : ''}`;
    })
    .join('|');
}

/**
 * 判断是否构成无进展循环：窗口内同一签名出现 ≥threshold 次。
 *
 * 2026-09-01 P1 窗口化改造：原实现要求"尾部连续 threshold 轮签名相同"，
 * 模型可通过轮换工具/参数（如 skill_view(zhihu) → web_search → web_fetch
 * 组合变化）绕过检测——实测 26 轮无实质进展后才触发。窗口化后，
 * 只要窗口内同一签名累计出现 threshold 次即判定，更早拦截重复探索。
 *
 * @param recentSignatures 已记录的最近若干轮签名（调用方维护有界窗口）
 * @param threshold 熔断阈值（窗口内同签名出现次数）
 * @returns 窗口内是否存在出现 ≥threshold 次的相同签名
 */
export function isRepeatedLoop(
  recentSignatures: string[],
  threshold: number
): boolean {
  if (threshold <= 0 || recentSignatures.length < threshold) return false;
  const counts = new Map<string, number>();
  for (const s of recentSignatures) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.values()].some((c) => c >= threshold);
}
