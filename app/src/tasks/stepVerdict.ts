/**
 * 步骤结论判定（PDL 专用 · 纯函数 · 零 IO）
 *
 * ## 为什么需要这一层（2026-11-02 · 长程任务"假成功"根因修复）
 *
 * 缺陷实证（会话导出 `chat-export-1793578972845.md`，PDCA 5 步编排）：
 * 5 个步骤的产出分别是「信息不足，无法确定『继续』具体指什么」「阻塞，未生成续写内容」
 * 「校验无法完成，结论为阻塞/未通过」……但最终对用户播报的是
 * **「✅ PDCA 执行完成：5/5 步」**。
 *
 * 根因不在任何单点，而在整条链上**没有"目标是否达成"这个概念**：
 * - `PlanDrivenLoop._executeOneStep` 只要本步 LLM 回合正常返回文本就调 `markStepCompleted`
 *   （空产出还被填成字面量 `'完成'`）；
 * - `TaskOrchestrator.markStep{Failed,Cancelled,Completed}` 在"全部步骤到达终态"时
 *   一律把 plan 置 `completed`（**失败也算"完成"**）；
 * - `PdcaLauncher` 用 `percent >= 100` 判定是否播报"执行完成"。
 *
 * 即：**"流程走完"被当成了"目标达成"**（与 `architecture-compliance.md` AR-3
 * "检查器崩溃不得当通过" 同源）。
 *
 * ## 本模块的口径
 *
 * 判定**只读结构化标记**，不对自然语言做关键词匹配（CS02：状态判定必须基于持久化标记，
 * 不得依赖用户可见字符串）。步骤提示词要求模型在**最后一行**输出：
 *
 * ```
 * [STEP_STATUS: step_done]                        // 达成目标
 * [STEP_STATUS: step_blocked] [STEP_BLOCKED: 原因] // 受阻：缺信息 / 需人决策 / 工具不可用
 * [STEP_STATUS: step_partial]                     // 部分达成
 * ```
 *
 * 无标记 ⇒ `step_unverified`（**不**臆测为达成；由调用方按"未证实"如实处理）。
 *
 * ## 为什么取值带 `step_` 前缀
 *
 * `done` / `blocked` / `partial` 是**跨域通用词**，若直接作为本词汇表取值登记进
 * `stateMachineCatalog`，会把全仓大量既有出现点（dream、sandbox、compaction…）
 * 一并划入"已登记状态词汇" ⇒ 棘轮门禁被迫一次性收编十余个文件，削弱门禁强度。
 * 带前缀后取值**唯一可判定**，登记不产生副作用。
 */

/** 步骤结论取值（唯一事实源；已登记 `stateMachineCatalog` 的 `stepVerdict`） */
export const STEP_VERDICTS = [
  'step_done',
  'step_blocked',
  'step_partial',
  'step_unverified',
] as const;

export type StepVerdict = (typeof STEP_VERDICTS)[number];

/** 取值常量（调用方比较用；避免在扫描面里散落裸字面量） */
export const STEP_VERDICT_DONE: StepVerdict = 'step_done';
export const STEP_VERDICT_BLOCKED: StepVerdict = 'step_blocked';
export const STEP_VERDICT_PARTIAL: StepVerdict = 'step_partial';
export const STEP_VERDICT_UNVERIFIED: StepVerdict = 'step_unverified';

/** 结论标记前缀（提示词与解析共用，避免两处硬编码漂移） */
export const STEP_STATUS_TAG = 'STEP_STATUS';
export const STEP_BLOCKED_TAG = 'STEP_BLOCKED';

export interface StepVerdictResult {
  verdict: StepVerdict;
  /** `step_blocked` 时模型给出的受阻原因（可选，截断 300 字） */
  reason?: string;
}

/**
 * 从步骤产出文本中解析结论标记。
 *
 * 取**最后一个**合法标记（模型可能在正文里举例说明格式，末尾才是真结论）；
 * 标记值非法 ⇒ 按 `step_unverified` 处理（不猜测）。
 */
export function parseStepVerdict(
  text: string | undefined | null
): StepVerdictResult {
  if (!text) return { verdict: STEP_VERDICT_UNVERIFIED };

  const re = new RegExp(
    `\\[${STEP_STATUS_TAG}\\s*:\\s*([A-Za-z_-]+)\\s*\\]`,
    'gi'
  );
  let last: string | null = null;
  for (const m of text.matchAll(re)) {
    last = (m[1] ?? '').toLowerCase();
  }
  if (!last || !(STEP_VERDICTS as readonly string[]).includes(last)) {
    return { verdict: STEP_VERDICT_UNVERIFIED };
  }
  if (last === STEP_VERDICT_DONE) return { verdict: STEP_VERDICT_DONE };
  if (last === STEP_VERDICT_PARTIAL) return { verdict: STEP_VERDICT_PARTIAL };

  const reasonRe = new RegExp(
    `\\[${STEP_BLOCKED_TAG}\\s*:\\s*([^\\]\\n]{1,300})\\]`,
    'i'
  );
  const reason = reasonRe.exec(text)?.[1]?.trim();
  return { verdict: STEP_VERDICT_BLOCKED, reason: reason || undefined };
}

/**
 * 该结论是否算"目标达成"（只有 `step_done` 算；其余都不算）。
 *
 * 注意：`step_unverified` 仍沿用既有行为被标为 `completed`（向后兼容，避免既有计划
 * 全部变红），但**不计入"执行完成"播报**且在收尾时如实标注条数。
 */
export function isGoalAchieved(verdict: StepVerdict): boolean {
  return verdict === STEP_VERDICT_DONE;
}
