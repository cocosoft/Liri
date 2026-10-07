// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 事件溯源 — 前端事件类型
 *
 * 事件名（`LiriEventType`）的**单一事实源**：`shared/events/eventNames.ts`（双端共用，
 * 2026-09-30，台账 D-57）—— 本联合由其派生。原「手写镜像 app 侧」的做法同期废弃
 * （曾**实证漂移**：台账 D-1，client 落后 5 个类型）。
 *
 * 载荷（`LiriEventMap`）仍由本端自持：后端载荷引用后端领域类型，不宜下沉到 shared。
 */

import { LIRI_EVENT_NAMES } from "@shared/events/eventNames";

// ─── 事件类型枚举 ───────────────────────────────

export type LiriEventType = (typeof LIRI_EVENT_NAMES)[number];

// ─── 事件载荷映射 ───────────────────────────────

// ─── 目标域词表（单一事实源：`shared/types/goal-types.ts`） ───
// 2026-10-05 P1-18 / L4：以下 4 个联合曾为「治标」手写镜像（D-1 补镜像，2026-09-28），
// 且与后端定义分处两份 ⇒ 已下沉 `shared/types/goal-types.ts` **单一事实源**，
// 本文件**再导出**（对外导出名/成员逐字不变，既有消费方零改动）。
import type {
  TaskGoalStatus,
  TaskGoalUpdateReason,
  GoalTemplateKind,
  GoalDeviationSeverity,
} from "@shared/types/goal-types";

export type {
  TaskGoalStatus,
  TaskGoalUpdateReason,
  GoalTemplateKind,
  GoalDeviationSeverity,
};

/**
 * 目标实体投影（X11，2026-10-05；与后端 `app/src/tasks/goal/TaskGoalStore.ts` 的
 * `TaskGoal` 同形，字段名逐字对齐）。
 *
 * 契约（`app/src/infrastructure/http/handlers/routes/goal-routes.ts`）：
 * - `GET /v1/goals` ⇒ `{ goals: TaskGoalDto[], count }`
 * - `POST /v1/goals` / `PATCH /v1/goals/{id}` ⇒ `{ goal: TaskGoalDto }`
 */
export interface TaskGoalDto {
  id: string;
  sessionId?: string;
  objective: string;
  status: TaskGoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  noProgressStreak: number;
  runId?: string;
  updatedReason?: TaskGoalUpdateReason;
  createdAt: number;
  updatedAt: number;
}

export interface LiriEventMap {
  "turn/start": { turn: number; userMessageSeq?: number };
  /**
   * 每轮在线质量分（U4，2026-10-06；`app` 侧 spec `.trae/specs/online-quality-evaluation.md`）。
   *
   * **离线消费**（梦境/离线聚合按分取"高价值轮"）；**不注入提示词** ⇒ 前端目前
   * 不参与渲染，仅作事件可重建性与审计读取视图。形状与后端载荷**逐字对齐**
   * （门禁 `app/tests/chat/eventTypeParity.test.ts` 的编译期字段级校验会抓漂移）。
   *
   * `score` 是**相对质量分**，不是正确率；消费时必须看 `evaluatorVersion` 区分口径。
   */
  "turn/quality": {
    turnNumber: number;
    score: number;
    evaluatorVersion: string;
    components: {
      completion: number;
      verdict: number;
      toolThrash: number;
      cost: number;
    };
    signals: {
      status: "running" | "completed" | "error" | "aborted";
      toolCalls: number;
      durationMs?: number;
      inputTokens: number;
      outputTokens: number;
    };
    reviewed: boolean;
    reviewSkipped?: "no-model" | "budget";
    review?: {
      verdict: "APPROVE" | "REJECT" | "ESCALATE";
      confidence: number;
      checkPassRate?: number;
      reason?: string;
    };
  };
  "turn/end": {
    turn: number;
    /** `'yielded'`（N-45，2026-09-20）：本轮以 `sessions_yield` 让出，等待子任务结算后续跑 */
    finishReason?:
      "stop" | "length" | "tool_use" | "error" | "canceled" | "yielded";
    /** 阶段 A（A1-d）：本轮是否为 yield 让出（与 `finishReason='yielded'` 同时写入） */
    yielded?: boolean;
    /**
     * TB-16（2026-09-24）：**主循环的终止判定**（后端 `getTerminationReason()` 口径）。
     * 与 `finishReason` 语义不同（后者是 provider 末次响应，长程轮正常收尾常报 `tool_use`）；
     * 仅工具循环路径写入，单次回复时省略。本字段为只读展示/审计用。
     */
    terminationReason?: string;
    error?: string;
  };
  "user/message": {
    content: string;
    /**
     * 附件列表。形状 = 后端 `DataAttachment`（`app/src/core/data-models.ts`，经
     * `@modules/core` 导出）—— 该类型属 app 侧（client 不引用 app 内部类型）⇒ 此处**按
     * 线上形状内联**。
     * L2/L3（2026-10-05 P1-18）：原误写为 `{path,filename,size}`，与后端产出**字段级不符**
     * （`eventTypeParity` 编译期门禁抓出，两端已对齐）。
     */
    attachments?: Array<{
      type: string;
      url: string;
      name: string;
      size?: number;
      contentType?: string;
    }>;
    /** 归属消息 id（P1-5：SSE/事件透传，非流式落盘消息为投影 id） */
    messageId?: string;
    /** F4（2026-08-25）：被回复消息 id（回复引用，刷新后透传到派生消息） */
    replyToId?: string;
  };
  "assistant/thinking": { content: string; messageId?: string };
  "assistant/text": {
    content: string;
    messageId?: string;
    /**
     * O2-4（2026-09-24）：**正文取代标记** —— 本 delta 取代该消息此前已累积的正文
     * （续接/重试轮的首个 delta）。派生层据此清空已累积正文后重建，使流内视图与落盘
     * `assistantMessage.content`（后端每轮整体替换）同源（project_rules §1.6「所见即所存」）。
     */
    replace?: boolean;
  };
  "assistant/text-batch": { content: string; messageId?: string };
  "assistant/tool_call": {
    toolCallId: string;
    name: string;
    args: unknown;
    messageId?: string;
  };
  "tool/result": {
    callSeq: number;
    toolCallId: string;
    result: string;
    isError?: boolean;
    /** 归属 assistant 消息 id（P1-5：parentMessageId/parentUuid 回退） */
    messageId?: string;
  };
  /** 工具调用未完成终态（B-2，2026-08-23） */
  "tool/canceled": {
    callSeq: number;
    toolCallId: string;
    reason?: string;
    messageId?: string;
  };
  "context/compaction": {
    phase: "start" | "compacting" | "done" | "failed";
    beforeTokens?: number;
    afterTokens?: number;
    message?: string;
  };
  "context/summary": { summary: string; compactedSeqs: number[] };
  "session/summary": {
    content: string;
    keywords?: string[];
    summaryMessageId?: string;
    compactedRange?: { startSeq: number; endSeq: number };
    sourceEventSeqs?: number[];
  };
  "system/error": {
    module: string;
    action: string;
    error: string;
    errorCode?: string;
    stack?: string;
  };
  "system/warning": { module: string; message: string };
  "system/info": { module: string; message: string };
  "metric/timing": {
    /** 首块（字节）延迟 ms（= TTFB，含准备阶段）—— 详见后端 `app/src/chat/types/events.ts` 同字段说明 */
    ttfb?: number;
    /** 首个内容 token 延迟 ms（含准备与解析开销；纯 tool_call 响应缺省不写）—— 详见后端同字段说明 */
    ttft?: number;
    tokens?: number;
    duration?: number;
    /** 阶段：`request` = 请求级用量；`assistant` = 回合级耗时 */
    stage?: string;
    // TR-12-A（2026-09-22）：请求级用量分桶（与 app 侧同一契约，见
    // `app/src/chat/types/events.ts` 的 `metric/timing`）
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    /**
     * P2-2（2026-09-23）：所属请求标识（= 同请求 `request/start` 的 seq）。
     * **可选**：旧事件 / 拿不到 requestId 的写入路径缺省 ⇒ 读端如实视为"无可配对区间"。
     */
    requestId?: number;
  };
  /**
   * TR-12-B（2026-09-22）：模型输入快照 —— 与 app 侧同一契约
   * （见 `app/src/chat/types/events.ts` 的 `context/model-input`）。
   *
   * 引用式去重：未变化的单元只写 `refSeq`/`toolsRefSeq` 指向同会话内**含全量**的更早事件；
   * 读端一跳即可还原（见 `stores/chat/resolveModelInputSnapshot.ts`）。
   */
  "context/model-input": {
    tools?: { hash: string; count: number; schemas?: unknown[] };
    toolsRefSeq?: number;
    sections?: Array<{
      name: string;
      hash: string;
      content?: string;
      refSeq?: number;
    }>;
    mode?: string;
    /** 本轮模型名（T-②04，2026-10-02）——与后端 `context/model-input` 载荷同契约 */
    model?: string;
    /** 该模型经由的路由键（`ModelRouter.resolve` 的 taskType） */
    route?: string;
    tokens?: { stable: number; dynamic: number };
  };
  "channel/connect": { channelType: string; channelId: string };
  "channel/disconnect": {
    channelType: string;
    channelId: string;
    reason?: string;
  };
  "channel/message": { channelType: string; raw: unknown };
  "session/start": { startedAt: number; modelId?: string };
  "session/end": { endedAt: number; reason?: string };
  /**
   * T-⑥12（2026-10-03）：自唤醒续跑审计（log-only 不入消息 surface）。
   * 载荷形状镜像后端 `app/src/session/types/eventPayloads.ts` 的 `session/wake`。
   */
  "session/wake": {
    wakeId: string;
    kind: "timer" | "completion" | "event";
    taskId?: string;
    outcome: "resumed" | "resume_failed" | "handler_absent";
    error?: string;
  };
  // T-②06（2026-10-03）：经验自动演化落盘审计（log-only，不入消息 surface；镜像 app 侧同名字段）
  "evolution/applied": {
    scope: "prompt" | "skill";
    target?: string;
    sampleCount: number;
    bytes: number;
  };
  /** 会话标题快照（D5，2026-08-24，log-only 不入消息 surface） */
  "session/title": {
    title: string;
    source: "preliminary" | "final" | "manual";
  };
  /**
   * 请求开始（P2-2，2026-09-23）—— 与 app 侧同一契约
   * （见 `app/src/chat/types/events.ts` 的 `request/start`）。
   *
   * **配对键就是本事件的 `seq`**（= `requestId`）⇒ 载荷内不带 requestId。
   */
  "request/start": {
    /** 所属回合（请求发出时 turn 尚未分配则缺省） */
    turn?: number;
    model?: string;
    /** 请求来源：普通对话请求 / compaction 摘要请求（共用同一编号序列） */
    reason?: "chat" | "compaction";
  };
  // ─── 富块事件载荷（M4-1-a 扩展） ───
  "assistant/status": {
    content: string;
    statusType?: "compaction" | "watermark" | "reconnect" | "error" | string;
    /** L2/L3（2026-10-05 P1-18）：补 `"error"`，与后端 `assistant/status.phase` 取值域对齐 */
    phase?: "compacting" | "done" | "error";
    /** 工具状态块关联的 toolCallId（P1-6：按 toolCallId 去重，替代内容正则） */
    toolCallId?: string;
    /** 结构化水位数据（statusType='watermark' 时存在，P1-3：替代内容正则解析） */
    watermark?: { pct: number; severity: "warn" | "compact" };
  };
  "assistant/progress": {
    phase:
      "analyzing" | "designing" | "implementing" | "verifying" | "presenting";
    progress: number;
    description: string;
    steps: Array<{
      name: string;
      status: "pending" | "in_progress" | "done" | "failed";
    }>;
    totalSteps?: number;
    truncated?: boolean;
    currentStep: string;
  };
  "assistant/question": {
    questionId: string;
    question: string;
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  };
  "assistant/todo": {
    action: "write" | "update";
    taskCard?: {
      title: string;
      status: "planning" | "executing" | "done";
      tasks: Array<{
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
      }>;
      planId?: string;
    };
    taskId?: string;
    updates?: {
      status?:
        | "pending"
        | "in_progress"
        | "completed"
        | "failed"
        | "cancelled"
        | "blocked"
        | "skipped";
      result?: string;
      durationMs?: number;
    };
  };
  "assistant/doc_workflow": {
    title: string;
    format: "docx" | "pptx" | "html" | "pdf";
    currentStage: "outline" | "filling" | "compose";
    stages: Record<
      "outline" | "filling" | "compose",
      {
        status:
          | "pending"
          | "in_progress"
          | "awaiting_confirm"
          | "completed"
          | "failed";
        progress?: number;
        description?: string;
        nodes?: Array<{
          id: string;
          title: string;
          status: "pending" | "in_progress" | "completed" | "failed";
          hasImage?: boolean;
        }>;
      }
    >;
    outputFilePath?: string;
    error?: string;
  };
  "assistant/pdca_workflow": {
    decision: "pdl" | "stage-chain" | "research";
    stage?: "plan" | "execute" | "review" | "decide";
    status?: "started" | "running" | "completed" | "failed";
    message: string;
    projectId?: string;
    reasons?: string[];
  };
  // ─── 工作流 run 记录（P0-1 接入点第二刀 ②b，2026-09-24；后端镜像） ───
  // 后端唯一权威：`app/src/chat/types/eventPayloads.ts`。两侧形状必须一致。
  "assistant/workflow_run_start": {
    runId: string;
    workflow: string;
    providerId: string;
    steps: string[];
    startedAt: number;
  };
  "assistant/workflow_run_end": {
    runId: string;
    workflow: string;
    providerId: string;
    stopReason: "completed" | "cancelled" | "error";
    completedSteps: string[];
    failedStep?: string;
    error?: string;
    durationMs: number;
    rootCauseCandidates?: Array<{
      nodeId: string;
      score: number;
      distance: number;
      pathEvidenceRefs: string[];
    }>;
  };
  "assistant/workflow_step_start": {
    runId: string;
    stepId: string;
    tool: string;
    description: string;
    startedAt: number;
  };
  "assistant/workflow_step_end": {
    runId: string;
    stepId: string;
    tool: string;
    description: string;
    outcome: "completed" | "failed" | "cancelled";
    durationMs: number;
    synthesized?: boolean;
    error?: string;
  };
  "assistant/truncation": {
    reason: "length";
    suffix: string;
  };
  "assistant/deliverable": {
    files: Array<{
      path: string;
      change: "added" | "modified" | "deleted";
      status: "pending" | "verified" | "failed";
    }>;
    summary: string;
    checks?: Array<{ name: string; passed: boolean; detail?: string }>;
    actions?: Array<{
      label: string;
      action: "accept" | "reject" | "retry";
      file?: string;
    }>;
  };
  "assistant/diff": {
    file: string;
    diff: string;
    language?: string;
    stats?: { additions: number; deletions: number };
  };
  // CM-5（2026-08-25）：Code Mode 执行事件
  "assistant/code_run": {
    code: string;
    round: number;
    status:
      | "completed"
      | "failed"
      | "compiled-error"
      | "security-rejected"
      | "timeout"
      | "canceled";
    output?: unknown;
    error?: string;
    structuredError?: { type: string; message: string; stack?: string };
    toolCalls?: Array<{
      name: string;
      argsHash: string;
      truncatedResult?: string;
      ok: boolean;
    }>;
    logs?: string[];
    durationMs?: number;
  };
  // ─── 目标（Goal）生命周期 + 子代理恢复（B2-2 / B4-1；D-1 补镜像 2026-09-28） ───
  "goal/created": {
    goalId: string;
    objective: string;
    sessionId?: string;
    tokenBudget?: number;
  };
  "goal/updated": {
    goalId: string;
    /** 本次**真实变更**的字段（只列变更项，不做全量覆盖） */
    changes: {
      objective?: string;
      tokenBudget?: number;
      runId?: string;
    };
    reason: TaskGoalUpdateReason;
  };
  "goal/status_changed": {
    goalId: string;
    from: TaskGoalStatus;
    to: TaskGoalStatus;
    /** 迁移原因码 */
    reason: TaskGoalUpdateReason;
    /** 迁移**后**的累计用量（如实读库，不猜） */
    tokensUsed: number;
    tokenBudget?: number;
    noProgressStreak?: number;
  };
  "goal/injected": {
    goalId: string;
    templateKind: GoalTemplateKind;
    channel: "tool_result" | "user_message" | "steering";
    text: string;
  };
  // T-②02（2026-10-03）：目标偏差（turn 预算消耗速率越既有阈值；不改状态机）
  "goal/deviation": {
    goalId: string;
    /** 阶段标识（`goal_metrics.stage_id`） */
    stage: string;
    /** turn 预算 */
    expected: number;
    /** 实际消耗 turn */
    actual: number;
    /** actual / expected */
    ratio: number;
    severity: GoalDeviationSeverity;
  };
  "agent/recovery": {
    /** 动作：认领 / 恢复 / 放弃 */
    action: "claim" | "resume" | "abandon";
    /** 本次动作的结果（枚举，禁止按文案判定状态） */
    outcome: "claimed" | "resumed" | "abandoned" | "failed";
    /** 该 yield 所属 turn */
    turn?: number;
    /** 该轮 `sessions_yield` 的 toolCallId */
    toolCallId?: string;
    /** 是否来自回放投递 */
    restored?: boolean;
    /** 未达成的原因（`outcome` 为 `failed` / `abandoned` 时给出） */
    error?: string;
  };
  // P1-1②（2026-09-28）：输出校验回喂 —— 终稿未通过服务端结构预检（mermaid）时，
  // 注入模型的修正指令（log-only，不入消息 surface；镜像 app 侧同名字段，勿单端改）
  "validation/injected": {
    kind: "mermaid";
    issues: Array<{ blockIndex: number; line: number; reason: string }>;
    channel: "steering";
    text: string;
  };
  // P26-2 P4（2026-10-07）：输出护栏**改写审计**（log-only；镜像 app 侧同名字段，勿单端改）
  "validation/output_guard_applied": {
    action: "blocked" | "redacted";
    messageId: string;
    guards: string[];
    originalLength: number;
    originalSha256: string;
    /** 仅 `OUTPUT_GUARD_KEEP_ORIGINAL=true` 时存在（默认不落盘原文） */
    originalText?: string;
  };
}

// ─── 事件结构 ───────────────────────────────────

export interface LiriEvent<T extends LiriEventType = LiriEventType> {
  type: T;
  seq: number;
  time: number;
  sessionId: string;
  data: LiriEventMap[T];
  /** 事件 schema 版本（P1-5：v1 事件携带 messageId，参与消息聚合；v0 无） */
  schemaVersion?: 1;
  sourceEventSeqs?: number[];
  ignorable?: true;
}

// ─── 事件分类（用于面板过滤） ───────────────────

export type LiriEventCategory =
  "conversation" | "tool" | "context" | "system" | "channel" | "lifecycle";

export function categorizeEvent(type: LiriEventType): LiriEventCategory {
  if (type.startsWith("user/") || type.startsWith("assistant/")) {
    if (type === "assistant/tool_call") return "tool";
    return "conversation";
  }
  if (type === "tool/result" || type === "tool/canceled") return "tool";
  if (type.startsWith("context/")) return "context";
  if (type.startsWith("system/") || type.startsWith("metric/")) return "system";
  if (type.startsWith("channel/")) return "channel";
  return "lifecycle";
}

// ─── 类型守卫 ───────────────────────────────────

export function isLiriEvent(x: unknown): x is LiriEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.type === "string" &&
    typeof e.seq === "number" &&
    typeof e.time === "number" &&
    typeof e.sessionId === "string" &&
    typeof e.data === "object"
  );
}
