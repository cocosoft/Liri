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
 * 事件层「流式正文缓冲」（原 `EventLogStorage` 的 text-chunk 缓冲簇）
 *
 * 由 `EventLogStorage.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §36）：A-2① 的
 * 「缓冲不落盘 / flush 时按 messageId 聚合一条 `assistant/text-batch`」策略。
 *
 * ⚠️ **只搬不改**：逻辑逐字保留；logger module 名保持 `session:event-log`
 * （与宿主一致）⇒ 日志输出不变。
 */

import { enterPhase, exitPhase } from '@modules/diagnostics';
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { getMemoryPressureMonitor } from '@modules/monitoring';
import type { LiriEvent } from '@modules/session/types/events';
import { memProfile } from '../../monitoring/memProfile.js';

const logger = getLogger('session:event-log');

/** 缓冲安全阈值（超限自动 flush —— 防调用方异常路径无限缓冲，CS03 兜底） */
const TEXT_BUFFER_SAFETY_BYTES = 512 * 1024;

/**
 * `append` 结果的**最小读取面**（宿主 `EventLogAppendResult` 的结构子集）——
 * 避免为取一个类型反向 import 宿主（会形成循环依赖）。
 */
export interface TextBatchAppendResult {
  ok: boolean;
  reason?: string;
}

/** 宿主注入面：flush 需要宿主 `append`（seq 由 append 原子分配） */
export interface EventLogTextBufferDeps {
  readonly sessionId: string;
  append(event: LiriEvent): Promise<TextBatchAppendResult>;
}

/**
 * 流式正文缓冲：`read`/`getTailSeq`/`append` 前由宿主调用 `flushTextBuffer()`，
 * 保证读路径永远看到已入缓冲的正文（所有权闭环）。
 */
export class EventLogTextBuffer {
  private textChunkBuffer: Map<string, { chunks: string[]; bytes: number }> =
    new Map();
  private textChunkBufferBytes = 0;

  /**
   * N-59：登记"该 messageId 的正文已进入流式通道"（事实）——供落盘侧去重判据。
   *
   * 按 CS02（状态判断基于事实而非易失标记）改为**问事件层事实**。
   *
   * 进程内集合：重启后为空（此时不存在"流式刚写完正文"的并发窗口，不会双写）。
   */
  private readonly streamedTextMessageIds = new Set<string>();

  constructor(private readonly deps: EventLogTextBufferDeps) {}

  /** 是否存在待 flush 的缓冲（宿主 `getTailSeq` 前的廉价判据） */
  hasPending(): boolean {
    return this.textChunkBufferBytes > 0;
  }

  /**
   * 该 messageId 是否已写入过正文（`assistant/text` 或 `assistant/text-batch`）。
   * 供落盘侧去重判据使用（N-59）：`_appendEventsForMessage` 据此过滤
   * `convertMessage` 派生的完整正文，避免与流式正文双份写入。
   */
  hasStreamedTextForMessage(messageId: string): boolean {
    return this.streamedTextMessageIds.has(messageId);
  }

  /**
   * A-2①（2026-09-02，v4 §5.2 选项①）：缓冲一条 text chunk（不落盘、不分配 seq）。
   *
   * 聚合/flush 策略（64KB/2s）由调用方（streamMessageFlow）驱动；本层保证
   * read/getTailSeq/append 前自动 flush（所有权闭环）——读路径永远看到已入缓冲
   * 的正文，打破"流进行中读到不完整 text"的竞态。seq 在 flush 落盘时原子分配。
   * 安全阈值（512KB）超限自动 flush：防调用方异常路径无限缓冲（CS03 兜底）。
   */
  async bufferTextChunk(
    messageId: string,
    content: string
  ): Promise<{ ok: boolean }> {
    if (!content) return { ok: true };
    // N-59：登记"该 messageId 的正文已进入流式通道"（事实）——供落盘侧去重判据
    this.streamedTextMessageIds.add(messageId);
    let entry = this.textChunkBuffer.get(messageId);
    if (!entry) {
      entry = { chunks: [], bytes: 0 };
      this.textChunkBuffer.set(messageId, entry);
    }
    entry.chunks.push(content);
    const bytes = content.length; // UTF-16 近似（与 snapshotBytes 口径一致）
    entry.bytes += bytes;
    this.textChunkBufferBytes += bytes;
    if (this.textChunkBufferBytes >= TEXT_BUFFER_SAFETY_BYTES) {
      await this.flushTextBuffer();
    }
    return { ok: true };
  }

  /**
   * A-2①：flush 全部缓冲 text —— 每 messageId 聚合一条 `assistant/text-batch`
   * 落盘（F-2 schema；seq 由 append 原子分配，P3-7a）。批量 append 失败 → 回退
   * 逐 chunk 为 `assistant/text` 落盘（A-1：丢失窗口不放大到整批，M1-INV① 可观测）。
   * 失败不抛错（CS03）。
   *
   * @returns 实际 flush 的 chunk 数（含回退路径）
   */
  async flushTextBuffer(): Promise<number> {
    enterPhase('eventlog:flushText');
    try {
      if (this.textChunkBuffer.size === 0) return 0;
      const pending = this.textChunkBuffer;
      const bufferedBytes = this.textChunkBufferBytes; // 治理度量（external 归因）
      this.textChunkBuffer = new Map();
      this.textChunkBufferBytes = 0;
      let flushed = 0;
      let maxJoinedBytes = 0;
      for (const [messageId, entry] of pending) {
        const joined = entry.chunks.join('');
        const joinedBytes = joined.length; // UTF-16 近似
        if (joinedBytes > maxJoinedBytes) maxJoinedBytes = joinedBytes;
        const joinedResult = await this.deps.append({
          type: 'assistant/text-batch',
          schemaVersion: 1,
          seq: 0,
          time: Date.now(),
          sessionId: this.deps.sessionId,
          data: { content: joined, messageId },
        });
        if (!joinedResult.ok) {
          // A-1：单批失败 → 回退逐 chunk（避免"一次失败丢整批"）
          logger.warn(
            'event-log: text-batch 聚合落盘失败，回退逐 chunk（A-1）',
            {
              sessionId: this.deps.sessionId,
              messageId,
              chunkCount: entry.chunks.length,
              reason: joinedResult.reason,
            }
          );
          for (const chunkContent of entry.chunks) {
            const r = await this.deps.append({
              type: 'assistant/text',
              schemaVersion: 1,
              seq: 0,
              time: Date.now(),
              sessionId: this.deps.sessionId,
              data: { content: chunkContent, messageId },
            });
            if (!r.ok) {
              logger.warn('event-log: assistant/text 回退落盘失败', {
                sessionId: this.deps.sessionId,
                messageId,
                contentLength: chunkContent.length,
                reason: r.reason,
              });
            }
          }
        }
        flushed += entry.chunks.length;
      }
      // 内存画像（MEM_PROFILE=1）：text-batch 聚合落盘完成（join 大字符串的驻留窗口）
      memProfile('eventlog:flush-text', {
        sessionId: this.deps.sessionId,
        flushed,
        bufferedBytes, // 治理度量：本次 flush 前缓冲总字节（external 归因）
        maxJoinedBytes, // 治理度量：单条聚合后最大字节（join 瞬态上限）
      });
      // external 治理（2026-09-02 选项②）：单条聚合 >1MB 属超常（常规 ≤64KB 触发/512KB
      // 安全阈值）——告警供归因（若确认 join 瞬态是 external 尖峰主源，再做分段拆分）
      if (maxJoinedBytes > 1024 * 1024) {
        logger.warn('event-log: text-batch 单条聚合超常（>1MB）', {
          sessionId: this.deps.sessionId,
          maxJoinedBytes,
          bufferedBytes,
          pendingEntries: pending.size,
        });
      }
      // 内存水位 tick（2026-09-02 标定：flush-text 实测单步 +507MB/驻留 external 1.39GB，
      // 是流式写路径主要瞬时分配点 → 落盘后立即做一次水位评估）
      getMemoryPressureMonitor().tick();
      return flushed;
    } finally {
      exitPhase('eventlog:flushText');
    }
  }
}
