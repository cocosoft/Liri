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

export const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer for an AI agent. Your summary will replace the early conversation history, so it MUST preserve all information the agent needs to continue working without repeating past steps.

Summarize the conversation so far in the following structured format. Each field has a max length constraint — be concise but complete.`;

export const COMPACTION_USER_PROMPT = `Summarize the conversation so far. Output ONLY the following JSON structure with these exact 5 fields:

{
  "task_overview": "<max 300 chars — the user's original request, goals, and success criteria>",
  "current_state": "<max 300 chars — what has been completed, current progress, files created/modified>",
  "important_discoveries": "<max 300 chars — technical constraints, key decisions, errors encountered and how they were resolved>",
  "next_steps": "<max 200 chars — what to do next, blocked items, priorities>",
  "context_to_preserve": "<max 300 chars — user preferences, domain details, commitments made to the user>"
}

CRITICAL: Return valid JSON only. No markdown, no explanation, just the JSON object.`;

export const COMPACTION_TEMPLATE = `<system-info>
Here is a structured summary of your previous work in this conversation. Use this context to continue the task without repeating completed steps.

## Task Overview
{task_overview}

## Current State
{current_state}

## Important Discoveries
{important_discoveries}

## Next Steps
{next_steps}

## Context to Preserve
{context_to_preserve}
</system-info>`;

/** P2-15: 从 LLM 输出解析结构化压缩摘要 */
export function parseCompactionSummary(
  raw: string
): {
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
      } catch { /* continue */ }
    }
  }
  return null;
}

/** P2-15: 从解析的结构化摘要渲染为注入文本 */
export function renderCompactionSummary(
  summary: ReturnType<typeof parseCompactionSummary> extends infer T ? T : never
): string {
  if (!summary) return '';
  return COMPACTION_TEMPLATE
    .replace('{task_overview}', (summary as Record<string,string>).task_overview ?? '')
    .replace('{current_state}', (summary as Record<string,string>).current_state ?? '')
    .replace('{important_discoveries}', (summary as Record<string,string>).important_discoveries ?? '')
    .replace('{next_steps}', (summary as Record<string,string>).next_steps ?? '')
    .replace('{context_to_preserve}', (summary as Record<string,string>).context_to_preserve ?? '');
}
