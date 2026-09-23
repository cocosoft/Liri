// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * goalTemplates —— 长程任务的**续接/策略模板**单一来源（M-7，2026-09-22）
 *
 * 动机（对标 codex `templates/goals/{continuation,budget_limit,objective_updated}.md`）：
 * 我方的续接指令此前是**四处散落的硬编码常量**（`ReActToolLoop` 的
 * EMPTY/REASONING/PLANNING/TRUNCATED 四条），产品文案与调度逻辑混在一处，
 * 改文案要动热路径代码，且"为何停下/如何续接"的策略无处沉淀。
 *
 * 本模块把**文案**集中为一处模板源：
 * - `CONTINUATION_TEMPLATES`：既有四条续接指令，**内容逐字不变**（行为中性迁移，
 *   仅换存放位置；有无回归由 `tests/tasks/goal/goalTemplates.test.ts` 的逐字断言锁定）；
 * - `GOAL_TEMPLATES`：长程任务专用两条 —— `budget_limit`（预算触顶收尾）与
 *   `objective_updated`（目标变更后重新对齐），由 M-8 的预算收尾路径消费。
 *
 * 占位符：`{{key}}`；渲染时用 `params` 替换，**未提供的占位符保持字面量**
 *（不抛错、不静默清空 —— 便于在日志里看出"哪个参数漏传"）。
 */

/** 续接指令的变体（键与 `ReActToolLoop.onIncompleteTurn` 的 `kind` 一一对应） */
export type ContinuationVariant =
  | 'empty'
  | 'reasoning'
  | 'planning'
  | 'truncated'
  | 'resume_agent';

/**
 * 续接指令模板（**逐字迁移**自 `ReActToolLoop.ts:103-111`，不得在此擅自改文案）。
 *
 * 各条各自的语义边界：
 * - `empty`：整轮没有任何可见产出；
 * - `reasoning`：只产出了推理、没有可见答案；
 * - `planning`：只描述了计划、没有行动；
 * - `truncated`：输出被 `max_tokens` 截断（最常见的"任务中断"伪装）；
 * - `resume_agent`（B2-3 收尾迁移，2026-09-23）：**恢复被暂停的子代理**时拼进系统提示的
 *   续跑指示（原为 `AgentTool/ResumeAgent.reconstructSystemPrompt` 内的硬编码，Spec §5.3.1 #3）。
 */
export const CONTINUATION_TEMPLATES: Record<ContinuationVariant, string> = {
  empty:
    'The previous attempt did not produce a user-visible answer. Continue from the current state and produce the visible answer now. Do not restart from scratch.',
  reasoning:
    'The previous assistant turn recorded reasoning but did not produce a user-visible answer. Continue from that partial turn and produce the visible answer now. Do not restate the reasoning or restart from scratch.',
  planning:
    'The previous assistant turn only described the plan. Do not restate the plan. Act now: take the first concrete tool action you can. If a real blocker prevents action, reply with the exact blocker in one sentence.',
  truncated:
    'Your previous output was cut off by the output length limit before it finished. Do NOT restate anything you already wrote and do NOT re-enter reasoning. Continue directly from where the output stopped: if you were about to call tools, emit the tool calls now; otherwise finish your visible answer concisely.',
  resume_agent:
    'Continue from where you left off. You have access to the full conversation history above.',
};

/** 长程任务专用模板 */
export type GoalTemplateKind =
  | 'budget_limit'
  | 'objective_updated'
  | 'progress_stalled'
  | 'continue_goal'
  | 'tool_execution_errors';

/**
 * 目标级策略模板（codex 对位：`budget_limit.md` / `objective_updated.md`）。
 *
 * - `budget_limit`：**任务级**预算触顶后的收尾指令 —— 关键语义是"停止开展新工作、
 *   如实盘点上一步/剩余/下一步"，**不静默截断**（方案 M-8 要求）；
 * - `objective_updated`：目标变更后要求"按新目标重新对齐，但不重做已完成部分"；
 * - `progress_stalled`：**连续多批未达成**（停止条件成立）⇒ 停止推进并如实汇报阻塞，
 *   不静默把目标长期挂在 `blocked`（那会让它被反复选中续推而不收敛）；
 * - `continue_goal`：**idle 触发续接**（`continue_if_idle` 等价物）—— 目标仍未终结且
 *   会话已空闲 ⇒ 要求"从当前状态继续推进；若确有阻塞则一句话说明，不要另起新工作"；
 * - `tool_execution_errors`（B2-3 收尾迁移，2026-09-23）：**批量工具执行阶段抛异常**时
 *   注入的收尾指示（原为 `TAORLoop` 内的硬编码模板串，Spec §5.3.1 #2）。带 `{{count}}`
 *   占位（异常的工具调用条数），**不含** `[SYSTEM] ` 前缀 —— 该前缀是注入通道标记，
 *   由注入点拼装（与 `ReActToolLoop.onIncompleteTurn` 同口径，Spec §5.3.1 #4）。
 */
export const GOAL_TEMPLATES: Record<GoalTemplateKind, string> = {
  budget_limit:
    'This task has exhausted its token budget ({{tokensUsed}}/{{tokenBudget}}). Stop starting new work now. Reply with: (1) what was completed, (2) what remains, (3) the single next action to take. Do NOT continue executing.',
  objective_updated:
    'The goal objective has been updated to: "{{objective}}". Re-align with the new objective and continue from the current state. Do not restart work that is already completed.',
  progress_stalled:
    'This goal made no progress for {{streak}} consecutive batches (objective: "{{objective}}"). Stop attempting new work on it now. Reply with: (1) what was completed, (2) what specifically is blocking progress, (3) what the user must decide or provide. Do NOT start another batch.',
  continue_goal:
    'The unfinished goal is still open (objective: "{{objective}}"; no progress for {{streak}} consecutive batches). Continue working toward it from the current state: take the next concrete action now. Do NOT restart work that is already done. If a real blocker prevents progress, reply with the exact blocker in one sentence instead of starting new work.',
  tool_execution_errors:
    '上一轮 {{count}} 个工具调用在执行阶段发生异常，请告知用户遇到了什么问题，并根据当前已完成的部分给出总结或建议下一步操作。',
};

/** 可渲染的模板键（续接变体 ∪ 目标模板） */
export type RenderableTemplate = ContinuationVariant | GoalTemplateKind;

/** 取模板原文（不做占位替换；供需要原始文案的调用方/测试使用） */
export function getGoalTemplate(kind: RenderableTemplate): string {
  return kind in GOAL_TEMPLATES
    ? GOAL_TEMPLATES[kind as GoalTemplateKind]
    : CONTINUATION_TEMPLATES[kind as ContinuationVariant];
}

/**
 * 渲染模板：替换 `{{key}}` 占位符。
 *
 * - 未提供的占位符**保持字面量**（便于发现漏传，而非静默留空）；
 * - `undefined` / `null` 值同样按"未提供"处理。
 */
export function renderGoalTemplate(
  kind: RenderableTemplate,
  params: Record<string, string | number | undefined | null> = {}
): string {
  return getGoalTemplate(kind).replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) => {
      const value = params[key];
      return value === undefined || value === null ? match : String(value);
    }
  );
}
