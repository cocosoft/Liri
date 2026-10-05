// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * successCriteria — 验收标准的**结构化一等对象**（13-P0-2，2026-10-05）
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A2「闭环断裂：产出/验收/学习互不认识」。
 * 事实缺陷：`acceptanceCriteria` 一向是**自由文本**（`tasks/TaskOrchestrator.ts:71`），
 * 只进 Reviewer prompt，**未注入验证器** ⇒ 验证器的 `checks[]` 由 LLM 自由发明，
 * 「你写的验收标准 ≠ 实际判定用的标准」。
 *
 * 本模块提供：
 * - `parseSuccessCriteria`：把自由文本验收标准解析为**有序条目**（稳定 id）；
 * - `renderCriteriaSkeleton`：渲染为提示词骨架（要求 `checks[]` 逐条照抄、按序）；
 * - `alignChecksToCriteria`：把模型返回的 `checks[]` **对齐到骨架**（同名 → 包含 → 同序 → 缺失=
 *   未通过），从机制上禁止"漏项即放行"。
 *
 * ⚠️ 与复查建议的差异（如实）：建议"`check: 'llm'|'regex'|'tool'` 三态 + 禁止 LLM 发明"。
 * 本实现保留 `check` 字段（缺省 `'llm'`，供后续真值化），但**仅**在构造时由文本解析得出；
 * `regex`/`tool` 的执行器**未实现**（需各自执行器接入，本批不做）。
 */

/** 单条验收标准 */
export interface SuccessCriterion {
  /** 稳定 id（c1, c2, …；按解析顺序） */
  id: string;
  /** 判定描述 —— `checks[].item` 必须以此为准 */
  desc: string;
  /** 判定方式（本批仅 `'llm'` 可用；`regex`/`tool` 为后续扩展位） */
  check: 'llm' | 'regex' | 'tool';
}

/** 结构化验收标准 */
export interface SuccessCriteria {
  items: SuccessCriterion[];
}

/** 与 `query/VerifierAgent.ts` 的 `CheckItem` 同形（避免反向依赖，此处结构对齐） */
export interface CriteriaCheck {
  item: string;
  passed: boolean;
}

/**
 * 解析自由文本验收标准 → 结构化条目。
 *
 * 支持：换行 / 中文分号 / 英文分号 分隔；自动剥离 `-`、`*`、`1.`、`1)`、`（1）` 等列表标记。
 * 无有效条目 ⇒ 返回 `undefined`（调用方据此保持"无 criteria"路径，零行为变化）。
 */
export function parseSuccessCriteria(
  raw?: string
): SuccessCriteria | undefined {
  if (!raw || !raw.trim()) return undefined;
  const parts = raw
    .split(/[\n；;]+/)
    .map((s) =>
      s
        .trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/^[（(]?\d+[）).、]\s*/, '')
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  return {
    items: parts.map((desc, i) => ({
      id: `c${i + 1}`,
      desc,
      check: 'llm' as const,
    })),
  };
}

/** 渲染为验证提示词骨架（要求逐条照抄、按序给出 `checks[]`） */
export function renderCriteriaSkeleton(criteria: SuccessCriteria): string {
  return [
    '**验收标准（判定骨架）**：',
    '下方条目是本次验收的**唯一检查项集合**，你必须逐条（按原顺序、`item` 照抄描述）给出 `checks[]`，',
    '**禁止增删或改写检查项**；无法判定某条时按 `passed:false` 记。',
    ...criteria.items.map((it) => `${it.id}. ${it.desc}`),
  ].join('\n');
}

/**
 * 把模型返回的 `checks[]` **对齐到验收标准骨架**。
 *
 * 对齐顺序：① `item` 精确同名 → ② 包含匹配（双向）→ ③ 仍无 ⇒ `passed:false`（**未判定 = 不复行**）。
 *
 * ⚠️ **刻意不做"按序回退"**：把"位置相邻但语义无关"的返回项挂到验收项上，等于用**模型自造项**的
 * 结论冒充该验收项结论 —— 与"禁止自由发明检查项"的本意相反（2026-10-05 实测发现并移除）。
 *
 * - `criteria` 缺失/为空 ⇒ 原样返回（保持旧单指标路径，零行为变化）；
 * - 额外（骨架外）的返回项**丢弃** —— 机制上禁止"LLM 自由发明检查项"。
 */
export function alignChecksToCriteria(
  checks: CriteriaCheck[],
  criteria?: SuccessCriteria
): CriteriaCheck[] {
  if (!criteria || criteria.items.length === 0) return checks;
  const pool = [...checks];
  return criteria.items.map((crit) => {
    const desc = crit.desc.trim();
    // ① 精确同名
    let idx = pool.findIndex((c) => c.item.trim() === desc);
    // ② 包含匹配（双向）
    if (idx < 0) {
      idx = pool.findIndex((c) => {
        const it = c.item.trim();
        return it.includes(desc) || desc.includes(it);
      });
    }
    if (idx < 0) {
      // ③ 未匹配 ⇒ 未通过（漏项/无法对齐一律不放行；不误挂他项结论）
      return { item: crit.desc, passed: false };
    }
    const [hit] = pool.splice(idx, 1);
    return { item: crit.desc, passed: hit.passed };
  });
}
