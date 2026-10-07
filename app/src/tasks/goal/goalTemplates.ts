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
 * - `CONTINUATION_TEMPLATES`：续接指令模板（M-7 由散落常量**行为中性迁移**至此；
 *   有无回归由 `tests/tasks/goal/goalTemplatesAndBudget.test.ts` 的逐字断言锁定）——
 *   2026-10-07 P2-2 提示词中文化批次 B8 已将其译中文，断言同批同步；
 * - `GOAL_TEMPLATES`：长程任务专用模板 —— `budget_limit`（预算触顶收尾）与
 *   `objective_updated`（目标变更后重新对齐）等，由 M-8 的预算收尾路径等消费。
 *
 * 占位符：`{{key}}`；渲染时用 `params` 替换，**未提供的占位符保持字面量**
 *（不抛错、不静默清空 —— 便于在日志里看出"哪个参数漏传"）。
 */

// 2026-10-01 B11 前置 P1（D-223）：`GoalTemplateKind` 键集已下沉**类型中心**
// `@modules/types/goal`（core —— 纯字面量联合、零出向依赖）⇒ 解除
// `session/types/eventPayloads.ts` 经 `@modules/tasks` 取用时对 B11 的传递阻断。
// 本文件按 R05-013 口径**再导出**，既有消费方（`GoalEvents.ts` · `@modules/tasks` 桶）零改动。
import type { GoalTemplateKind } from '@modules/types/goal';

export type { GoalTemplateKind };

/**
 * 续接指令的变体。
 *
 * 键与「回合重试」的类别一一对应，来自两个钩子：
 * - `ReActToolLoop.onIncompleteTurn` 的 `kind`：`empty` / `reasoning` / `planning` / `truncated`；
 * - `ReActToolLoop.onFinalOutputValidation` 的重试类别：`mermaid_repair`（P1-1②，2026-09-28）。
 *
 * `resume_agent` 不属重试，是子代理恢复时拼进系统提示的续跑指示（见下）。
 */
export type ContinuationVariant =
  | 'empty'
  | 'reasoning'
  | 'planning'
  | 'truncated'
  | 'mermaid_repair'
  | 'resume_agent';

/**
 * 续接指令模板（M-7 自 `ReActToolLoop.ts` 的散落常量**行为中性迁移**至此单一来源；
 * 文案由 `goalTemplatesAndBudget.test.ts` 的逐字断言锁定 —— 2026-10-07 P2-2 批次 B8
 * 已完成中文化，断言同批更新）。本文件仍是文案的**唯一来源**，改文案须同批更新断言。
 *
 * 各条各自的语义边界：
 * - `empty`：整轮没有任何可见产出；
 * - `reasoning`：只产出了推理、没有可见答案；
 * - `planning`：只描述了计划、没有行动；
 * - `truncated`：输出被 `max_tokens` 截断（最常见的"任务中断"伪装）；
 * - `mermaid_repair`（P1-1②，2026-09-28）：终稿的 mermaid 代码块**未能通过结构预检**
 *   （前端渲染必然失败/降级）。`{{issues}}` 由校验器给出的问题清单渲染；
 * - `resume_agent`（B2-3 收尾迁移，2026-09-23）：**恢复被暂停的子代理**时拼进系统提示的
 *   续跑指示（原为 `AgentTool/ResumeAgent.reconstructSystemPrompt` 内的硬编码，Spec §5.3.1 #3）。
 */
export const CONTINUATION_TEMPLATES: Record<ContinuationVariant, string> = {
  empty:
    '上一次尝试没有产出用户可见的回答。请从当前状态继续，现在就给出可见的回答。不要从头重来。',
  reasoning:
    '上一轮助手只留下了推理过程，没有产出用户可见的回答。请从该未完成的轮次继续，现在就给出可见的回答。不要复述推理，也不要从头重来。',
  planning:
    '上一轮助手只描述了计划。不要复述计划。现在就开始行动：执行你能做的第一个具体工具操作。如果确有阻塞导致无法行动，用一句话说明确切的阻塞点。',
  truncated:
    '你上一次的输出在完成前被输出长度上限截断。不要复述任何已写过的内容，也不要重新进入推理。直接从输出中断处继续：如果你正要调用工具，现在就发出这些工具调用；否则简要地把可见回答写完。',
  mermaid_repair:
    '你上一条回复中的 mermaid 图表无效，无法渲染。发现的问题：\n{{issues}}\n请重新输出你上一条回复的完整内容，并修正其中的图表——修正后的回复将取代上一条。只使用 mermaid 支持的图类型，并保持括号/引号成对。除此之外不要改动其它内容。',
  resume_agent: '从你上次中断的地方继续。你可以访问上方完整的对话历史。',
};

/** 长程任务专用模板（键集）—— 定义已下沉 `@modules/types/goal`（本文件再导出，见文件头）。 */

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
    '本任务已耗尽词元预算 ({{tokensUsed}}/{{tokenBudget}})。现在停止开展新工作。请回复：(1) 已完成的内容，(2) 剩余的内容，(3) 下一步要执行的唯一动作。不要继续执行。',
  objective_updated:
    '目标已更新为："{{objective}}"。请按新目标重新对齐，并从当前状态继续。不要重做已经完成的工作。',
  progress_stalled:
    '该目标已连续 {{streak}} 批没有取得进展（目标："{{objective}}"）。现在停止在其上尝试新工作。请回复：(1) 已完成的内容，(2) 具体是什么阻碍了进展，(3) 需要用户决定或提供什么。不要开始下一批。',
  continue_goal:
    '未完成的目标仍处于打开状态（目标："{{objective}}"；已连续 {{streak}} 批没有取得进展）。请从当前状态继续朝它推进：现在就执行下一个具体动作。不要重做已经完成的工作。如果确有阻塞导致无法推进，用一句话说明确切的阻塞点，而不要开始新的工作。',
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
