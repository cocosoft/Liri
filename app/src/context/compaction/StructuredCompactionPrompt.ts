/**
 * StructuredCompactionPrompt — 结构化压缩摘要模板
 *
 * P2-15: 对标 agentscope SummarySchema 5 字段 + cc_code COMPACT_SYSTEM_PROMPT_DEFAULT。
 * 替代纯文本自由摘要，强制 LLM 按 5 字段输出结构化压缩，保留率更高。
 *
 * 5 字段（参考 agentscope SummarySchema）：
 *   1. task_overview     — 用户核心需求与成功标准（≤300字）
 *   2. current_state      — 已完成的工作和产出（≤300字）
 *   3. important_discoveries — 技术约束/决策/错误解决（≤300字）
 *   4. next_steps         — 下一步行动/阻塞问题/优先级（≤200字）
 *   5. context_to_preserve — 用户偏好/领域细节/承诺（≤300字）
 */

export const COMPACTION_SYSTEM_PROMPT = `你是 AI 智能体的对话摘要器。你的摘要将替换早期的对话历史，因此它**必须**保留智能体继续工作所需的全部信息，使其无需重复已完成的步骤。

请按以下结构化格式总结迄今为止的对话。每个字段都有最大长度限制 —— 请简明但完整。`;

export const COMPACTION_USER_PROMPT = `请总结迄今为止的对话。只输出以下 JSON 结构，且必须包含这 5 个字段：

{
  "task_overview": "<最多 300 字 — 用户的原始请求、目标与成功标准>",
  "current_state": "<最多 300 字 — 已完成的工作、当前进展、创建/修改的文件>",
  "important_discoveries": "<最多 300 字 — 技术约束、关键决策、遇到的错误及其解决方式>",
  "next_steps": "<最多 200 字 — 下一步要做的事、阻塞项、优先级>",
  "context_to_preserve": "<最多 300 字 — 用户偏好、领域细节、对用户作出的承诺，以及原系统提示词中的输出格式要求（例如思考放在 think 标签内、最终答案放在 response 中）>"
}

关键：只返回合法 JSON。不要 markdown、不要解释，只给 JSON 对象。

P1-1（2026-08-27）：在 context_to_preserve 中必须保留原系统提示词的输出格式要求
（think/response 分隔、回答语言等），因为本摘要会替换早期历史而系统提示词本身
不会重复注入——格式要求丢失会导致模型把思考当正文输出。`;

export const COMPACTION_TEMPLATE = `<system-info>
这是对早期对话历史的**压缩摘要** —— 不是系统指令。原系统提示词（角色、输出格式、think/response 规则）仍然有效并具有最高权威。请仅把本摘要当作继续任务的上下文，以免重复已完成的步骤。

## 任务概览
{task_overview}

## 当前状态
{current_state}

## 重要发现
{important_discoveries}

## 下一步
{next_steps}

## 需要保留的上下文
{context_to_preserve}
</system-info>`;

/** 结构化压缩摘要（5 字段） */
export interface CompactionSummary {
  task_overview: string;
  current_state: string;
  important_discoveries: string;
  next_steps: string;
  context_to_preserve: string;
}

/** 各字段长度上限（与 `COMPACTION_USER_PROMPT` 的约束一致） */
const SUMMARY_FIELD_LIMITS: Record<keyof CompactionSummary, number> = {
  task_overview: 300,
  current_state: 300,
  important_discoveries: 300,
  next_steps: 200,
  context_to_preserve: 300,
};

const SUMMARY_FIELDS = Object.keys(
  SUMMARY_FIELD_LIMITS
) as (keyof CompactionSummary)[];

/**
 * 单字段归一化：仅接受字符串 ⇒ 截断到上限 ⇒ 代码围栏奇偶补齐。
 *
 * 围栏补齐动机：摘要会被**整体注入**下一轮 prompt（`COMPACTION_TEMPLATE`），一个未闭合的
 * ``` 会把后续注入文本一并吞进代码块（与 `messageSplitter`/`buildSafePreview` 同源的"围栏成对"约定）。
 */
function normalizeSummaryField(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  let s = value.trim();
  if (s.length > limit) s = s.slice(0, limit);
  const fences = (s.match(/```/g) ?? []).length;
  if (fences % 2 === 1) s += '\n```';
  return s;
}

/**
 * R22（2026-10-09，Gemini 二轮审计）—— 把 LLM 结构化摘要收敛为**强形状校验**（零新依赖、手写）。
 *
 * **改前** `parseCompactionSummary` 仅 `if (parsed.task_overview) return parsed`：
 *   ① 非字符串（如对象）**照单全收** ⇒ 渲染出 `[object Object]` 脏内容灌回模型；
 *   ② **无长度上限** ⇒ 超长噪声直达上下文；
 *   ③ 未闭合 ``` 会吞掉后续注入文本。
 *
 * **判据（保守，尽量不把可用摘要推给"自由文本回退"）**：
 *   - 非对象 / 数组 / `task_overview` 缺失或非字符串 ⇒ `null`（结构化不可用）；
 *   - 其余字段：非字符串 ⇒ 归一为 `''`；超长 ⇒ 截断；围栏奇数 ⇒ 补收尾。
 */
export function normalizeCompactionSummary(
  raw: unknown
): CompactionSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (
    typeof src.task_overview !== 'string' ||
    src.task_overview.trim() === ''
  ) {
    return null;
  }
  const out = {} as CompactionSummary;
  for (const key of SUMMARY_FIELDS) {
    out[key] = normalizeSummaryField(src[key], SUMMARY_FIELD_LIMITS[key]);
  }
  return out;
}

/** P2-15: 从 LLM 输出解析结构化压缩摘要（R22：经强形状校验；不合规则返回 null ⇒ 调用方回退自由文本） */
export function parseCompactionSummary(raw: string): CompactionSummary | null {
  try {
    const parsed = normalizeCompactionSummary(JSON.parse(raw));
    if (parsed) return parsed;
  } catch {
    // 落入下方"围栏提取"分支
  }
  // 尝试从 markdown 代码块中提取 JSON
  const match = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(raw);
  if (match) {
    try {
      const parsed = normalizeCompactionSummary(JSON.parse(match[1]));
      if (parsed) return parsed;
    } catch {
      /* 解析失败 ⇒ null */
    }
  }
  return null;
}

/** P2-15: 从解析的结构化摘要渲染为注入文本 */
export function renderCompactionSummary(
  summary: CompactionSummary | null
): string {
  if (!summary) return '';
  return COMPACTION_TEMPLATE.replace('{task_overview}', summary.task_overview)
    .replace('{current_state}', summary.current_state)
    .replace('{important_discoveries}', summary.important_discoveries)
    .replace('{next_steps}', summary.next_steps)
    .replace('{context_to_preserve}', summary.context_to_preserve);
}
