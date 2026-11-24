/** 聊天中附带的图片信息 */
export interface AttachedImage {
  /** 上传后的后端文件路径（绝对路径） */
  path: string;
  /** HTTP 可访问的 URL */
  url: string;
  /** 原始文件名 */
  filename: string;
  /** 文件大小（字节） */
  size: number;
}

/**
 * 2026-11-24：连续「孤儿工具结果」合并后的单条记录。
 *
 * 存量会话（无事件日志）里 assistant 的 `tool_calls` 往往不全，部分 `role=tool`
 * 结果找不到对应调用定义。连续多条这类结果在 `setMessages` 阶段合并为**一条**消息
 * （`metadata.groupedToolResults`），由 `ToolResultGroup` 渲染成可收缩的树，
 * 避免一屏几十个「工具返回」气泡。
 */
export interface GroupedToolResult {
  id: string;
  toolCallId?: string;
  /** 工具结果原文（未解码的持久化信封） */
  content: string;
  timestamp?: number;
  isError?: boolean;
  securityIntercepted?: boolean;
  reason?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  /** 流式开始时间（毫秒，1.6：与 timestamp 完成时间区分，导出显示开始时间与耗时） */
  startedAt?: number;
  /** 本轮整轮耗时（毫秒，前端流结束计算：用户发送→助手回复完成；仅当前轮实时写入，不落盘） */
  durationMs?: number;
  /** B-1（2026-08-23）：事件派生排序键（后端派生消息的 lastEventSeq，setMessages 排序用） */
  lastEventSeq?: number;
  /**
   * 2026-11-18（H1）：**排序/分页游标键**（首事件 seq）。优先于 `lastEventSeq`：
   * 后者是版本戳，会被"回合结束后才落盘"的事件抬高（真机通道会话问答顺序翻转）。
   */
  firstEventSeq?: number;
  session_id: string;
  tool_calls?: ToolCall[];
  blocks?: MessageBlock[];
  toolCallId?: string;
  error?: string;
  replyToId?: string;
  /** 产生该消息的 Agent 名称 */
  agentName?: string;
  /** 用户消息附带的图片 */
  attachedImages?: AttachedImage[];
  /** 元数据（含安全拦截标记等） */
  metadata?: Record<string, unknown>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  /**
   * 回复结束原因（2026-08-24 中断提示链路）：
   * - stop/length/max_tokens/tool_calls/tool_use：正常结束
   * - canceled/abort：回复被中断（用户停止/幽灵块检测/后端静默中断）
   * - error：流异常（SSE 断开等，已有"连接已断开"提示块）
   * - yielded（N-45，2026-09-20）：本轮以 `sessions_yield` 让出 turn，等待子任务结算后自动续跑
   * - unknown（一期 F1-2，2026-09-23）：provider 未报结束原因——后端三个落盘点统一用该
   *   哨兵值（此前落库用 'stop' 会把"未知"谎报为"正常结束"）
   */
  finishReason?:
    | "stop"
    | "length"
    | "max_tokens"
    | "tool_calls"
    | "tool_use"
    | "canceled"
    | "abort"
    | "error"
    | "yielded"
    | "unknown";
  /**
   * 主循环终止原因（后端 `turn/end.terminationReason`，2026-11-03 P1 可见化）。
   *
   * 与 `finishReason` 语义不同：后者是 provider 末次响应（长程轮正常收尾常报 `tool_use`），
   * 「这轮为什么停下」只看本字段。值域见后端 `query/ReActLoop.ts` 的 `TerminationReason`
   * （`completed` / `no_progress` / `max_turns` / `environment_blocked` …）。
   */
  terminationReason?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionData {
  questionId: string;
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface MessageBlock {
  id: string;
  type:
    | "text"
    | "thinking"
    | "tool_call"
    | "status"
    | "task_decomposition"
    | "question"
    | "todo"
    | "progress"
    | "deliverable"
    | "diff"
    | "inbox"
    | "doc_workflow"
    | "pdca_workflow"
    | "workflow_run"
    | "code_run"
    | "diagnostic";
  content: string;
  toolCall?: ToolCall;
  /** 事件派生块字段（后端 EventMessageDeriver.makeBlock）：toolName/args 为 toolCall 的扁平化，加载时归一化 */
  toolName?: string;
  args?: Record<string, unknown>;
  status?: string;
  /** 状态块阶段（如压缩 compaction：compacting=进行中 / done=完成），CS02 结构化标记 */
  phase?: "compacting" | "done";
  /** 结构化水位数据（status === "watermark" 时存在），CS02：替代对 content 的正则解析 */
  watermark?: { pct: number; severity: "warn" | "compact" };
  isStreaming?: boolean;
  toolCallId?: string;
  groupId?: string;
  taskCard?: TaskCardData;
  questionData?: QuestionData;
  deliverableData?: DeliverableData;
  diffData?: DiffData;
  inboxData?: InboxBlockData;
  docWorkflowData?: DocWorkflowProgressData;
  pdcaWorkflowData?: PdcaWorkflowProgressData;
  workflowData?: WorkflowRunData;
  codeRunData?: CodeRunBlockData;
  /**
   * C4（2026-10-30）：内部诊断文本（`[系统提示]` / `工具执行失败` / `安全检查失败` …）。
   * 由渲染侧从 assistant 的 text 块拆出 ⇒ 气泡只显示 `summary`，`detail` 默认收起。
   */
  diagnosticData?: DiagnosticBlockData;
}

/** C4：诊断详情块数据 */
export interface DiagnosticBlockData {
  /** 一行摘要（用户可读，取自原文首行，超长截断） */
  summary: string;
  /** 完整诊断原文（原始报错 / steering 文案） */
  detail: string;
}

/** Code Mode 执行块数据（CM-5 读侧：回放展示代码/状态/输出/内部调用摘要） */
export interface CodeRunBlockData {
  /** 本轮编排代码 */
  code: string;
  /** 轮次序号 */
  round: number;
  /** 执行结果分类 */
  status:
    | "completed"
    | "failed"
    | "compiled-error"
    | "security-rejected"
    | "timeout"
    | "canceled";
  /** 结构化结果（done(result) 携带） */
  output?: unknown;
  /** 错误信息 */
  error?: string;
  /** 结构化错误（顶层异常帧） */
  structuredError?: { type: string; message: string; stack?: string };
  /** 内部工具调用摘要（CM-5：不逐条落独立 tool_call 事件） */
  toolCalls?: Array<{
    name: string;
    argsHash: string;
    truncatedResult?: string;
    ok: boolean;
  }>;
  /** 用户脚本日志（截断） */
  logs?: string[];
  /** 执行耗时（ms） */
  durationMs?: number;
}

export interface TaskCardData {
  title: string;
  tasks: TaskCardTask[];
  /**
   * 2026-11-13：`paused` = 任务停在**等待用户审批**（既非执行中、也非已结束）。
   * 后端 Plan.paused / checkpoint 相位 `stage_awaiting_approval` 映射到此。
   */
  status: "planning" | "executing" | "done" | "paused";
  /**
   * G5-D4（2026-11-18）：验收子态（后端 `Plan.acceptance` 的投影）。
   * `pending` = 已执行、目标门未决 ⇒ 徽标显示「待验收」而不是普通执行进度；
   * 缺省 = 旧数据/已验收（视作 accepted）。
   */
  acceptance?: "pending" | "accepted" | "rejected";
  /** P2（08-09）：关联的 PlanDrivenLoop planId，用于 SSE 实时更新 */
  planId?: string;
}

export interface TaskCardTask {
  id: string;
  name: string;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked"
    | "skipped";
  dependsOn: string[];
  result?: string;
  durationMs?: number;
}

/** 2026-11-24（批次 19）：`ProgressData` / `progress` 块已下线（用户裁定简化前端显示）；
 *  后端 `assistant/progress` 事件契约保留，前端不再派生/渲染该块。 */

/** 交付物数据——AI 完成工作后推送的文件变更列表 */
export interface DeliverableData {
  files: {
    path: string;
    change: "added" | "modified" | "deleted";
    status: "pending" | "verified" | "failed";
  }[];
  summary: string;
  checks?: { name: string; passed: boolean; detail?: string }[];
  actions?: {
    label: string;
    action: "accept" | "reject" | "retry";
    file?: string;
  }[];
}

/** diff 数据——AI 代码变更的 unified diff 格式预览 */
export interface DiffData {
  file: string;
  diff: string;
  language?: string;
  stats?: { additions: number; deletions: number };
}

/** Inbox 审批/提问交互卡片数据 */
export interface InboxBlockData {
  inboxId: string;
  type: "approval" | "question" | "authorization";
  title: string;
  content: string;
  status: "pending" | "replied" | "expired";
  priority?: "urgent" | "normal" | "low";
  actions: Array<{
    label: string;
    reply: string;
    style: "primary" | "danger" | "secondary";
  }>;
  channelSource?: string;
  expiresAt?: number;
  /**
   * P0-1（2026-11-04）：同指纹审批被**合并**的次数（`> 1` 时卡片显示 `×N`）。
   *
   * 数据源：`inbox_items.metadata.dedupCount`；合并时由后端回填到本块的 `inboxData`。
   */
  dedupCount?: number;
}

export interface Tool {
  name: string;
  description: string;
  enabled: boolean;
  read_only: boolean;
  destructive: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: "running" | "completed" | "failed";
  /** P2-2: 工具审批等待态标记（ask 决策），区别于失败（结构化信号，非字符串匹配） */
  pendingApproval?: boolean;
  /** U-06-5: 已提交的 Inbox 项 id —— 工具卡片就地审批（批准/拒绝） */
  inboxId?: string;
  /**
   * 2026-11-24：审批已落定但**没有终态结果**时的真实状态（读历史时按 inbox 回查）。
   * `pendingApproval` 已清空，卡片据此说明"为什么没有结果"，避免占位文案被读成仍在等待。
   */
  approvalStatus?: "replied" | "expired";
  /** 标记 result 为截断摘要，全量结果通过 getToolResultFull(id) 获取 */
  _hasFullResult?: boolean;
  /** 工具执行失败原因（status='failed' 时存在，日志面板据此展示失败详情） */
  error?: string;
}

// ============================================================
// 子组件 Props 接口 — 接口契约先行，组件拆分前定义
// ============================================================

/** MessageHeader 子组件 Props */
export interface MessageHeaderProps {
  role: "user" | "assistant" | "system" | "tool";
  timestamp: number;
  channel?: "web" | "terminal";
  status?: "sending" | "sent" | "error";
}

/** 文档工作流阶段类型 */
export type DocWorkflowStage = "outline" | "filling" | "compose";

/** 文档工作流阶段状态 */
export type DocWorkflowStageStatus =
  "pending" | "in_progress" | "awaiting_confirm" | "completed" | "failed";

/** 文档工作流进度数据（设计方案 §4 M3） */
export interface DocWorkflowProgressData {
  /** 文档标题 */
  title: string;
  /** 输出格式 */
  format: "docx" | "pptx" | "html" | "pdf";
  /** 当前阶段 */
  currentStage: DocWorkflowStage;
  /** 阶段状态 */
  stages: Record<
    DocWorkflowStage,
    {
      status: DocWorkflowStageStatus;
      /** 阶段内进度（0-100） */
      progress?: number;
      /** 阶段描述 */
      description?: string;
      /** 节点级进度（大纲/填充阶段使用） */
      nodes?: {
        id: string;
        title: string;
        status: "pending" | "in_progress" | "completed" | "failed";
        hasImage?: boolean;
      }[];
    }
  >;
  /** 最终输出文件路径（compose 完成后填充） */
  outputFilePath?: string;
  /** 失败原因 */
  error?: string;
}

/** PDCA 自动启动快照数据（聊天正文内嵌卡片；P2-A 2026-09-17） */
export interface PdcaWorkflowProgressData {
  decision: "pdl" | "stage-chain" | "research";
  stage?: "plan" | "execute" | "review" | "decide";
  status?: "started" | "running" | "completed" | "failed";
  message: string;
  projectId?: string;
  reasons?: string[];
}

/** 工作流 run 状态（run 级；P1-3 §12 D14 聚合卡片） */
export type WorkflowRunStatus =
  "running" | "completed" | "failed" | "cancelled" | "interrupted";

/** 工作流步骤状态（成员级；`pending` = 计划内但未开始） */
export type WorkflowRunStepStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

/** 工作流步骤数据（由 workflow_step_* 事件聚合；`stepId === tool` 见 docWorkflows.ts） */
export interface WorkflowRunStepData {
  stepId: string;
  /** 工具名 */
  tool: string;
  description: string;
  status: WorkflowRunStepStatus;
  /** 步骤耗时（workflow_step_end.durationMs） */
  durationMs?: number;
  /** 步骤级错误（workflow_step_end.error） */
  error?: string;
  /** 由账本强制结算（Provider 未上报 end）——如实标注，不编造 */
  synthesized?: boolean;
}

/**
 * 工作流 run 卡片数据（P1-3 §12 D14，2026-10-05 实建）。
 *
 * 由 4 类事件**原地聚合**为一张卡片（不再各产一条 status 提示行）：
 * `workflow_run_start` 建卡（含计划步骤）→ `workflow_step_start`/`_end` 更新步骤 →
 * `workflow_run_end` 收尾。前后端**逐字段同形**（后端镜像派生，保证回放一致）。
 *
 * 中断合成仅由**后端重放期**写入（D15：`interruptedHint`），前端实时视图不含。
 */
export interface WorkflowRunData {
  runId: string;
  workflow: string;
  status: WorkflowRunStatus;
  /** 计划步骤按 `workflow_run_start.steps[]` 预置，随事件推进更新状态 */
  steps: WorkflowRunStepData[];
  /** 总耗时（workflow_run_end.durationMs；未收尾时缺省） */
  durationMs?: number;
  stopReason?: "completed" | "cancelled" | "error";
  failedStep?: string;
  error?: string;
  /** 上游根因候选摘要（P0-2） */
  rootCauseSummary?: string;
  /** 重放期中断合成文案（D16，仅后端派生写入） */
  interruptedHint?: string;
}

/** MessageContent 子组件 Props */
export interface MessageContentProps {
  content: string;
  blocks?: MessageBlock[];
  isStreaming?: boolean;
  messageId: string;
}

/** MessageActions 子组件 Props */
export interface MessageActionsProps {
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  isStreaming?: boolean;
  /** 是否为最后一条 AI 消息（控制"重新生成"按钮显示） */
  isLastAiMessage?: boolean;
  /** 消息是否被截断（控制"继续生成"按钮显示） */
  isTruncated?: boolean;
  finishReason?: Message["finishReason"];
}

/** ToolCallInline 子组件 Props（扁平化后的工具调用展示） */
export interface ToolCallInlineProps {
  toolCall: ToolCall;
  /** 点击展开详情的回调 */
  onExpand?: (toolCall: ToolCall) => void;
}

/** ToolCallGroup 子组件 Props（扁平化后的工具执行组） */
export interface ToolCallGroupProps {
  blocks: MessageBlock[];
  isStreaming?: boolean;
  /** 组标题（如 "工具执行"） */
  title?: string;
}

/** TaskCard 子组件 Props */
export interface TaskCardProps {
  data: TaskCardData;
  isStreaming?: boolean;
}

/** InputComposer 子组件 Props */
export interface InputComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** 是否正在流式输出（控制停止按钮显示） */
  isStreaming?: boolean;
  onStop?: () => void;
}

/** StreamIndicator 子组件 Props（流式光标指示器） */
export interface StreamIndicatorProps {
  /** 是否正在流式输出 */
  active: boolean;
}
