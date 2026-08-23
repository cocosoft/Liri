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
  blocks: Array<Record<string, unknown>>;
  tool_calls: Array<Record<string, unknown>>;
}

function makeBlock(
  seq: number,
  type: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: `blk_${seq}`,
    type,
    content: (data.content as string) ?? '',
    ...(data.toolCallId ? { toolCallId: data.toolCallId as string } : {}),
    ...(data.name ? { toolName: data.name as string } : {}),
    ...(data.args !== undefined ? { args: data.args } : {}),
  };
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
]);

function isRichBlockEvent(type: LiriEventType): boolean {
  return RICH_BLOCK_TYPES.has(type);
}

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
  for (const ev of events) {
    // A-3：跳过被压缩区间内的事件（旧消息不回放）
    if (isCompactedSeq(ev.seq)) continue;
    const data = ev.data as Record<string, unknown>;
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
    }
    // tool/result：结果已含在 assistant 的 tool_call blocks（前端配对），此处不单独成消息
  }

  const result: DerivedMessage[] = [];
  const usedProjectionIds = new Set<string>();

  // ② 投影做版本覆盖（以消息为单位，评审 A1）
  for (const agg of aggregated.values()) {
    const proj = projections.find((p) => p.id === agg.messageId);
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
        // FIX(2026-08-23)：读时归一化——投影 blocks 可能按流式 chunk 碎片化
        //（每 token 一个 text block），合并相邻 text/thinking 防前端渲染卡死
        blocks: mergeAdjacentTextBlocks(proj.blocks ?? []),
      });
    } else {
      result.push({
        id: agg.messageId,
        role: agg.role,
        content: agg.content,
        timestamp: agg.timestamp,
        // B-2（2026-08-23）：统一排序键——事件聚合消息用最后 chunk seq
        lastEventSeq: agg.maxChunkSeq,
        blocks: agg.blocks,
        tool_calls: agg.tool_calls.length > 0 ? agg.tool_calls : undefined,
      });
    }
  }

  // ③ 纯投影消息（events 无该消息 chunk，存量缺失）→ 直接取投影（评审 A2'）
  for (const proj of projections) {
    if (!usedProjectionIds.has(proj.id) && !aggregated.has(proj.id)) {
      // B-2（2026-08-23）：投影兜底消息补排序键——lastEventSeq 缺失（存量旧数据）
      // 时用 0 占位排最前（事件溯源 seq 从 1 起，0 不冲突）
      result.push({
        ...proj,
        lastEventSeq: proj.lastEventSeq ?? 0,
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
