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
 * G13（2026-10-11，S1-3）—— `GeminiTransport` toolCallId 熵。
 *
 * 修复前：`call_${toolCalls.length}` 为**序号** ⇒ 同一执行跨轮复用时会产出重复的 `call_0`
 * （结算按 `(execution_id, tool_call_id)` 匹配 ⇒ 错行）。修复后为 crypto 强随机后缀。
 */
import { describe, it, expect } from 'bun:test';
import { GeminiTransport } from '../../../src/ai/transports/GeminiTransport.js';

/** 含两个 functionCall 的 Gemini 响应（同一轮内多次调用） */
const RAW = {
  candidates: [
    {
      content: {
        parts: [
          { functionCall: { name: 'a', args: { x: 1 } } },
          { functionCall: { name: 'b', args: {} } },
        ],
      },
      finishReason: 'STOP',
    },
  ],
};

describe('G13 GeminiTransport toolCallId 熵', () => {
  it('同一轮内多次调用 ⇒ id 互不相同，且为 crypto 强随机形态', () => {
    const r = new GeminiTransport().normalizeResponse(RAW);
    const ids = r.toolCalls.map((c) => c.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^call_[0-9a-f]{10}$/);
  });

  it('跨轮复用同一响应 ⇒ 不复用同一 id（修复前两轮均产出 `call_0`）', () => {
    const t = new GeminiTransport();
    const r1 = t.normalizeResponse(RAW);
    const r2 = t.normalizeResponse(RAW);
    const ids = [...r1.toolCalls, ...r2.toolCalls].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
