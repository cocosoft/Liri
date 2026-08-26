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
 * EventMessageDeriver — 后端统一派生器（事件溯源单一化 Phase 2 P2-1）
 *
 * 从 events（带 messageId，v1）聚合消息为基线，再按投影（messages.jsonl 的
 * lastEventSeq 版本戳）做覆盖——对应方案 §5.1「events 聚合为基线 + 投影做版本覆盖」。
 *
 * 目标结构：与 CoreAPIImpl.getSessionMessages 现有返回兼容
 *   { id, role, content, timestamp, startedAt, finishReason, tool_calls, toolCallId, blocks, metadata }
 * 使前端 loadConversation 可消费后端派生结果（评审 G7），前后端数出同源。
 */

import type { LiriEvent, LiriEventType } from '../../chat/types/events.js';
import { getLogger } from '@modules/monitoring';
import { KNOWN_SESSION_EVENT_TYPES } from '../../chat/types/knownEventTypes.js';

const logger = getLogger('session:event-deriver');

/** 与 getSessionMessages 返回兼容的派生消息 */
export interface DerivedMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  startedAt?: number;
  finishReason?: string;
  tool_calls?: Array<Record<string, unknown>>;
  toolCallId?: string;
  blocks?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  lastEventSeq?: number;
}

/** 事件聚合中间态 */
interface Aggregated {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  firstSeq: number;
  maxChunkSeq: number;
  /** 消息所属 turn 号（2026-08-24：派生消息补 finishReason 用） */
  turnNo: number;
  blocks: Array<Record<string, unknown>>;
  tool_calls: Array<Record<string, unknown>>;
}

function makeBlock(
  seq: number,
  type: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const block: Record<string, unknown> = {
    id: `blk_${seq}`,
    type,
    content: (data.content as string) ?? '',
    ...(data.toolCallId ? { toolCallId: data.toolCallId as string } : {}),
    ...(data.name ? { toolName: data.name as string } : {}),
    ...(data.args !== undefined ? { args: data.args } : {}),
  };
  // D-REPAIR（2026-08-24）：事件派生 tool_call 块补全 toolCall 对象（与投影块结构对齐）。
  // 此前仅存 toolName/args，前端 ToolInlineTags/ToolCallGroup 读 block.toolCall.name
  // 显示工具名 → 事件聚合路径（投影滞后 / fork 子会话等）下工具标签退化为
  // 仅显示状态图标（"✓ ▼"）甚至被过滤（hasMeaningfulContentBlocks 要求 toolCall）。
  if (type === 'tool_call' && (data.toolCallId || data.name)) {
    block.toolCall = {
      id: (data.toolCallId as string) ?? '',
      name: (data.name as string) ?? '',
      arguments: (data.args as Record<string, unknown>) ?? {},
    };
  }
  return block;
}

/**
 * 投影兜底消息的排序键降级（2026-08-24 根因修复）
 *
 * 背景：消息事件缺失（未落盘/损坏行被跳过/存量旧数据）时，消息只能靠 legacy
 * 投影兜底。若投影无 lastEventSeq，此前硬编码 0 排最前，导致"新消息显示在
 * 会话最顶部"（实际时间戳晚于绝大多数消息）。
 *
 * 降级策略：lastEventSeq 缺失时，若消息带有效 timestamp，则按 timestamp 在
 * 事件流时间轴中二分定位"最后一个 time <= ts 的事件 seq"作为近似排序键，
 * 使消息归位到其真实发生时刻附近；无有效时间戳时回退 0。
 *
 * 近似性说明：事件按 seq 升序读入、time 近似升序；异常时间戳导致定位偏差时，
 * 排序函数（主键 lastEventSeq，次键 timestamp，三级 id）仍能稳定兜底。
 */
function resolveFallbackSeq(proj: DerivedMessage, events: LiriEvent[]): number {
  if (typeof proj.lastEventSeq === 'number') return proj.lastEventSeq;
  const ts = typeof proj.timestamp === 'number' ? proj.timestamp : 0;
  if (events.length === 0 || ts <= 0) return 0;
  let lo = 0;
  let hi = events.length - 1;
  let anchor = events[0].seq;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time <= ts) {
      anchor = events[mid].seq;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return anchor;
}

/**
 * FIX(2026-08-23)：合并相邻 text/thinking block（读时归一化）
 *
 * 历史投影/事件可能按流式 chunk 碎片化为每 token 一个 block（实测一条 7091 字符
 * 消息 → 12031 blocks），前端渲染巨量块组件导致会话页卡死且正文"每 token 一行"。
 * 对任意 blocks 数组做相邻同类型 text/thinking 合并（对齐前端 deriveConversationBlocks 语义）。
 */
function mergeAdjacentTextBlocks(
  blocks: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if ((b.type === 'text' || b.type === 'thinking') && last?.type === b.type) {
      last.content =
        ((last.content as string) ?? '') + ((b.content as string) ?? '');
    } else {
      merged.push({ ...b });
    }
  }
  return merged;
}

/** 压缩区间条目（A-3，2026-08-23） */
export interface CompactionRange {
  startSeq: number;
  endSeq: number;
  summary?: string;
  summaryMessageId?: string;
}

// ─── C-2 富块事件（2026-08-23，对齐前端 deriveConversationBlocks） ─────────

/** 富块事件类型（无 messageId，按事件流归属最近 assistant 消息） */
const RICH_BLOCK_TYPES = new Set<LiriEventType>([
  'assistant/status',
  'assistant/progress',
  'assistant/question',
  'assistant/todo',
  'assistant/doc_workflow',
  'assistant/truncation',
  'assistant/deliverable',
  'assistant/diff',
  // CM-5（2026-08-25）：Code Mode 执行块（无 messageId，归属最近 assistant）
  'assistant/code_run',
]);

function isRichBlockEvent(type: LiriEventType): boolean {
  return RICH_BLOCK_TYPES.has(type);
}

// ─── D8 工具中断语义合成（2026-08-24，对齐 deepseek-harness repair.ts） ─────

/** 工具中断语义文案：已记录但无结果（崩溃/中断后结果未知） */
const TOOL_OUTCOME_UNKNOWN =
  '工具调用已发起但未记录结果，其结果未知。若需重试，请先确认工具执行是只读/幂等操作；若可能有副作用，请先验证外部状态或询问用户，不要盲目重试。';

/** 工具中断语义文案：未记录开始执行 */
const TOOL_NOT_STARTED = '工具调用在记录执行前被中断，如需仍可重试。';

/**
 * C-2：内部过渡状态过滤（前端基线 isInternalTransitionStatus 的镜像拷贝，
 * 保证"流式视图 = 回放视图"——status 心跳与 tool_call 块展示重复的过渡态不建块）。
 */
function isInternalTransitionStatus(
  content: string,
  statusType?: string
): boolean {
  // 结构化过滤（CS02）：瞬态/冗余状态类型（工具状态已由 tool_call 块展示）
  if (
    statusType === 'ai_thinking' ||
    statusType === 'tool_started' ||
    statusType === 'tool_completed'
  ) {
    return true;
  }
  // 字符串回退：兼容旧后端 statusType 缺失时的协议消息
  if (content.includes('🔧') && content.includes('Running tool')) return true;
  if (content.startsWith('✅ Tool') || content.startsWith('❌ Tool')) {
    return true;
  }
  const internalPatterns = [
    'AI is thinking',
    'AI is analyzing',
    'AI is preparing',
    'AI is waiting',
    '🔍 AI is analyzing the image',
    '🎨 AI is generating',
  ];
  return internalPatterns.some((p) => content.startsWith(p));
}

/**
 * C-2：把富块事件转换为 block 追加到目标消息的 blocks（对齐前端聚合器）：
 * - status：过滤 compaction（context/compaction 分支处理）+ 内部过渡态 + 连续重复去重
 * - progress：按 phase 去重更新（心跳不堆块）
 * - question / doc_workflow：直接 push
 * - todo：write 全量新建 + update 增量合并（对齐前端 write/update 规则）
 * - truncation：text 块 + content 累加
 */
function applyRichBlock(ev: LiriEvent, agg: Aggregated): void {
  const blocks = agg.blocks;
  const data = ev.data as Record<string, unknown>;
  switch (ev.type) {
    case 'assistant/status': {
      const content = (data.content as string) ?? '';
      const statusType = data.statusType as string | undefined;
      const phase = data.phase as 'compacting' | 'done' | undefined;
      // compaction 已由 context/compaction 分支处理，这里避免重复
      if (statusType === 'compaction') break;
      // 内部过渡状态 → 丢弃（与前端 isInternalTransitionStatus 一致）
      if (isInternalTransitionStatus(content, statusType)) break;
      // 连续重复 status 去重（对齐前端 addStatus：连续相同 content 跳过）
      const last = blocks[blocks.length - 1];
      if (last?.type === 'status' && last.content === content) break;
      blocks.push({
        id: `blk_${ev.seq}`,
        type: 'status',
        content,
        ...(statusType ? { status: statusType } : {}),
        ...(phase ? { phase } : {}),
        ...(data.toolCallId ? { toolCallId: data.toolCallId as string } : {}),
        ...(data.watermark ? { watermark: data.watermark } : {}),
      });
      break;
    }
    case 'assistant/progress': {
      const phase = data.phase as string;
      const progressData = {
        phase,
        progress: data.progress,
        description: data.description,
        steps: data.steps,
        ...(data.totalSteps !== undefined
          ? { totalSteps: data.totalSteps }
          : {}),
        ...(data.truncated !== undefined ? { truncated: data.truncated } : {}),
        currentStep: data.currentStep,
      };
      // 按 phase 去重：同一 phase 的心跳更新已有块（对齐前端 findIndex+replace）
      const idx = blocks.findIndex(
        (b) =>
          b.type === 'progress' &&
          (b.progressData as { phase?: string } | undefined)?.phase === phase
      );
      if (idx !== -1) {
        blocks[idx] = {
          ...blocks[idx],
          progressData,
          content: (data.description as string) ?? '',
        };
      } else {
        blocks.push({
          id: `blk_${ev.seq}`,
          type: 'progress',
          content: (data.description as string) ?? '',
          progressData,
        });
      }
      break;
    }
    case 'assistant/question': {
      blocks.push({
        id: `blk_${ev.seq}`,
        type: 'question',
        content: (data.question as string) ?? '',
        questionData: {
          questionId: data.questionId,
          question: data.question,
          header: data.header,
          options: data.options,
          ...(data.multiSelect !== undefined
            ? { multiSelect: data.multiSelect }
            : {}),
        },
      });
      break;
    }
    case 'assistant/todo': {
      const action = data.action as 'write' | 'update' | undefined;
      if (action === 'write' && data.taskCard) {
        const card = data.taskCard as Record<string, unknown>;
        blocks.push({
          id: `blk_${ev.seq}`,
          type: 'todo',
          content: (card.title as string) ?? '',
          taskCard: card,
        });
      } else if (action === 'update' && data.taskId) {
        // 增量更新：找最后一个 todo block，更新其 taskCard.tasks 中对应 task
        const todoBlock = [...blocks]
          .reverse()
          .find((b) => b.type === 'todo' && b.taskCard);
        if (todoBlock) {
          const card = todoBlock.taskCard as {
            tasks?: Array<Record<string, unknown>>;
          };
          const task = card.tasks?.find((t) => t.id === data.taskId);
          const updates = data.updates as
            | {
                status?: string;
                result?: string;
                durationMs?: number;
              }
            | undefined;
          if (task && updates) {
            if (updates.status) task.status = updates.status;
            if (updates.result !== undefined) task.result = updates.result;
            if (updates.durationMs !== undefined)
              task.durationMs = updates.durationMs;
          }
        }
      }
      break;
    }
    case 'assistant/doc_workflow': {
      blocks.push({
        id: `blk_${ev.seq}`,
        type: 'doc_workflow',
        content: (data.title as string) ?? '',
        docWorkflowData: data,
      });
      break;
    }
    case 'assistant/truncation': {
      const suffix = (data.suffix as string) ?? '';
      blocks.push({
        id: `blk_${ev.seq}`,
        type: 'text',
        content: suffix,
      });
      agg.content = (agg.content ?? '') + suffix;
      break;
    }
    case 'assistant/deliverable': {
      blocks.push({
        id: `blk_${ev.seq}`,
        type: 'deliverable',
        content: (data.summary as string) ?? '',
        deliverableData: data,
      });
      break;
    }
    case 'assistant/diff': {
      blocks.push({
        id: `blk_${ev.seq}`,
        type: 'diff',
        content: (data.diff as string) ?? '',
        diffData: data,
      });
      break;
    }
    // CM-5（2026-08-25）：Code Mode 执行块（对齐前端 deriveConversationBlocks code_run 分支）
    case 'assistant/code_run': {
      blocks.push({
        id: `blk_${ev.seq}`,
        type: 'code_run',
        content: (data.code as string) ?? 'Code Run',
        codeRunData: data,
      });
      break;
    }
    default:
      break;
  }
}

/**
 * A-3（2026-08-23）：压缩区间合并（连续覆盖，评审 v0.4#2）。
 * 最新（靠后）区间优先，summary/summaryMessageId 取后到区间。
 *
 * 归一化（CS01）：写路径 streamMessageFlow 与读路径本文件共用此实现，
 * 禁止两处重复维护合并逻辑。
 */
export function mergeCompactionRanges(
  ranges: CompactionRange[]
): CompactionRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.startSeq - b.startSeq);
  const merged: CompactionRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.startSeq <= last.endSeq + 1) {
      last.endSeq = Math.max(last.endSeq, r.endSeq);
      if (r.summary !== undefined) last.summary = r.summary;
      if (r.summaryMessageId !== undefined)
        last.summaryMessageId = r.summaryMessageId;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * 从事件流聚合 + 投影覆盖派生消息。
 *
 * @param events 全量事件（v1 事件带 messageId）
 * @param projections 投影消息（messages.jsonl，含 lastEventSeq）
 * @param opts.compactionRanges 会话 metadata.trajectoryCompactions（压缩区间表，优先于事件）
 * @returns 派生消息（按首事件 seq 升序；纯投影消息按 lastEventSeq 插入；压缩 summary 按区间 endSeq 插入）
 */
export function deriveMessagesFromEvents(
  events: LiriEvent[],
  projections: DerivedMessage[],
  opts?: { compactionRanges?: CompactionRange[] }
): DerivedMessage[] {
  // A-3：压缩区间 = metadata（优先，修剪删压缩事件不丢）+ events 中 context/compaction 事件（补充）
  const eventRanges: CompactionRange[] = [];
  for (const ev of events) {
    if (ev.type === 'context/compaction') {
      const d = ev.data as {
        compactedRange?: { startSeq?: number; endSeq?: number };
        summary?: string;
        summaryMessageId?: string;
      };
      if (
        d.compactedRange &&
        typeof d.compactedRange.startSeq === 'number' &&
        typeof d.compactedRange.endSeq === 'number'
      ) {
        eventRanges.push({
          startSeq: d.compactedRange.startSeq,
          endSeq: d.compactedRange.endSeq,
          summary: d.summary,
          summaryMessageId: d.summaryMessageId,
        });
      }
    }
  }
  const ranges = mergeCompactionRanges([
    ...(opts?.compactionRanges ?? []),
    ...eventRanges,
  ]);
  const isCompactedSeq = (seq: number): boolean =>
    ranges.some((r) => seq >= r.startSeq && seq <= r.endSeq);

  const aggregated = new Map<string, Aggregated>();

  // ① 事件流聚合为基线（先读全 events，评审 A1'）
  // C-2：跟踪最近 assistant 消息 id——富块事件（无 messageId）按事件流归属
  //（对齐前端聚合器 state.current 语义）
  let lastAssistantMid: string | undefined;
  // D8（2026-08-24）：已进入终态的工具调用 id 集合（tool/result 或 tool/canceled），
  // 用于检测"孤儿 tool_call"（已发起但无终态）→ 派生时合成语义文案
  const terminalToolCallIds = new Set<string>();
  // 2026-08-24 中断提示链路（3.5）：跟踪每个 turn 的 finishReason，
  // 供该 turn 内消息派生补 finishReason（中断 turn 的消息在回放时显示中断提示）
  let currentTurnNo = 0;
  const finishReasonByTurn = new Map<number, string>();
  for (const ev of events) {
    // A-3：跳过被压缩区间内的事件（旧消息不回放）
    if (isCompactedSeq(ev.seq)) continue;
    // D8：终态工具收集——无论事件是否参与消息聚合（tool/result 不单独成消息）
    if (ev.type === 'tool/result') {
      const d = ev.data as { toolCallId?: string };
      if (d.toolCallId) terminalToolCallIds.add(d.toolCallId);
      continue;
    }
    if (ev.type === 'tool/canceled') {
      const d = ev.data as { toolCallId?: string };
      if (d.toolCallId) terminalToolCallIds.add(d.toolCallId);
      continue;
    }
    // D2（2026-08-24）：未知事件类型告警——正常读取路径已由 EventLogStorage.read
    // 过滤（assertEventReadable），此处防御直调 deriveMessagesFromEvents 的场景
    if (!KNOWN_SESSION_EVENT_TYPES.has(ev.type) && ev.ignorable !== true) {
      logger.warn('event-deriver: 遇到未知事件类型', {
        eventSeq: ev.seq,
        eventType: ev.type,
      });
    }
    const data = ev.data as Record<string, unknown>;

    // 2026-08-24 中断提示链路（3.5）：turn 边界跟踪（turn/start 更新当前 turn，
    // turn/end 记录该 turn 的 finishReason，供后续消息派生使用）
    if (ev.type === 'turn/start') {
      currentTurnNo = typeof data.turn === 'number' ? data.turn : currentTurnNo;
      continue;
    }
    if (ev.type === 'turn/end') {
      const fr = data.finishReason;
      // 2026-08-24 根因修复：
      // ① key 用事件自身的 data.turn（而非 currentTurnNo）——turn/end 配对可能
      //    因崩溃恢复合成的 closers 与 turn/start 错位，用 currentTurnNo 会记错 turn
      // ② 非 canceled 优先——崩溃恢复（interruptedTurnClosers）合成的 canceled
      //    turn/end 追加在文件后部，若后写覆盖会把真实 tool_use/stop 抹成 canceled，
      //    导致所有回复在前端显示"该回复已中断"
      const turnNo = typeof data.turn === 'number' ? data.turn : currentTurnNo;
      if (typeof fr === 'string' && fr) {
        const existing = finishReasonByTurn.get(turnNo);
        if (!existing || existing === 'canceled' || fr !== 'canceled') {
          finishReasonByTurn.set(turnNo, fr);
        }
      }
      continue;
    }

    const mid = typeof data.messageId === 'string' ? data.messageId : undefined;

    // C-2：富块事件（无 messageId）→ 归属最近 assistant 消息的 blocks
    if (!mid && isRichBlockEvent(ev.type)) {
      if (lastAssistantMid) {
        const agg = aggregated.get(lastAssistantMid);
        if (agg) applyRichBlock(ev, agg);
      }
      continue;
    }

    if (!mid) continue; // v0 事件（无 messageId）不参与聚合，由投影兜底

    let agg = aggregated.get(mid);
    if (!agg) {
      agg = {
        messageId: mid,
        role: 'assistant',
        content: '',
        timestamp: ev.time,
        firstSeq: ev.seq,
        maxChunkSeq: ev.seq,
        turnNo: currentTurnNo,
        blocks: [],
        tool_calls: [],
      };
      aggregated.set(mid, agg);
    }
    agg.maxChunkSeq = Math.max(agg.maxChunkSeq, ev.seq);

    if (ev.type === 'assistant/text') {
      agg.content += (data.content as string) ?? '';
      // FIX(2026-08-23)：text 是流式 delta，合并到最后一个相邻 text block（对齐前端
      // deriveConversationBlocks）。原先每个 chunk 新建 block → 一条消息碎片化为上千 blocks
      //（实测 contentLen=7091 → blockCount=12031），前端渲染巨量块组件导致会话页卡死。
      const lastText = agg.blocks[agg.blocks.length - 1];
      if (lastText?.type === 'text') {
        lastText.content =
          ((lastText.content as string) ?? '') + (data.content ?? '');
      } else {
        agg.blocks.push(makeBlock(ev.seq, 'text', data));
      }
      lastAssistantMid = mid;
    } else if (ev.type === 'assistant/thinking') {
      // FIX(2026-08-23)：thinking 同为流式 delta，合并到最后一个相邻 thinking block
      const lastThink = agg.blocks[agg.blocks.length - 1];
      if (lastThink?.type === 'thinking') {
        lastThink.content =
          ((lastThink.content as string) ?? '') + (data.content ?? '');
      } else {
        agg.blocks.push(makeBlock(ev.seq, 'thinking', data));
      }
      lastAssistantMid = mid;
    } else if (ev.type === 'assistant/tool_call') {
      agg.blocks.push(
        makeBlock(ev.seq, 'tool_call', {
          toolCallId: data.toolCallId as string,
          name: data.name as string,
          args: data.args,
          content: '',
        })
      );
      agg.tool_calls.push({
        id: data.toolCallId,
        type: 'function',
        function: {
          name: data.name,
          arguments: JSON.stringify(data.args ?? {}),
        },
      });
      lastAssistantMid = mid;
    } else if (ev.type === 'user/message') {
      agg.role = 'user';
      agg.content = (data.content as string) ?? '';
      // F4（2026-08-25）：透传 replyToId，刷新后回复引用（被回复标记/引用跳转）不丢失
      if (data.replyToId) {
        (agg as { replyToId?: string }).replyToId = data.replyToId as string;
      }
    }
    // tool/result：结果已含在 assistant 的 tool_call blocks（前端配对），此处不单独成消息
  }

  const result: DerivedMessage[] = [];
  const usedProjectionIds = new Set<string>();

  // D8（2026-08-24）：孤儿 tool_call 块（已发起但无终态）标记中断语义。
  // 仅处理工具块：无 toolCallId 或已进入终态（tool/result/tool/canceled）的保留原样。
  const markOrphanToolBlocks = (
    blocks: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> =>
    blocks.map((b) => {
      if (b.type !== 'tool_call' || !b.toolCallId) return b;
      if (terminalToolCallIds.has(b.toolCallId as string)) return b;
      return {
        ...b,
        status: 'interrupted',
        // 语义化指导文案（对齐 deepseek-harness repair.ts）——由前端按块渲染展示
        error: TOOL_OUTCOME_UNKNOWN,
      };
    });

  // ② 投影做版本覆盖（以消息为单位，评审 A1）
  for (const agg of aggregated.values()) {
    const proj = projections.find((p) => p.id === agg.messageId);
    // 2026-08-24 中断提示链路（3.5）：该消息所属 turn 若为中断结束
    //（finishReason=canceled/error），派生消息补充该 finishReason，
    // 使回放时中断 turn 内的消息能显示中断提示（不依赖投影是否带 finishReason）
    const turnFinish = finishReasonByTurn.get(agg.turnNo);
    // 2026-08-24 补充修复（代码根治，免清洗/删数据）：崩溃恢复合成的 canceled
    // turn/end 常与"turn 实际已完成但 turn/end 丢失/损坏"混淆（事件溯源早期
    // 工具型轮次 turn/end 未写入 + 半写损坏行，崩溃恢复每次读取都合成 canceled）。
    // 消息有完整正文时视为已完成——不补 canceled，否则打开历史记录时所有正常
    // 回复都显示"该回复已中断"。仅消息无正文（thinking-only / 空）时才视为
    // 真中断并补 canceled（此时没有可展示的正文，提示"生成中断"是准确的）。
    const hasFullContent =
      typeof agg.content === 'string' && agg.content.trim().length > 0;
    const interruptedTurnFinish =
      turnFinish === 'error'
        ? 'error'
        : turnFinish === 'canceled' && !hasFullContent
          ? 'canceled'
          : undefined;
    if (
      proj &&
      typeof proj.lastEventSeq === 'number' &&
      proj.lastEventSeq >= agg.maxChunkSeq
    ) {
      // 投影可信 → 用投影覆盖聚合结果（省去 chunk→content 拼接）
      usedProjectionIds.add(proj.id);
      result.push({
        ...proj,
        role: proj.role ?? agg.role,
        content: proj.content || agg.content,
        // 2026-08-24 根因修复：排序键以事件真实序（maxChunkSeq）为准，而非投影
        // lastEventSeq——投影版本戳可能错误指向后续事件（如损坏行/并发写入后
        // updateMessageBlocks 落盘的 seq 漂移），导致该消息被排到实际时序之后
        //（"AI 回复被混合进下一轮"）。内容用投影补齐，位置按事件序归位。
        lastEventSeq: agg.maxChunkSeq,
        // 2026-08-24 中断提示链路（3.5）：投影无 finishReason 时按所属 turn 补充
        finishReason: proj.finishReason ?? interruptedTurnFinish,
        // FIX(2026-08-23)：读时归一化——投影 blocks 可能按流式 chunk 碎片化
        //（每 token 一个 text block），合并相邻 text/thinking 防前端渲染卡死
        blocks: markOrphanToolBlocks(
          mergeAdjacentTextBlocks(proj.blocks ?? [])
        ),
      });
    } else {
      result.push({
        id: agg.messageId,
        role: agg.role,
        content: agg.content,
        timestamp: agg.timestamp,
        // B-2（2026-08-23）：统一排序键——事件聚合消息用最后 chunk seq
        lastEventSeq: agg.maxChunkSeq,
        // 2026-08-24 中断提示链路（3.5）：中断 turn 的消息补 finishReason
        finishReason: interruptedTurnFinish,
        blocks: markOrphanToolBlocks(agg.blocks),
        tool_calls: agg.tool_calls.length > 0 ? agg.tool_calls : undefined,
      });
    }
  }

  // ③ 纯投影消息（events 无该消息 chunk，存量缺失）→ 直接取投影（评审 A2'）
  for (const proj of projections) {
    if (!usedProjectionIds.has(proj.id) && !aggregated.has(proj.id)) {
      // B-2（2026-08-23）：投影兜底消息补排序键。
      // 2026-08-24 根因修复：lastEventSeq 缺失时不再硬排 0 置顶（导致"新消息
      // 显示在会话最前"），而是按消息 timestamp 在事件流时间轴中二分定位近似
      // seq，使消息归位到其真实发生时刻附近。
      result.push({
        ...proj,
        lastEventSeq: resolveFallbackSeq(proj, events),
        // FIX(2026-08-23)：同投影覆盖分支，读时归一化碎片化 blocks
        blocks: mergeAdjacentTextBlocks(proj.blocks ?? []),
      });
    }
  }

  // A-3：压缩 summary 消息合成（复用 summaryMessageId，id 与投影一致；跳过 lastEventSeq 比对由 T-D 负责）
  for (const r of ranges) {
    if (r.summary === undefined && r.summaryMessageId === undefined) continue;
    result.push({
      id: r.summaryMessageId ?? `compacted_${r.startSeq}_${r.endSeq}`,
      role: 'assistant',
      content: r.summary ?? '',
      timestamp: 0,
      lastEventSeq: r.endSeq, // 排序键：区间尾
      blocks: [
        {
          id: `blk_compacted_${r.startSeq}_${r.endSeq}`,
          type: 'text',
          content: r.summary ?? '',
          isStreaming: false,
        },
      ],
    });
  }

  // ④ 排序：统一按 lastEventSeq（B-2，2026-08-23）
  //  - 事件聚合消息 → maxChunkSeq（最后 chunk seq）
  //  - 投影覆盖消息 → proj.lastEventSeq（版本戳）
  //  - 压缩 summary → endSeq
  //  - 纯投影兜底消息 → proj.lastEventSeq ?? 0（存量旧数据排最前）
  // 统一量纲后不再混比 firstSeq/lastEventSeq，避免"兜底消息顽固乱序"（评审 v0.3#6）
  result.sort((a, b) => {
    const aSeq = typeof a.lastEventSeq === 'number' ? a.lastEventSeq : 0;
    const bSeq = typeof b.lastEventSeq === 'number' ? b.lastEventSeq : 0;
    if (aSeq !== bSeq) return aSeq - bSeq;
    // 同键（如无事件源消息）→ 按时间稳定兜底
    const ta = typeof a.timestamp === 'number' ? a.timestamp : 0;
    const tb = typeof b.timestamp === 'number' ? b.timestamp : 0;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return result;
}

// ─── D7 事件投影统计（2026-08-24，对齐 deepseek-harness session-stats） ─────

/**
 * 事件投影统计（D7，2026-08-24）
 *
 * 基于事件流单遍扫描派生会话统计，与回放数出同源：
 * 消息数/工具调用（含终态分类）/轮次/压缩次数——不依赖 LLMTracker 内存聚合
 * 或 DataSessionStats 列表聚合，跨重启一致、可重放。
 *
 * 统计口径与派生器一致：压缩区间内事件不计入消息数；tool/canceled 计入中断。
 */
export interface EventSessionStats {
  /** 消息数（user + assistant，不含压缩 summary/纯投影兜底） */
  messageCount: number;
  /** 用户消息数 */
  userMessageCount: number;
  /** 助手消息数 */
  assistantMessageCount: number;
  /** 工具调用发起数（assistant/tool_call） */
  toolCallCount: number;
  /** 工具结果数（tool/result） */
  toolResultCount: number;
  /** 工具取消数（tool/canceled） */
  toolCanceledCount: number;
  /** 工具调用无终态数（孤儿：已发起但无 result/canceled） */
  toolOrphanCount: number;
  /** 轮次（turn）数：turn/start 计数 */
  turnCount: number;
  /** 上下文压缩次数（context/compaction phase=done） */
  compactionCount: number;
  /** 被压缩源消息事件数（sourceEventSeqs 累计，D6） */
  compactedSourceEventCount: number;
  /** 事件总量（含压缩区间） */
  eventCount: number;
}

/** 从事件流投影会话统计（D7-1） */
export function deriveSessionStats(events: LiriEvent[]): EventSessionStats {
  const stats: EventSessionStats = {
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    toolCanceledCount: 0,
    toolOrphanCount: 0,
    turnCount: 0,
    compactionCount: 0,
    compactedSourceEventCount: 0,
    eventCount: events.length,
  };

  // 已进入终态的工具调用 id（tool/result 或 tool/canceled）→ 孤儿数反推
  const terminalToolCallIds = new Set<string>();
  const toolCallIds = new Set<string>();

  for (const ev of events) {
    switch (ev.type) {
      case 'user/message':
        stats.userMessageCount++;
        stats.messageCount++;
        break;
      case 'assistant/text':
      case 'assistant/thinking':
      case 'assistant/tool_call':
        if (ev.type === 'assistant/tool_call') {
          stats.toolCallCount++;
          const d = ev.data as { toolCallId?: string };
          if (d.toolCallId) toolCallIds.add(d.toolCallId);
        } else if (
          ev.type === 'assistant/text' ||
          ev.type === 'assistant/thinking'
        ) {
          // 消息计数按消息归属去重：聚合循环同消息多 chunk 只计一次。
          // 此处按事件计粗口径会在 D7-2 精化（消息去重由调用方二次聚合）。
          // 简单方案：text/thinking 首事件计一条，后续同 messageId 跳过。
        }
        break;
      case 'tool/result': {
        stats.toolResultCount++;
        const d = ev.data as { toolCallId?: string };
        if (d.toolCallId) terminalToolCallIds.add(d.toolCallId);
        break;
      }
      case 'tool/canceled': {
        stats.toolCanceledCount++;
        const d = ev.data as { toolCallId?: string };
        if (d.toolCallId) terminalToolCallIds.add(d.toolCallId);
        break;
      }
      case 'turn/start':
        stats.turnCount++;
        break;
      case 'context/compaction': {
        const d = ev.data as { phase?: string; sourceEventSeqs?: number[] };
        if (d.phase === 'done') {
          stats.compactionCount++;
          stats.compactedSourceEventCount += d.sourceEventSeqs?.length ?? 0;
        }
        break;
      }
      default:
        break;
    }
  }

  // 孤儿数：已发起但无终态
  for (const id of toolCallIds) {
    if (!terminalToolCallIds.has(id)) stats.toolOrphanCount++;
  }

  // 助手消息数精化：按 messageId 去重（text/thinking/tool_call 同消息只计一次）
  const assistantMessageIds = new Set<string>();
  for (const ev of events) {
    if (
      ev.type === 'assistant/text' ||
      ev.type === 'assistant/thinking' ||
      ev.type === 'assistant/tool_call'
    ) {
      const d = ev.data as { messageId?: string };
      if (d.messageId) assistantMessageIds.add(d.messageId);
    }
  }
  stats.assistantMessageCount = assistantMessageIds.size;
  // messageCount 精化：user 按事件计（通常一消息一事件），assistant 按去重后并入
  stats.messageCount = stats.userMessageCount + stats.assistantMessageCount;

  return stats;
}
