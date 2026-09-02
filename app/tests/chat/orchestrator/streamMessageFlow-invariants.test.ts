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
 * T1.1 恢复语义不变量①测试组（阶段 2）
 *
 * 不变量①「所见即所存」：中断时只落盘已 yield 内容。
 * - 1.1 正常流式全落盘（基线）
 * - 1.2 中断丢弃 scrubber 缓冲（半截标签不落盘）
 * - 1.3 中断 flush thinking 防抖缓冲（已展示 thinking 落盘）
 * - 1.4 中断后已 yield 内容保留（持久化消息含已展示部分）
 *
 * 依赖：阶段 1 mock 基建（helpers.ts）。
 */
import { describe, it, expect } from 'bun:test';
import { createTestHost } from './helpers';
import { runStreamMessage } from '../../../src/chat/orchestrator/streamMessageFlow.js';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';

/** 收集 text chunk 内容（string 裸文本 或 {type:'text'} 对象） */
function collectTexts(chunks: unknown[]): string {
  let text = '';
  for (const chunk of chunks) {
    if (typeof chunk === 'string') text += chunk;
    else if (chunk && (chunk as { type?: string }).type === 'text') {
      text += (chunk as { content?: string }).content ?? '';
    }
  }
  return text;
}

/** 收集 appendStreamEvent 写入的事件列表 */
function collectEvents(
  host: ChatOrchestratorHost
): Array<{ type: string; data: unknown }> {
  const events: Array<{ type: string; data: unknown }> = [];
  const orig = host.appendStreamEvent;
  (host as { appendStreamEvent: unknown }).appendStreamEvent = async (
    _sid: string,
    ev: { type: string; data: unknown }
  ) => {
    events.push({ type: ev.type, data: ev.data });
    return { ok: true, tailSeq: events.length };
  };
  void orig;
  return events;
}

describe('不变量① 所见即所存', () => {
  it('1.1 正常流式：文本全部 yield 且以 assistant/text 事件落盘', async () => {
    const host = createTestHost({
      llmChunks: [{ content: '你好' }, { content: '世界' }],
    });
    const events = collectEvents(host);
    let finalizeContent = '';
    (host as { _finalizeStreamMessage: unknown })._finalizeStreamMessage = async (
      _session: unknown,
      _content: string,
      accumulated: string
    ) => {
      finalizeContent = accumulated;
      return { content: accumulated } as never;
    };

    const received: unknown[] = [];
    for await (const chunk of runStreamMessage(host, '测试', {})) {
      received.push(chunk);
    }

    // 文本已 yield（前端可见）
    expect(collectTexts(received)).toContain('你好');
    expect(collectTexts(received)).toContain('世界');
    // STAGE-A（2026-09-02）：text chunk 聚合为 assistant/text-batch 事件落盘（F-2），
    // 兼容回退路径的逐条 assistant/text（A-1）
    const textEvents = events.filter(
      (e) => e.type === 'assistant/text' || e.type === 'assistant/text-batch'
    );
    expect(textEvents.length).toBeGreaterThan(0);
    const joined = textEvents
      .map((e) => ((e.data as { content?: string }).content ?? ''))
      .join('');
    expect(joined).toContain('你好');
    expect(joined).toContain('世界');
  });

  it('1.2 中断：scrubber 跨 chunk 缓冲的半截标签不落盘', async () => {
    // '<think' 是未闭合的 think 开标签（无 '>'）——scrubber 缓冲到 openTagBuffer；
    // 第 2 个 chunk 前抛错中断 → catch 中 scrubber.flush() 丢弃缓冲（不写事件）
    const host = createTestHost({
      llmChunks: [{ content: '<think' }, { content: 'x' }],
      llmOptions: {
        failAfter: 1,
        failWith: new Error('simulated stream interrupt'),
      },
    });
    const events = collectEvents(host);

    const received: unknown[] = [];
    for await (const chunk of runStreamMessage(host, '测试', {})) {
      received.push(chunk);
    }

    // 半截标签内容未作为 text 事件落盘（scrubber 缓冲丢弃）；已 yield 内容也不含
    const textEvents = events.filter(
      (e) => e.type === 'assistant/text' || e.type === 'assistant/text-batch'
    );
    const joined = textEvents
      .map((e) => ((e.data as { content?: string }).content ?? ''))
      .join('');
    expect(joined).not.toContain('<think');
    // 已 yield 内容也不含半截标签
    expect(collectTexts(received)).not.toContain('<think');
  });

  it('1.3 中断：thinking 防抖缓冲（未达阈值）flush 落盘', async () => {
    // 1 条 thinking（未达 50 条/2s 批次阈值）→ 中断 → flushThinkingEvents 落盘
    const host = createTestHost({
      llmChunks: [{ content: { type: 'thinking', content: '深度思考中' } }],
      llmOptions: {
        failAfter: 1,
        failWith: new Error('simulated stream interrupt'),
      },
    });
    const events = collectEvents(host);

    for await (const _chunk of runStreamMessage(host, '测试', {})) {
      // 消费流（触发中断路径）
    }

    // thinking 防抖缓冲在中断时已 flush 落盘（KB-EVENT-BATCH-FLUSH）
    const thinkingEvents = events.filter(
      (e) => e.type === 'assistant/thinking'
    );
    expect(thinkingEvents.length).toBeGreaterThan(0);
    const joined = thinkingEvents
      .map((e) =>
        JSON.stringify(((e.data as { content?: unknown })?.content) ?? '')
      )
      .join('');
    expect(joined).toContain('深度思考中');
  });

  it('1.4 中断：已 yield 内容在持久化消息中保留', async () => {
    // '你好' 已展示后中断 → 持久化消息（finalize 的 accumulated）含 '你好'
    const host = createTestHost({
      llmChunks: [{ content: '你好' }, { content: '世界' }],
      llmOptions: {
        failAfter: 1,
        failWith: new Error('simulated stream interrupt'),
      },
    });
    let finalizeContent = '';
    (host as { _finalizeStreamMessage: unknown })._finalizeStreamMessage = async (
      _session: unknown,
      _content: string,
      accumulated: string
    ) => {
      finalizeContent = accumulated;
      return { content: accumulated } as never;
    };

    const received: unknown[] = [];
    for await (const chunk of runStreamMessage(host, '测试', {})) {
      received.push(chunk);
    }

    // 已 yield 的 '你好' 保留（所见即所存）
    expect(collectTexts(received)).toContain('你好');
    expect(finalizeContent).toContain('你好');
  });

  it('A-3 text 聚合：64KB 阈值触发中途 flush，内容按批完整落盘', async () => {
    // 3 × 40KB：chunkA+chunkB=80KB ≥64KB → 中途 flush 一条 text-batch；
    // chunkC=40KB <64KB → 流收尾 flush 第二条。总内容不丢。
    const chunkA = 'a'.repeat(40 * 1024);
    const chunkB = 'b'.repeat(40 * 1024);
    const chunkC = 'c'.repeat(40 * 1024);
    const host = createTestHost({
      llmChunks: [
        { content: chunkA },
        { content: chunkB },
        { content: chunkC },
      ],
    });
    const events = collectEvents(host);

    const received: unknown[] = [];
    for await (const chunk of runStreamMessage(host, '测试', {})) {
      received.push(chunk);
    }
    // yield 内容完整（前端可见性不受批处理影响）
    expect(collectTexts(received)).toBe(chunkA + chunkB + chunkC);
    // 落盘为 2 条 text-batch（1 条中途 flush + 1 条收尾），内容无丢失
    const batchEvents = events.filter((e) => e.type === 'assistant/text-batch');
    expect(batchEvents.length).toBe(2);
    const joined = batchEvents
      .map((e) => ((e.data as { content?: string }).content ?? ''))
      .join('');
    expect(joined).toBe(chunkA + chunkB + chunkC);
  });

  it('A-2① 正文经存储层缓冲：流结束 flush 聚合为单条 text-batch（A-1 回退归存储层）', async () => {
    const host = createTestHost({
      llmChunks: [{ content: 'A' }, { content: 'B' }, { content: 'C' }],
    });
    const events = collectEvents(host);

    for await (const _chunk of runStreamMessage(host, '测试', {})) {
      // 消费流
    }

    // 正文全部缓冲，仅在流结束 flush 时聚合落盘（mock flush → appendStreamEvent）
    const batchEvents = events.filter((e) => e.type === 'assistant/text-batch');
    expect(batchEvents.length).toBe(1);
    const joined = batchEvents
      .map((e) => ((e.data as { content?: string }).content ?? ''))
      .join('');
    expect(joined).toBe('ABC');
    const textEvents = events.filter((e) => e.type === 'assistant/text');
    expect(textEvents.length).toBe(0);
  });
});
