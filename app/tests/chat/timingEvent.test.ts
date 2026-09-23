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
 * `metric/timing` 事件载荷构造（TR-14 接线 / TR-12-A 用量分桶，2026-09-22）
 *
 * 锁定"只记真实数据、缺就不写"的口径：
 * - 请求级：全 0 ⇒ **不产事件**；缓存字段 **>0 才写**（0 不写 ⇒ 不把"provider 不返回
 *   缓存字段"表达成"缓存命中 0"）；
 * - 回合级：`startedAt`/`createdAt` 任一缺失或倒挂 ⇒ **不产事件**（不用 0 兜底）；
 * - 一律**不写 `ttft`**（现有 ttfb 在 provider 层、未挂消息 ⇒ 取不到就不写）。
 */
import { describe, it, expect } from 'bun:test';
import {
  buildAssistantTimingData,
  buildRequestTimingData,
} from '../../src/chat/services/timingEvent';

describe('buildRequestTimingData（请求级用量分桶）', () => {
  it('usage 缺失 ⇒ null（不产事件）', () => {
    expect(buildRequestTimingData(null)).toBeNull();
    expect(buildRequestTimingData(undefined)).toBeNull();
  });

  it('tokens 全 0 ⇒ null（对齐既有"0/0 跳过"约定）', () => {
    expect(
      buildRequestTimingData({ prompt_tokens: 0, completion_tokens: 0 })
    ).toBeNull();
    expect(
      buildRequestTimingData({ inputTokens: 0, outputTokens: 0 })
    ).toBeNull();
  });

  it('标准键（prompt/completion）⇒ stage=request + 总/分项 tokens', () => {
    const data = buildRequestTimingData({
      prompt_tokens: 1000,
      completion_tokens: 200,
    });
    expect(data).toEqual({
      stage: 'request',
      tokens: 1200,
      inputTokens: 1000,
      outputTokens: 200,
    });
  });

  it('别名字段（inputTokens/outputTokens）同样识别', () => {
    const data = buildRequestTimingData({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(data?.tokens).toBe(15);
    expect(data?.inputTokens).toBe(10);
    expect(data?.outputTokens).toBe(5);
  });

  it('缓存命中（cache_read_input_tokens）⇒ 写入 cacheReadTokens', () => {
    const data = buildRequestTimingData({
      prompt_tokens: 100,
      completion_tokens: 1,
      cache_read_input_tokens: 80,
    });
    expect(data?.cacheReadTokens).toBe(80);
  });

  it('缓存为 0 ⇒ **不写**该字段（不表达成"命中 0"）', () => {
    const data = buildRequestTimingData({
      prompt_tokens: 100,
      completion_tokens: 1,
      cache_read_input_tokens: 0,
    });
    expect('cacheReadTokens' in (data ?? {})).toBe(false);
    expect('cacheCreationTokens' in (data ?? {})).toBe(false);
  });

  it('缓存三级回退键（prompt_cache_hit_tokens / prompt_tokens_details.cached_tokens）', () => {
    expect(
      buildRequestTimingData({
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 7,
      })?.cacheReadTokens
    ).toBe(7);
    expect(
      buildRequestTimingData({
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_tokens_details: { cached_tokens: 9 },
      })?.cacheReadTokens
    ).toBe(9);
  });

  it('缓存写入（cache_creation_input_tokens）⇒ 写入 cacheCreationTokens', () => {
    const data = buildRequestTimingData({
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_input_tokens: 33,
    });
    expect(data?.cacheCreationTokens).toBe(33);
  });

  it('不写 ttft（取不到就不写，不造近似值）', () => {
    const data = buildRequestTimingData({
      prompt_tokens: 1,
      completion_tokens: 1,
    });
    expect('ttft' in (data ?? {})).toBe(false);
  });
});

describe('buildAssistantTimingData（回合级耗时）', () => {
  it('非 assistant 角色 ⇒ null', () => {
    expect(
      buildAssistantTimingData({
        role: 'user',
        startedAt: new Date(1000),
        createdAt: new Date(2000),
      })
    ).toBeNull();
  });

  it('缺 startedAt ⇒ null（不用 createdAt 兜底成 0）', () => {
    expect(
      buildAssistantTimingData({ role: 'assistant', createdAt: new Date(2000) })
    ).toBeNull();
  });

  it('缺 createdAt ⇒ null', () => {
    expect(
      buildAssistantTimingData({ role: 'assistant', startedAt: new Date(1000) })
    ).toBeNull();
  });

  it('起止有效 ⇒ duration = 完成 − 流式开始（真实墙钟）', () => {
    expect(
      buildAssistantTimingData({
        role: 'assistant',
        startedAt: new Date(1_700_000_000_000),
        createdAt: new Date(1_700_000_002_500),
      })
    ).toEqual({ stage: 'assistant', duration: 2500 });
  });

  it('时长 0 合法（极快响应仍产事件）', () => {
    expect(
      buildAssistantTimingData({
        role: 'assistant',
        startedAt: new Date(5000),
        createdAt: new Date(5000),
      })
    ).toEqual({ stage: 'assistant', duration: 0 });
  });

  it('倒挂（createdAt < startedAt）⇒ null（不产出负耗时）', () => {
    expect(
      buildAssistantTimingData({
        role: 'assistant',
        startedAt: new Date(2000),
        createdAt: new Date(1000),
      })
    ).toBeNull();
  });

  it('接受 ISO 字符串与毫秒数（归一化）', () => {
    expect(
      buildAssistantTimingData({
        role: 'assistant',
        startedAt: 1000,
        createdAt: 4000,
      })?.duration
    ).toBe(3000);
    expect(
      buildAssistantTimingData({
        role: 'assistant',
        startedAt: '2026-09-22T00:00:00.000Z',
        createdAt: '2026-09-22T00:00:02.000Z',
      })?.duration
    ).toBe(2000);
  });

  it('非法值（NaN / 无效字符串）⇒ null', () => {
    expect(
      buildAssistantTimingData({
        role: 'assistant',
        startedAt: Number.NaN,
        createdAt: 4000,
      })
    ).toBeNull();
    expect(
      buildAssistantTimingData({
        role: 'assistant',
        startedAt: 'not-a-date',
        createdAt: 4000,
      })
    ).toBeNull();
  });
});
