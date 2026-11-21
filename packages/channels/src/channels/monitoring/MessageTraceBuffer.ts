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
 * 消息级全链路追踪环形缓冲（方案 A，2026-08-20）
 *
 * 职责：在 routeChannelMessage 管线各阶段（入站→帧验证→去重→限流→会话→LLM→出站）
 * 记录每条消息的阶段耗时与状态，形成可查询的链路视图。
 *
 * 设计约束：
 * - 内存环形缓冲（默认 500 条），重启即清——排查是即时行为，无需持久化
 * - 所有写入为 O(1)，不阻塞消息主流程；缓冲操作失败静默降级（可观测性组件不能成为新故障源）
 * - 与 OTel span（方案 B）互补：span 面向外部后端聚合分析，本缓冲面向应用内即时查询
 */

import { getLogger } from '@openliri/infra/monitoring';
import type {
  MessageTrace,
  MessageTraceEvent,
  MessageTraceEventKind,
  MessageTraceStage,
  MessageTraceStatus,
  TraceStageStatus,
} from './messageTraceTypes';
import { persistFinishedMessageTrace } from './MessageTraceStore';

// 2026-11-21：类型下沉到叶子模块（`Buffer → Store → Buffer` 会形成 madge 环）；
// 本文件**原址再导出**，既有引用零改动。
export type {
  TraceStageStatus,
  MessageTraceStage,
  MessageTraceStatus,
  MessageTrace,
  MessageTraceEventKind,
  MessageTraceEvent,
} from './messageTraceTypes';

const logger = getLogger('channels:monitoring:trace');

/** 环形缓冲默认容量 */
const DEFAULT_CAPACITY = 500;

class MessageTraceBufferImpl {
  private readonly capacity: number;
  private readonly traces = new Map<string, MessageTrace>();
  /** 插入顺序队列（用于容量淘汰与最近列表） */
  private readonly order: string[] = [];
  /** 增量订阅者（入站监视 G4：SSE 推送；异常订阅者自动摘除） */
  private readonly listeners = new Set<(event: MessageTraceEvent) => void>();

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  /** 开始追踪：消息入站时调用 */
  begin(trace: {
    traceId: string;
    channelName: string;
    messageId: string;
    senderId?: string;
    contentPreview?: string;
  }): void {
    try {
      // 容量淘汰：最老的记录出队
      while (this.order.length >= this.capacity) {
        const evicted = this.order.shift();
        if (evicted) this.traces.delete(evicted);
      }
      this.traces.set(trace.traceId, {
        traceId: trace.traceId,
        channelName: trace.channelName,
        messageId: trace.messageId,
        senderId: trace.senderId,
        contentPreview: (trace.contentPreview ?? '').slice(0, 50),
        startedAtMs: Date.now(),
        status: 'inflight',
        stages: [],
      });
      this.order.push(trace.traceId);
      this.emit('begin', this.traces.get(trace.traceId));
    } catch (err) {
      // @ignore-catch 可观测性缓冲写入失败不阻塞消息主流程
      logger.debug('trace begin 写入失败', { error: String(err) });
    }
  }

  /** 追加阶段记录 */
  addStage(
    traceId: string,
    name: string,
    status: TraceStageStatus,
    detail?: string,
    durationMs?: number
  ): void {
    try {
      const trace = this.traces.get(traceId);
      if (!trace) return; // 未知 traceId（已淘汰）静默忽略
      trace.stages.push({
        name,
        status,
        atMs: Date.now(),
        detail,
        durationMs,
      });
      this.emit('stage', trace);
    } catch (err) {
      // @ignore-catch 可观测性缓冲写入失败不阻塞消息主流程
      logger.debug('trace addStage 写入失败', { error: String(err) });
    }
  }

  /** 终结追踪：成功/失败/拒绝时调用 */
  finish(
    traceId: string,
    status: Extract<MessageTraceStatus, 'ok' | 'fail' | 'rejected'>,
    error?: string
  ): void {
    try {
      const trace = this.traces.get(traceId);
      if (!trace) return;
      trace.status = status;
      trace.error = error;
      trace.finishedAtMs = Date.now();
      trace.totalMs = trace.finishedAtMs - trace.startedAtMs;
      this.emit('finish', trace);
      // 入站监视 G2：终态落盘（best-effort，内部已 catch，不阻塞主流程）
      persistFinishedMessageTrace({ ...trace, status });
    } catch (err) {
      // @ignore-catch 可观测性缓冲写入失败不阻塞消息主流程
      logger.debug('trace finish 写入失败', { error: String(err) });
    }
  }

  /** 按 traceId 查询 */
  get(traceId: string): MessageTrace | undefined {
    return this.traces.get(traceId);
  }

  /**
   * 订阅链路增量事件（入站监视 G4）；返回取消函数。
   *
   * 仅推送链路元数据（`contentPreview` 恒为空串），供 SSE 使用。
   */
  subscribe(listener: (event: MessageTraceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 扇出增量事件（O(订阅者数)）。
   *
   * 单个订阅者抛异常 ⇒ **只摘除该订阅者**，不影响其余订阅者与入站主流程。
   */
  private emit(
    kind: MessageTraceEventKind,
    trace: MessageTrace | undefined
  ): void {
    if (!trace || this.listeners.size === 0) return;
    const event: MessageTraceEvent = {
      kind,
      trace: {
        ...trace,
        // 隐私边界：事件可能经 SSE 推到浏览器，正文不外发
        contentPreview: '',
        stages: trace.stages.map((stage) => ({ ...stage })),
      },
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        // @ignore-catch 单个订阅者异常不得影响其他订阅者/入站主流程
        this.listeners.delete(listener);
        logger.debug('trace 订阅者异常，已摘除', { error: String(err) });
      }
    }
  }

  /** 最近列表（倒序：最新在前），可按渠道过滤 */
  recent(limit = 50, channelName?: string): MessageTrace[] {
    const result: MessageTrace[] = [];
    for (let i = this.order.length - 1; i >= 0 && result.length < limit; i--) {
      const trace = this.traces.get(this.order[i]);
      if (!trace) continue;
      if (channelName && trace.channelName !== channelName) continue;
      result.push({ ...trace, stages: [...trace.stages] });
    }
    return result;
  }

  /** 清空（测试/手动重置用） */
  clear(): void {
    this.traces.clear();
    this.order.length = 0;
  }

  /** 当前缓冲条数 */
  get size(): number {
    return this.traces.size;
  }
}

/** 全局单例（消息路由是全局管线，与 ChannelMetrics 同构的单例模式） */
export const messageTraceBuffer = new MessageTraceBufferImpl();
