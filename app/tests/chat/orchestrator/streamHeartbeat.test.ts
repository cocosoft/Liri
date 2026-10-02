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
 * T-⑥11 流式静默心跳 —— 回归用例（2026-10-03）
 *
 * 缺陷：`ChatOrchestrator.streamMessage` 消费 `runStreamMessage` 生成器时，长任务
 * （工具执行 / 模型长时间无 token）期间数十秒~数分钟无任何 chunk ⇒ 用户感知"卡住"
 * （实测静默样本 11s~1254s，36 条用户消息中 19 条是催促）。
 *
 * 修复：消费侧按 `STREAM_HEARTBEAT_MS`（默认 45s）计时，超时补发一条 status chunk
 * 「⏳ 仍在运行…（已 N 秒无新输出）」；**不落库、不入模型请求**，且**不复位**看门狗。
 *
 * 用例口径：
 * - 静默超过阈值 ⇒ 出现心跳，且带 `sessionId`（`ChatStreamChunk` 必填字段）
 * - 产出连续（阈值远大于间隔）⇒ 不出现心跳
 * - 首个 chunk 之前（尚无 sessionId）⇒ 不补发（避免空 sessionId）
 */
import { describe, it, expect } from 'bun:test';
import { ChatOrchestrator } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import { createTestHost, createTestSession } from './helpers.js';

interface ChunkLike {
  type?: string;
  content?: string;
  sessionId?: string;
}

const asChunk = (c: unknown): ChunkLike =>
  c !== null && typeof c === 'object' ? (c as ChunkLike) : {};

const isHeartbeat = (c: unknown): boolean => {
  const x = asChunk(c);
  return x.type === 'status' && (x.content ?? '').includes('仍在运行');
};

/** 短暂设置 STREAM_HEARTBEAT_MS，结束后还原（避免污染同进程其他用例） */
async function withHeartbeatMs<T>(
  ms: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = process.env['STREAM_HEARTBEAT_MS'];
  process.env['STREAM_HEARTBEAT_MS'] = ms;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env['STREAM_HEARTBEAT_MS'];
    else process.env['STREAM_HEARTBEAT_MS'] = prev;
  }
}

describe('T-⑥11 ChatOrchestrator.streamMessage — 静默心跳', () => {
  it('生成器静默超过阈值 ⇒ 补发心跳 status chunk（带 sessionId）', async () => {
    await withHeartbeatMs('30', async () => {
      // ttfDelayMs=200：首个 chunk（"正在读取上下文..."，带 sessionId）之后，
      // 到首个 LLM token 之间有 200ms 静默 ⇒ 30ms 心跳应触发多次。
      const session = createTestSession({ id: 'hb-session' });
      const host = createTestHost({
        session,
        llmChunks: [{ content: 'hi' }],
        llmOptions: { ttfDelayMs: 200 },
      });
      const orch = new ChatOrchestrator({ host });

      const chunks: unknown[] = [];
      for await (const c of orch.streamMessage('hi', {})) {
        chunks.push(c);
      }

      const heartbeats = chunks.filter(isHeartbeat);
      expect(heartbeats.length).toBeGreaterThan(0);
      // sessionId 必填：心跳必须带上（否则前端无法归位到会话）
      expect(asChunk(heartbeats[0]).sessionId).toBe(session.id);
    });
  });

  it('产出连续（阈值远大于间隔）⇒ 不补发心跳', async () => {
    await withHeartbeatMs('100000', async () => {
      const host = createTestHost({
        llmChunks: [{ content: 'a' }, { content: 'b' }],
      });
      const orch = new ChatOrchestrator({ host });

      const chunks: unknown[] = [];
      for await (const c of orch.streamMessage('hi', {})) {
        chunks.push(c);
      }

      expect(chunks.filter(isHeartbeat).length).toBe(0);
    });
  });
});
