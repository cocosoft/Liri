/**
 * lro/stepPromptAssembly.ts — 步骤 prompt 组装（2026-11-28 外移）
 *
 * **来源**：`tasks/PlanDrivenLoop.ts` 的私有方法 `_buildStepPrompt` 与常量
 * `MAX_STEP_PLAN_CHARS`（**逐字搬迁**；唯一改动是 `this.planSource / this.plan?.description /
 * this.workspacePath / this._pitfallContext` → 入参）。
 *
 * 为什么外移：`PlanDrivenLoop.ts` 已到 R04-001 的 2000 行边界（例外 FSE-002）；prompt 组装是
 * **纯字符串拼接**、无宿主副作用，属最安全的可外移簇。宿主侧保留同名薄委托，调用点零改动。
 *
 * 行为不变红线：段落顺序、`STEP_STATUS` 契约文案、`MAX_STEP_PLAN_CHARS` 截断口径逐字未变。
 */

/** P2-2（2026-11-06）：步骤 prompt 注入的任务源上限（防超长计划吃满上下文） */
export const MAX_STEP_PLAN_CHARS = 6000;

export interface StepPromptInput {
  task: { id: string; description: string };
  allTasks: Array<{ id: string; description: string }>;
  index: number;
  /** 依赖前驱产出摘要（P0-1；无依赖/无产出则空） */
  predecessorSummary?: string;
  /** 上次失败 objection（P0-2：失败类型门控重试的第 2 次尝试） */
  retryError?: string;
  /** 本次 run 的完整任务源（用户原话 + 助手计划正文；空则回退计划描述） */
  planSource: string;
  /** 计划描述（`Plan.description`，仅 200 字） */
  planDescription?: string;
  /** 会话工作区（与工具 cwd 同源；未注入则 prompt 不写该行） */
  workspacePath?: string;
  /** 同类历史 pitfall 上下文（仅首步注入一次） */
  pitfallContext?: string;
}

/** 构建步骤执行的 prompt（P0-1：可注入依赖前驱产出摘要；P0-2：可携带上次失败 objection） */
export function buildStepPrompt(input: StepPromptInput): string {
  const { task, allTasks, index, predecessorSummary, retryError } = input;
  const total = allTasks.length;
  const completed = allTasks
    .slice(0, index)
    .map((t) => `- [已完成] ${t.description}`)
    .join('\n');

  return [
    `你正在执行一个多步骤任务。当前是步骤 ${index + 1}/${total}。`,
    // 2026-11-02：**总体目标锚点**。此前步骤只拿到"本步描述"与已完成步骤，
    // 分解失准（例如被无目标消息触发而分解出"澄清型"步骤）时，每步都会重新向用户
    // 要信息（会话导出实证：5 步全部"信息不足"）⇒ 用计划描述把每步锚回原始目标。
    // P2-2（2026-11-06）：改用**完整任务源**（含助手计划正文）——`plan.description`
    // 只有 200 字，计划正文会被截掉；真机 step1 因此"找不到执行计划"直接 blocked。
    (() => {
      const goal = (input.planSource || input.planDescription || '')
        .trim()
        .slice(0, MAX_STEP_PLAN_CHARS);
      return goal ? `本次任务总体目标与已确认计划：\n${goal}` : '';
    })(),
    // P2-2：工作区与工具可用性 —— 真机 step1 自述"没有文件路径/工具"（5 秒 blocked）
    input.workspacePath
      ? `工作区（所有文件读写以此目录为准）：${input.workspacePath}`
      : '',
    '如需查看/修改文件，请直接调用当前可用的文件/终端工具；若确实不可用，错误信息会说明原因。',
    '',
    // Teamwork P2b（2026-09-06）：首步注入同类历史 pitfall（避免重蹈覆辙；仅首步一次）
    index === 0 && input.pitfallContext
      ? `[历史经验（同类任务曾失败于此）]\n${input.pitfallContext}\n`
      : '',
    '已完成步骤：',
    completed || '（无）',
    predecessorSummary
      ? `\n依赖前驱结果（本步可直接使用）：\n${predecessorSummary}`
      : '',
    '',
    `当前步骤：${task.description}`,
    '',
    retryError
      ? `[上一步尝试失败] ${retryError.slice(0, 800)}\n请勿重复失败路线；若不可行请给出替代方案，或明确告知 blocker。`
      : '请只执行当前步骤，完成后汇报结果。不要执行后续步骤。',
    '',
    // 2026-11-02（长程任务"假成功"根因修复）：结论标记是**必填契约**。
    // 此前步骤终态只由"LLM 回合是否正常返回文本"决定 ⇒ 自述"信息不足/阻塞"的步骤
    // 也被记为 completed，5 步全空转仍播报"执行完成"。判定改读此结构化标记（非关键词匹配）。
    '[结论标记（必填，放在回答最后一行）]',
    '[STEP_STATUS: step_done]    ← 本步目标已达成',
    '[STEP_STATUS: step_blocked] [STEP_BLOCKED: 缺什么信息 / 需要谁决策 / 哪个工具不可用]',
    '[STEP_STATUS: step_partial] ← 只完成了一部分，并说明还差什么',
    '注意：目标未达成时**不得**标 step_done（缺信息就用 step_blocked，不要用"已完成"掩盖）。',
  ].join('\n');
}
