/**
 * 主循环终止原因 → 用户可见提示（P0-5，2026-11-05 从 `ChatMessage.tsx` 抽出）
 *
 * 数据来源：后端 `turn/end.terminationReason`（值域 = `app/src/query/ReActLoop.ts` 的
 * `TerminationReason`，TB-16 2026-09-24 起落盘）。本模块把它按"用户能据此行动"收敛为 5 组。
 *
 * 为什么抽出来（P0-5 验收口径「任何非正常终止都能在 UI 上看到一行原因」）：
 *   · 原实现是组件内的 `Record`，**缺键 = 静默无提示**；后端新增一个终止原因时前端不报错、
 *     用户也看不到任何说明（只能听到"结束提示音"）。抽成纯函数后可用测试锁死覆盖面。
 *   · 未知原因（非 `completed`、非空）一律给**兜底文案 + 原因码**，不再静默。
 *
 * `completed` 属正常收尾 ⇒ 不显示（不制造噪音）；`undefined`（无主循环 / 普通文本轮）同理。
 */

/** 提示分组（对应 `chat.termination*` 文案键） */
export interface TerminationNotice {
  /** i18n 键 */
  key: string;
  /** 中文兜底（i18n 未加载时用） */
  fallback: string;
  /** i18n 插值参数（仅"未知原因"用：`{ reason }`） */
  params?: Record<string, string>;
}

const HINT_ABORTED = "本轮已中止，未继续执行。";
const HINT_BUDGET =
  "已达本轮预算上限（轮次 / token / 时长），任务未在预算内完成。";
const HINT_FUSED = "触发熔断：连续多轮没有实质进展，已停止以免空转。";
const HINT_ERROR = "本轮异常终止（推理输出异常 / 内部错误 / 上下文压缩失败）。";
const HINT_BLOCKED =
  "因环境阻塞而终止（权限 / 安全拦截 / 能力未就绪），重试通常无效。";
const HINT_OUTPUT_BUDGET =
  "本轮输出预算已被推理耗尽，正文未能生成；回复「继续」可接着生成。";

/** 已知终止原因 → 提示（键集合 = 后端 `TerminationReason` 去掉 `completed` 与被抑制项） */
const NOTICES: Record<string, TerminationNotice> = {
  aborted: { key: "chat.terminationAborted", fallback: HINT_ABORTED },
  system_aborted: { key: "chat.terminationAborted", fallback: HINT_ABORTED },
  max_turns: { key: "chat.terminationBudget", fallback: HINT_BUDGET },
  budget_exhausted: { key: "chat.terminationBudget", fallback: HINT_BUDGET },
  timeout: { key: "chat.terminationBudget", fallback: HINT_BUDGET },
  // N-13 / P2-5（2026-11-07）：输出预算被推理耗尽 ⇒ 独立分组（此前落"未知原因：异常结束"）
  output_budget_exhausted: {
    key: "chat.terminationOutputBudget",
    fallback: HINT_OUTPUT_BUDGET,
  },
  no_progress: { key: "chat.terminationFused", fallback: HINT_FUSED },
  exploration_fatigue: { key: "chat.terminationFused", fallback: HINT_FUSED },
  circuit_breaker: { key: "chat.terminationFused", fallback: HINT_FUSED },
  diminishing_returns: { key: "chat.terminationFused", fallback: HINT_FUSED },
  loop_detected: { key: "chat.terminationFused", fallback: HINT_FUSED },
  reasoning_error: { key: "chat.terminationError", fallback: HINT_ERROR },
  internal_error: { key: "chat.terminationError", fallback: HINT_ERROR },
  compaction_failed: { key: "chat.terminationError", fallback: HINT_ERROR },
  error: { key: "chat.terminationError", fallback: HINT_ERROR },
  environment_blocked: {
    key: "chat.terminationBlocked",
    fallback: HINT_BLOCKED,
  },
  verifier_escalate: { key: "chat.terminationBlocked", fallback: HINT_BLOCKED },
};

/** 已覆盖的后端终止原因（仅供测试对照；新增后端原因时该测试会提醒补文案） */
export const KNOWN_TERMINATION_REASONS = Object.freeze(Object.keys(NOTICES));

/**
 * P2-5（2026-11-07）：**不额外显示提示**的中性原因。
 *
 * `awaiting_approval` = "工具已提交审批、本回合主动收尾"，助手正文已写明
 * 「⏸ 有工具调用正在等待你的审批…批准后会自动接着执行」⇒ 再叠一条
 * 「本轮异常结束（原因码：awaiting_approval）」既重复又把暂停说成异常
 * （真机 §32.5 实证）。故此处显式抑制，而不是给它编一条"异常"文案。
 */
export const SUPPRESSED_TERMINATION_REASONS = Object.freeze([
  "awaiting_approval",
]);

const SUPPRESSED = new Set<string>(SUPPRESSED_TERMINATION_REASONS);

/** `completed`：正常收尾，不显示提示 */
export const TERMINATION_COMPLETED = "completed";

/**
 * 取终止原因对应的用户提示。
 *
 * @returns `null` = 不显示（`completed` / 未携带原因）；否则为 `{ key, fallback }`
 */
export function getTerminationNotice(
  reason: string | undefined,
): TerminationNotice | null {
  if (!reason || reason === TERMINATION_COMPLETED) return null;
  // P2-5：中性暂停（正文已说明）⇒ 不叠加"异常结束"提示
  if (SUPPRESSED.has(reason)) return null;
  const known = NOTICES[reason];
  if (known) return known;
  // 未知原因：**不静默**（P0-5 验收），给通用说明并把原因码原样带上，便于用户/我们对照
  return {
    key: "chat.terminationUnknown",
    fallback: `本轮异常结束（原因码：${reason}）。`,
    params: { reason },
  };
}
