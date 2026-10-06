/**
 * streamMessageHelpers.ts — 流式编排的纯助手（探针判据 / 归因 / 载荷构造 / 关键词 / 定时）
 *
 * 由 `chat/orchestrator/streamMessageFlow.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §43）：**只搬不改**（含全部原注释）。
 * 依赖方向：本模块**零依赖宿主**（仅 `@modules/session` 的 `LiriEventMap` **类型**）
 * ⇒ 无循环。**公开面**：3 个 `export` 助手由宿主 re-export 保持（3 个测试零改动）。
 */

import type { LiriEventMap } from '@modules/session/types/eventPayloads.js';

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
