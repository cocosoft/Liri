/**
 * 工具调用结果态 —— **单一派生实现**（批次 4 / B3，2026-11-24）。
 *
 * 缺口：同一工具调用在不同展示面（组头 `ToolExecutionGroup` / 工具卡 `ToolCallGroup` /
 * 行内标签 `ToolInlineTags` / 日志面板 `LogTab`）各自判"完成/中断/未知"，判据 3–4 套 ⇒
 * 真机上同一调用可同时显示「已完成」「已中断」「未知工具」。本模块把判据收敛为**一次**。
 *
 * 判定顺序（固定，避免各面自行解释）：
 * 1. `pending_approval`：`pendingApproval === true` 且对应审批卡**未落定**；
 * 2. `running`：`status === 'running'`（调用方明确 `isStreaming === false` 时视为中断 ——
 *    流已结束仍停在 running，说明没有终态事件）；
 * 3. `failed` / `completed`：终态；
 * 4. `interrupted`：无终态（审批已落定但无结果、历史残留、工具已取消）；
 * 5. `unknown`：连调用对象都没有。
 */

/** 工具调用结果态（展示层唯一词汇表） */
export type ToolOutcome =
  | "pending_approval"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "unknown";

/**
 * 派生所需的**结构子集**（`ToolCall` 与日志面板 `ToolCallRecord` 都满足）。
 *
 * 只读结构化字段（CS02）：禁止按 result 文案 / 工具名文案推断状态。
 */
export interface ToolOutcomeSource {
  status?: string;
  pendingApproval?: boolean;
  inboxId?: string;
  result?: unknown;
}

export interface DeriveToolOutcomeOptions {
  /**
   * 该调用是否**仍在流式执行**。
   * 显式给 `false` 且 `status === 'running'` ⇒ 判为 `interrupted`（流已结束却无终态）；
   * 不给（`undefined`）⇒ 保持 `running`，不擅自推断。
   */
  isStreaming?: boolean;
  /** 已落定（已处理/已过期）审批的 inboxId 集合；未提供 ⇒ 只按标记判 */
  resolvedInboxIds?: ReadonlySet<string>;
}

/** 派生单个工具调用的结果态 */
export function deriveToolOutcome(
  toolCall: ToolOutcomeSource | undefined,
  options: DeriveToolOutcomeOptions = {},
): ToolOutcome {
  if (!toolCall) return "unknown";

  const resolved =
    typeof toolCall.inboxId === "string" &&
    options.resolvedInboxIds?.has(toolCall.inboxId) === true;
  if (toolCall.pendingApproval === true && !resolved) return "pending_approval";

  if (toolCall.status === "running") {
    return options.isStreaming === false ? "interrupted" : "running";
  }
  if (toolCall.status === "canceled") return "interrupted";
  if (toolCall.status === "failed") return "failed";
  if (toolCall.status === "completed") return "completed";
  // 无显式状态但有结果 ⇒ 事实上已完成（消息级 tool_calls 兜底路径常见）
  if (toolCall.result !== undefined) return "completed";
  // 其余（审批已落定无结果 / 历史残留）⇒ 中断，不谎报完成或执行中
  return "interrupted";
}

/** 组级聚合结果（比 `ToolOutcome` 多一个 `empty`） */
export type ToolGroupOutcome = ToolOutcome | "empty";

interface GroupBlock {
  type?: string;
  isStreaming?: boolean;
  toolCall?: ToolOutcomeSource;
}

/**
 * 派生一组工具调用的**组头状态**。
 *
 * 优先级：`running` > `pending_approval` > `failed` > `interrupted` > `completed`
 * （与修复前的组头口径一致：有活干就显示执行中；仅剩等待时才显示待审批）。
 */
export function deriveGroupOutcome(
  blocks: ReadonlyArray<GroupBlock>,
  options: Omit<DeriveToolOutcomeOptions, "isStreaming"> = {},
): ToolGroupOutcome {
  let hasTool = false;
  let outcomes: ToolOutcome[] = [];
  for (const b of blocks) {
    if (b.type !== "tool_call") continue;
    hasTool = true;
    outcomes.push(
      deriveToolOutcome(b.toolCall, {
        ...options,
        isStreaming: b.isStreaming,
      }),
    );
  }
  if (!hasTool) return "empty";

  const has = (o: ToolOutcome): boolean => outcomes.includes(o);
  if (has("running")) return "running";
  if (has("pending_approval")) return "pending_approval";
  if (has("failed")) return "failed";
  if (has("interrupted")) return "interrupted";
  return "completed";
}
