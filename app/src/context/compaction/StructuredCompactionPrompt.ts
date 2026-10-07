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

/** P2-15: 从 LLM 输出解析结构化压缩摘要 */
export function parseCompactionSummary(raw: string): {
  task_overview: string;
  current_state: string;
  important_discoveries: string;
  next_steps: string;
  context_to_preserve: string;
} | null {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(raw);
    if (parsed.task_overview) return parsed;
  } catch {
    // Try to extract JSON from markdown code block
    const match = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(raw);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

/** P2-15: 从解析的结构化摘要渲染为注入文本 */
export function renderCompactionSummary(
  summary: ReturnType<typeof parseCompactionSummary> extends infer T ? T : never
): string {
  if (!summary) return '';
  return COMPACTION_TEMPLATE.replace(
    '{task_overview}',
    (summary as Record<string, string>).task_overview ?? ''
  )
    .replace(
      '{current_state}',
      (summary as Record<string, string>).current_state ?? ''
    )
    .replace(
      '{important_discoveries}',
      (summary as Record<string, string>).important_discoveries ?? ''
    )
    .replace(
      '{next_steps}',
      (summary as Record<string, string>).next_steps ?? ''
    )
    .replace(
      '{context_to_preserve}',
      (summary as Record<string, string>).context_to_preserve ?? ''
    );
}
