/**
 * PDCA 计划源（P2-2，2026-11-06）
 *
 * 真机缺陷（`session_mw458fpp3ea32a050e`）：`PdcaLauncher.launch()` 用 `userMessage || description`
 * 作为分解源 ⇒ 用户末条只是「按计划直接执行 / 全部执行 P0-P6」这类**短指令**时，助手已产出的
 * 完整计划（`description`）被**整段丢弃**。结果：PDCA 计划 description = 三句用户原话，
 * 第 1 步「定位并读取现有执行计划」无路径可找，5 秒即 `step_blocked`，后续 3 步级联阻断。
 *
 * 口径（纯函数，便于单测）：
 * - 用户消息**较长**（>120 字，本身即任务描述）⇒ 原样使用，零行为变更；
 * - 用户消息是**短指令**且助手有正文 ⇒ 用户原话 + 助手计划正文（截断至 8000 字）；
 * - 任一为空 ⇒ 用另一个；都为空 ⇒ 空串。
 */

/** 视为"任务描述本身"的用户消息最小长度（低于此值判断为指令/延续语） */
const SHORT_DIRECTIVE_MAX = 120;
/** 助手计划正文注入上限（防超长把分解上下文吃满） */
const MAX_PLAN_CHARS = 8000;

export function buildPdcaPlanSource(
  userMessage: string | undefined,
  assistantContent: string | undefined
): string {
  const user = (userMessage ?? '').trim();
  const assistant = (assistantContent ?? '').trim();
  if (!assistant) return user;
  const plan =
    assistant.length > MAX_PLAN_CHARS
      ? `${assistant.slice(0, MAX_PLAN_CHARS)}\n…（计划正文过长，已截断）`
      : assistant;
  if (!user) return plan;
  if (user.length > SHORT_DIRECTIVE_MAX) return user;
  return `${user}\n\n【此前已产出并确认的执行计划（请据此分解步骤，不要重新向用户索要计划）】\n${plan}`;
}

/**
 * 自动建项目的「目标摘要」（P2-1，2026-11-06）。
 *
 * 真机缺陷：用户末条是「按计划直接执行 / 全部执行 P0-P6」，直接截 30 字当项目名
 * ⇒ 项目名 = 三句短指令拼接，既不可读也无法被后续"跨会话去重"命中。
 * 口径：用户消息本身够长（≥20 字）⇒ 按其截断；短指令 ⇒ 取助手计划的首个 Markdown 标题。
 */
export function buildProjectGoalSummary(
  userMessage: string | undefined,
  assistantContent: string | undefined,
  maxChars = 30
): string {
  const user = (userMessage ?? '').replace(/\s+/g, ' ').trim();
  if (user.length >= 20) return user.slice(0, maxChars);
  const heading = /^#{1,3}\s+(.+)$/m.exec(assistantContent ?? '')?.[1]?.trim();
  if (heading) return heading.replace(/\s+/g, ' ').slice(0, maxChars);
  return user.slice(0, maxChars);
}
