/**
 * streamMessageHelpers.ts — 流式编排的纯助手（探针判据 / 归因 / 载荷构造 / 关键词 / 定时）
 *
 * 由 `chat/orchestrator/streamMessageFlow.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §43）：**只搬不改**（含全部原注释）。
 * 依赖方向：本模块**零依赖宿主**；外部依赖**仅类型** —— `@modules/session` 的
 * `LiriEventMap` 与 `@modules/runtime` 的 `ChatStreamChunk`（P2-1d-4 起）、`TodoBlockData`
 * （P2-1f 起）⇒ 无运行时环。
 * **公开面**：3 个 `export` 助手由宿主 re-export 保持（3 个测试零改动）。
 */

import type { LiriEventMap } from '@modules/session/types/eventPayloads.js';
// P2-1d-4 / P2-1f：载荷与输入类型**取自既有契约**（R02：不复制数据形状）；仅类型依赖，无运行时环。
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type { TodoBlockData } from '@modules/runtime/api/todo-types';

/**
 * O2-4 探针判据（2026-09-24「会话暴露问题分析与优化方案」§五，纯函数，导出便于单测）。
 *
 * 返回 `true` 当且仅当：**流内下发的正文长度 > 落盘正文长度，且落盘正文是流内正文的一部分**。
 *
 * 语义：用户可见正文由流式 chunk 逐段下发（前端 append），而 `assistantMessage.content` 在
 * **每次 reason 轮被整体替换**（`ReActToolLoop`：`existingMsg.content = repairedContent`）。
 * 一轮内两者一致；但同一 assistant 消息内发生**多轮**（截断续接的回捞重试、超时后重试等）时，
 * 前端累积 = Σ 各轮文本、落盘 = 最后一轮文本 ⇒ 前端多出重复段落，且违反「所见即所存」。
 * 此时落盘正文必然"被包含"于流内正文中 —— 本判据即该特征。
 *
 * 实测证据：`chat-export-1790220958578.md`（首句重复 3 处、同一报告整段重复 2 处）。
 */
export function isStreamedContentSuperset(
  streamedContent: string,
  persistedContent: string
): boolean {
  if (!persistedContent) return false;
  if (streamedContent.length <= persistedContent.length) return false;
  return streamedContent.includes(persistedContent);
}

/**
 * O3-1 归因判定（2026-09-24「会话暴露问题分析与优化方案」§五，纯函数，导出便于单测）。
 *
 * 压缩失败事件的 `reason` 与文案**单一来源**：有 `failure` ⇒ 压缩异常（取其结构化原因码，
 * 不按文案判别，CS02）；无 ⇒ 压不动（Tier1/2/3 均无效果）。
 */
export function resolveCompactionFailureAttribution(
  failure: { reason: 'exception'; message: string } | undefined
): {
  reason: 'exception' | 'no_effect';
  failureMessage?: string;
  message: string;
} {
  if (failure) {
    return {
      reason: failure.reason,
      failureMessage: failure.message,
      message: `压缩异常（${failure.reason}）：${failure.message}——上下文将走截断兜底`,
    };
  }
  return {
    reason: 'no_effect',
    message:
      '压缩触发（trigger）但未降体积（Tier1/2/3 均无效果），上下文将走截断兜底',
  };
}

/**
 * `context/compaction`（`phase:'done'`）载荷构造 —— 纯函数，导出便于单测
 * （`.trae/specs/event-payload-undefined-rootfix.md`）。
 *
 * **为什么必须"条件展开"**：落盘前的 **D1 无损 JSON 校验**会**整条拒绝**含 `undefined` 值的
 * 载荷（`eventSanitize` → `EventLogStorage.append`）。此前 `summaryEnvelope` 无条件写入，
 * 而 Tier2 / 异步 Tier3 路径下该字段为 `undefined` ⇒ 事件被拒 ⇒
 * `compactionCommitted` 保持 `false`（**该次压缩不提交投影，压缩白做**，见实测日志
 * `2026-09-25T10:32:34Z`）。**校验无过错**（`undefined` 在 JSON 往返中不可无损表达）
 * ⇒ 修在**构造端**，不放宽校验（CS05）。
 */
export function buildCompactionDoneData(params: {
  compactedRange: { startSeq: number; endSeq: number };
  summary: string;
  /** 投影 summary 消息 id —— 可能不存在（`undefined`）⇒ 有值才写键 */
  summaryMessageId?: string;
  beforeTokens: number;
  afterTokens: number;
  /** 摘要调用信封 —— 仅 Tier3 摘要路径产出 ⇒ 有值才写键 */
  summaryEnvelope?: LiriEventMap['context/compaction']['summaryEnvelope'];
}): LiriEventMap['context/compaction'] {
  return {
    phase: 'done',
    compactedRange: params.compactedRange,
    summary: params.summary,
    ...(params.summaryMessageId !== undefined
      ? { summaryMessageId: params.summaryMessageId }
      : {}),
    beforeTokens: params.beforeTokens,
    afterTokens: params.afterTokens,
    ...(params.summaryEnvelope !== undefined
      ? { summaryEnvelope: params.summaryEnvelope }
      : {}),
  };
}

// R2（2026-09-06，走查 W2/W8）：思考过长被输出上限截断且无正文时的收敛重试指令。
// 以 user 消息注入下一轮请求（仅请求上下文，不回写会话消息），配合更小 maxTokens，
// 迫使模型收敛为简短结论/最必要的一次工具调用，而非再次以思考占满输出预算。
export const _DEGRADE_CONVERGE_HINT =
  '你的上一轮回复因思考过长被输出上限截断且未生成任何内容。请勿再长思考：' +
  '直接用 1-3 句给出简短结论，或只调用 1 个最必要的工具继续；不要展开内部推理。';

// ---------------------------------------------------------------------------
// P2-1d-2（S6 retry 段）：截断重试的**文案单一来源** + **续写消息构造**（纯函数）
//
// 动因（CS01 / CS02）：同一条提示此前在「落盘事件」与「前端 chunk」**各写一遍字面量**
// ⇒ 两处易漂移（事件溯源所见 ≠ 用户所见）。现收敛为**单一来源**。
// ---------------------------------------------------------------------------

/** 截断且**无正文** ⇒ 降级重试（收敛指令 + 更小预算）已发起的提示 */
export const TRUNCATION_DEGRADE_RETRY_NOTICE =
  '模型思考过长被输出上限截断，未生成正文。正在以收敛指令 + 更小输出预算重试 1 次...';

/** 截断且**无正文**、降级重试一轮后仍无产出 ⇒ 结束本轮的终态提示 */
export const TRUNCATION_NO_CONTENT_FINAL_NOTICE =
  '模型思考过长被输出上限截断，未生成正文。建议增大 maxTokens、减小上下文，或更换输出能力更强的模型后重试。';

/** 截断**续写**指令（user 消息；仅请求上下文，不回写会话消息） */
export const TRUNCATION_CONTINUE_INSTRUCTION =
  '输出已截断。请从中断处继续刚才的回答，不要重复已生成的内容。';

/**
 * 截断且**有正文** ⇒ 以更大 token 限制**续写**的提示（事件与 chunk **共用同一来源**）。
 *
 * ⚠️ 命名避让（CS01/R01-003）：不得含 `*Retry*` 标识符片段 —— `lint:arch` 的 R01-003
 * 以 `(function|const|async)\s+\w*[Rr]etry\w*\s*[=(<]` 判"自建重试逻辑"，只取文案/插值
 * 的纯构造函数会被**误报**（本函数不重试、不循环，仅拼字符串）。
 */
export function truncationLargerBudgetNotice(state: {
  retryCount: number;
  nextMaxTokens: number;
}): string {
  return `输出截断，正在以更大 token 限制重试（第 ${state.retryCount} 次，maxTokens=${state.nextMaxTokens}）...`;
}

/**
 * 截断重试（**有正文**）→ 追加「续写」消息对（**纯函数**：不改原数组）。
 *
 * P0-2（2026-08-26）：改为「续写」而非「从头重发」——把已生成内容作为 assistant 上下文
 * 追加，指示模型从中断处继续，不重复已生成内容（原置空曾致前端已显示内容"闪断重来"）。
 * ⚠️ 调用方须先判 `accumulatedContent.length > 0`（本函数不做该守卫，保持纯构造语义）。
 */
export function buildTruncationContinueMessages(
  apiMessages: ReadonlyArray<Record<string, unknown>>,
  accumulatedContent: string
): Array<Record<string, unknown>> {
  return [
    ...apiMessages,
    { role: 'assistant', content: accumulatedContent },
    { role: 'user', content: TRUNCATION_CONTINUE_INSTRUCTION },
  ];
}

/**
 * 定时等待（保活心跳轮询用）。
 * 2026-08-19 Fix A：准备阶段（API 消息构建/协作式估算）与模型首块等待（TTFB）期间，
 * 用 setTimeout 定时间隔轮询并发任务，每 10s 向 SSE 发射一次 status 心跳，
 * 防止大会话准备 + 思考模型 TTFB 超过前端 60s 空闲超时被误判为"流式响应超时"。
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * P2-1f（S3 工具轮函数化）：`assistant/todo` 事件的 `data` 载荷构造（**纯函数**）。
 *
 * **动因（CS01 去重）**：同一段「`todoData` → 事件 `taskCard`」映射此前在 `runStreamMessage`
 * 内**写了两遍**（工具轮消费点 + 收尾 flush 补偿点）⇒ 任一处改动都可能漏改另一处（口径漂移）。
 *
 * **口径**：`planId` / `result` / `durationMs` **有值才写键** —— `undefined` 键会被落盘前的
 * **D1 无损 JSON 校验整条拒绝**（与 `buildCompactionDoneData` 同类约束）。
 * 类型取自既有契约（输入 `TodoBlockData`，输出 `LiriEventMap['assistant/todo']`）。
 */
export function buildTodoEventData(
  todoData: TodoBlockData
): LiriEventMap['assistant/todo'] {
  return {
    action: 'write',
    taskCard: {
      title: todoData.title,
      status: todoData.phase,
      ...(todoData.planId ? { planId: todoData.planId } : {}),
      tasks: todoData.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        dependsOn: t.dependsOn,
        ...(t.result !== undefined ? { result: t.result } : {}),
        ...(t.durationMs !== undefined ? { durationMs: t.durationMs } : {}),
      })),
    },
  };
}

/**
 * P2-1d-4（S6 degradation 段函数化）：上下文降级**水位载荷**构造（**纯函数**）。
 *
 * 语义（与拆分前**逐字等价**）：
 * - `ratio = contextLimit / originalLimit`；
 * - `severity`：`ratio ≤ 0.5` ⇒ `'compact'`，否则 `'warn'`；
 * - `currentTokens` 固定 `0` —— 降级重发**之前**尚未统计新窗口用量（如实为 0，不猜）。
 *
 * 类型取自既有契约（`ChatStreamChunk['watermarkState']`，R02：不复制数据形状）。
 */
export function buildDegradationWatermark(
  contextLimit: number,
  originalLimit: number
): NonNullable<ChatStreamChunk['watermarkState']> {
  const ratio = contextLimit / originalLimit;
  return {
    currentTokens: 0,
    contextLimit,
    ratio,
    severity: ratio <= 0.5 ? 'compact' : 'warn',
  };
}

/** 压缩折叠派生结果（纯数据；`context/compaction` 与 `session/summary` 事件共用） */
export interface CompactionFold {
  /** 被折叠掉的源消息事件 seq（保持压缩前顺序） */
  compressedSeqs: number[];
  /** 被折叠区间的 seq 边界 */
  compactedRange: { startSeq: number; endSeq: number };
  /** 压缩产物摘要正文 */
  summary: string;
  /** 压缩产物（投影 summary 消息）id —— 可能不存在 */
  summaryMessageId?: string;
}

/**
 * P2-1d（S6 压缩段函数化）：从「压缩前/后消息列表」派生**折叠区间 + 摘要**（**纯函数**）。
 *
 * 判据（与事件语义同源，CS02：结构化字段，非文案判别）：
 * - `compressedSeqs` = 压缩前**有** `lastEventSeq`、而压缩后**不再出现**的那些 seq
 *   （即被 `replace` 掉的源消息）；
 * - 摘要消息 = 压缩后**无 `lastEventSeq`** 的新消息（压缩产物）；
 * - **无被折叠区间 ⇒ `null`**（调用方据此跳过事件写入，不造空事件 —— CS04）。
 *
 * ⚠️ **行为等价（拆分红线）**：本函数是原 `runStreamMessage` 内联派生逻辑的**逐字搬迁**，
 * 不改变任何判据、字段或取值。
 */
export function deriveCompactionFold(
  beforeMessages: readonly unknown[],
  afterMessages: readonly {
    content?: string;
    lastEventSeq?: number;
    id?: string;
  }[]
): CompactionFold | null {
  const beforeSeqs = beforeMessages
    .map((m) => (m as { lastEventSeq?: number }).lastEventSeq)
    .filter((n): n is number => typeof n === 'number');
  const afterSeqs = new Set(
    afterMessages
      .map((m) => m.lastEventSeq)
      .filter((n): n is number => typeof n === 'number')
  );
  const compressedSeqs = beforeSeqs.filter((s) => !afterSeqs.has(s));
  if (compressedSeqs.length === 0) return null;

  // summary 消息 = after 中无 lastEventSeq 的新消息（压缩产物）
  const summaryMsg = afterMessages.find((m) => m.lastEventSeq === undefined);
  return {
    compressedSeqs,
    compactedRange: {
      startSeq: Math.min(...compressedSeqs),
      endSeq: Math.max(...compressedSeqs),
    },
    summary: typeof summaryMsg?.content === 'string' ? summaryMsg.content : '',
    ...(summaryMsg?.id !== undefined
      ? { summaryMessageId: summaryMsg.id }
      : {}),
  };
}

/**
 * P2-1m（请求级延迟载荷函数化）：`metric/timing`（`stage:'request'`）载荷构造（**纯函数**）。
 *
 * 语义（与拆分前**逐字等价**）：
 * - `ttfb` = 端到端**首块（字节）**延迟（调用方已判 `firstChunkElapsedMs !== null`）；
 * - `ttft` = 端到端**首个内容 chunk** 延迟 —— 仅在拿到内容 chunk 时刻时写入；**纯 tool_call
 *   响应可能无内容 chunk** ⇒ **不写**（核心口径：**不拿 TTFB 冒充 TTFT**）；
 * - `requestId` = 同请求 `request/start` 的 seq —— 拿不到（start 落盘失败）⇒ **不写**
 *   （读端如实视为「无可配对区间」，**不硬凑**）。
 *
 * 类型取自既有契约（`LiriEventMap['metric/timing']`，R02：不复制数据形状）。
 */
export function buildRequestTimingPayload(params: {
  /** 端到端首块（字节）延迟 ms（调用方已保证在 `firstChunkElapsedMs !== null` 分支内） */
  ttfbMs: number;
  /** 首个**内容 chunk**时刻（绝对 ms）；`null` ⇒ 不写 `ttft` */
  ttftAt: number | null;
  /** 请求起点（绝对 ms）——`ttftAt - requestStartAt` 即 TTFT */
  requestStartAt: number;
  /** 同请求 `request/start` 的 seq；`undefined` ⇒ 不写 */
  requestId: number | undefined;
}): LiriEventMap['metric/timing'] {
  const payload: LiriEventMap['metric/timing'] = {
    stage: 'request',
    ttfb: params.ttfbMs,
  };
  if (params.ttftAt !== null) {
    payload.ttft = params.ttftAt - params.requestStartAt;
  }
  if (params.requestId !== undefined) {
    payload.requestId = params.requestId;
  }
  return payload;
}

/**
 * 「发送前历史污染清洗」结果（纯数据）
 */
export interface HistorySanitizeResult {
  /** 清洗后的消息列表（保留的条目为**浅拷贝**；输入数组与输入条目均未被改写） */
  messages: Array<Record<string, unknown>>;
  /** 规则 a：被丢弃的空 assistant 条数 */
  droppedEmpty: number;
  /** 规则 b：被合并的连续纯文本 assistant 次数 */
  mergedRuns: number;
}

/**
 * P2-1g（S1 请求准备函数化）：**发送前历史污染清洗**（**纯函数**）。
 *
 * 【原文保留 · 2026-08-20 QQ 空响应事故防御】
 * 根因：旧版 `persistMessages` 全量重写 bug（P0-2 修复前）在渠道会话落盘了**同毫秒批量
 * assistant 副本**；DeepSeek 收到「连续多条 assistant（无 user 间隔）/空 assistant」会直接
 * 返回**空响应**（`chunkCount=0, finishReason=stop`），用户侧表现为长时间沉默。
 *
 * 清洗规则（与拆分前**逐字等价**）：
 *   a) 丢弃空 assistant（`content` 空/`null` 且无 `tool_calls`）；
 *   b) 合并连续纯文本 assistant（换行拼接；**带 `tool_calls` 的不合并** —— 其后必须紧跟
 *      tool 结果，合并会破坏调用序列）。
 *
 * **纯度**：输入数组与其中消息对象**均不被改写**（保留条目推送的是 `{...msg}` 浅拷贝，
 * 合并只改拷贝）。**无污染时 `messages` 与输入等长** ⇒ 调用方据此跳过写回（保持数组同一性，
 * 不改动 `apiMessages` 引用）。
 */
export function sanitizeHistoryPollution(
  apiMessages: ReadonlyArray<Record<string, unknown>>
): HistorySanitizeResult {
  let droppedEmpty = 0;
  let mergedRuns = 0;
  const sanitized: Array<Record<string, unknown>> = [];
  for (const msg of apiMessages) {
    const role = msg.role as string;
    const content = msg.content;
    const hasToolCalls =
      Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    // 规则 a：空 assistant 丢弃
    if (
      role === 'assistant' &&
      !hasToolCalls &&
      (content === null ||
        content === undefined ||
        (typeof content === 'string' && content.trim() === ''))
    ) {
      droppedEmpty++;
      continue;
    }
    const prev = sanitized[sanitized.length - 1];
    // 规则 b：连续纯文本 assistant 合并
    if (
      role === 'assistant' &&
      !hasToolCalls &&
      typeof content === 'string' &&
      prev &&
      prev.role === 'assistant' &&
      !Array.isArray(prev.tool_calls)
    ) {
      prev.content = `${prev.content}\n${content}`;
      mergedRuns++;
      continue;
    }
    sanitized.push({ ...msg });
  }
  return { messages: sanitized, droppedEmpty, mergedRuns };
}

/**
 * D-1（2026-09-02，v4 §8）：轻量关键词提取——CJK 词/英文词按频次取 top N，
 * 剔除常见虚词/停止词，供 session/summary 事件检索（索引读取视图）使用。
 * 纯启发式（非语义），失败/空文本返回空数组，不影响事件写入（CS03）。
 */
export function extractSummaryKeywords(text: string, top = 8): string[] {
  if (!text) return [];
  const STOP = new Set([
    '的',
    '了',
    '和',
    '是',
    '在',
    '中',
    '有',
    '为',
    '与',
    '及',
    '对',
    '将',
    '等',
    '从',
    '到',
    '也',
    '就',
    '你',
    '我',
    '他',
    '她',
    '它',
    '一个',
    '我们',
    '进行',
    '以及',
    '或者',
    '如果',
    '因为',
    '所以',
    '但是',
    '然后',
    '已经',
    '可以',
    '需要',
    '通过',
    '相关',
    '这个',
    '这些',
    '那些',
    '一个',
    '没有',
    '主要',
    '同时',
    '目前',
    '用户',
    '根据',
    '关于',
  ]);
  try {
    const freq = new Map<string, number>();
    for (const m of text.matchAll(
      /[\u4e00-\u9fa5]{2,8}|[A-Za-z][A-Za-z0-9_\-]{2,}/g
    )) {
      const w = m[0];
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([w]) => w);
  } catch {
    return [];
  }
}
