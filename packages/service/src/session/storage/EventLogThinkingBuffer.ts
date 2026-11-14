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
 * 事件层「连续 thinking 合并缓冲」（B1，2026-10-30）
 *
 * **背景**：`events.jsonl` 实测 29 文件 / 196.8 MB，`assistant/thinking` 占 **47.9% 行数**
 * （最大会话 24,976 条 / 230 条消息）。调用侧已有防抖（`THINKING_BATCH_SIZE=50` /
 * `THINKING_BATCH_MS=2000`），但每 50 chunk / 2s 仍会心跳落一条 ⇒ 条数依旧随思考长度线性增长。
 *
 * **口径**：同一 `messageId` 的**相邻** thinking chunk 在存储层合并成**一条**事件
 * （内容纯拼接）。落盘时机（与 `EventLogTextBuffer` 同款"所有权闭环"）：
 *  - 任意**非 thinking** 事件入队前（保证事件相对顺序与逐条写入完全一致）；
 *  - `messageId` 变化 / 无 `messageId`（无法证明归属 ⇒ 不合并，按原样写）；
 *  - `read` / `getTailSeq` / `flushTextBuffer`（读路径永远看得见已写入的思考）；
 *  - 单段超 `maxBytes`（默认 512KB）⇒ 立即落盘，防整轮思考驻留内存。
 *
 * **语义不变**：事件类型、`seq`（flush 时由宿主 `append` 原子分配）、内容与时序都不变，
 * 回放/导出只是"条数变少"。代价：进程在 flush 前崩溃会丢该段已 yield 的思考
 * （与 text 缓冲同级的已知取舍，`M1-INV①` 的 warning 锚点不变）。
 *
 * **外迁理由**（与 `EventLogTextBuffer` 同）：`EventLogStorage` 已接近
 * `lint:size` 的 2000 行上限（大文件拆分 spec §36）。
 */

import type { LiriEvent } from '@modules/session/types/events';

/** 单段连续 thinking 的合并上限（UTF-16 近似，与 text 缓冲口径一致） */
export const THINKING_MERGE_MAX_BYTES = 512 * 1024;

/** 宿主注入面：flush 需要宿主 `append`（seq 由 append 原子分配） */
export interface EventLogThinkingBufferDeps {
  readonly sessionId: string;
  readonly maxBytes?: number;
  append(event: LiriEvent): Promise<{ ok: boolean }>;
}

/** 一段待落盘的连续 thinking */
interface PendingThinking {
  messageId: string;
  content: string;
  time: number;
  bytes: number;
}

export class EventLogThinkingBuffer {
  private pending: PendingThinking | null = null;
  /** 正在 flush（防宿主 `append` 把 flush 出来的 thinking 又收进缓冲） */
  private flushing = false;

  constructor(private readonly deps: EventLogThinkingBufferDeps) {}

  /**
   * 把待落盘段写成**一条** `assistant/thinking`。
   *
   * 仅从宿主入口（`append` / `read` / `getTailSeq` / `flushTextBuffer`）调用：
   * 宿主 append 队列内部一律先 flush 再入队，故作业执行期间 pending 恒为 null，
   * 不存在"作业内再入队"的自锁路径。
   */
  async flush(): Promise<void> {
    const pending = this.pending;
    if (!pending || this.flushing) return;
    this.pending = null;
    this.flushing = true;
    try {
      await this.deps.append({
        type: 'assistant/thinking',
        schemaVersion: 1,
        seq: 0,
        time: pending.time,
        sessionId: this.deps.sessionId,
        data: { content: pending.content, messageId: pending.messageId },
      } as LiriEvent);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * 吸收一条 thinking chunk（宿主在入队前调用）。
   *
   * @returns `true` = 已入缓冲（宿主**不要**再走落盘路径）；`false` = 按普通事件写盘
   */
  async absorb(event: LiriEvent): Promise<boolean> {
    if (this.flushing) return false;
    if (event.type !== 'assistant/thinking') {
      await this.flush();
      return false;
    }
    const data = event.data as
      | { messageId?: unknown; content?: unknown }
      | undefined;
    const messageId = typeof data?.messageId === 'string' ? data.messageId : '';
    const content = typeof data?.content === 'string' ? data.content : '';
    if (!messageId) {
      await this.flush();
      return false;
    }
    if (this.pending && this.pending.messageId !== messageId) {
      await this.flush();
    }
    const pending = this.pending;
    if (pending && pending.messageId === messageId) {
      pending.content += content;
      pending.time = event.time;
      pending.bytes += content.length;
    } else {
      this.pending = {
        messageId,
        content,
        time: event.time,
        bytes: content.length,
      };
    }
    const maxBytes = this.deps.maxBytes ?? THINKING_MERGE_MAX_BYTES;
    if (this.pending && this.pending.bytes >= maxBytes) {
      await this.flush();
    }
    return true;
  }
}
