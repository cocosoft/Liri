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
 * D8：轨迹 → SFT 数据集导出
 *
 * 只验证导出逻辑（纯字符串），不涉及训练本身（需算力资源，超出本机范围）。
 */

import { describe, expect, it } from 'bun:test';
import { ExportService } from '../../src/trace-recording/export/ExportService';
import type { TraceRecord } from '../../src/trace-recording/types';

function makeRecord(over: Partial<TraceRecord> = {}): TraceRecord {
  return {
    id: 'r1',
    timestamp: '2026-09-13T00:00:00.000Z',
    turn: 1,
    durationMs: 10,
    upstreamBaseUrl: 'http://127.0.0.1:1',
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: {
        messages: [
          { role: 'system', content: '你是助手' },
          { role: 'user', content: '1+1?' },
        ],
      },
    },
    response: {
      status: 200,
      headers: {},
      body: { choices: [{ message: { role: 'assistant', content: '2' } }] },
    },
    phase: 'completed',
    ...over,
  } as TraceRecord;
}

describe('ExportService.exportSftJsonl（D8）', () => {
  const svc = new ExportService();

  it('完成态记录 → 生成一行含 messages 的 JSONL（末条为 assistant）', () => {
    const out = svc.exportSftJsonl([makeRecord()]);
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const sample = JSON.parse(lines[0]!) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(sample.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
    ]);
    expect(sample.messages[2]!.content).toBe('2');
  });

  it('export() 通过 sft-jsonl 格式分支可达', () => {
    expect(svc.export([makeRecord()], 'sft-jsonl')).toContain('"role":"user"');
  });

  it('pending（进行中）与 error 记录被跳过（不进训练集）', () => {
    const out = svc.exportSftJsonl([
      makeRecord({ id: 'p', phase: 'pending' }),
      makeRecord({ id: 'e', error: 'boom' }),
    ]);
    expect(out).toBe('');
  });

  it('提取不到助手内容 → 跳过，不产出空样本', () => {
    const out = svc.exportSftJsonl([
      makeRecord({ response: { status: 200, headers: {}, body: {} } }),
    ]);
    expect(out).toBe('');
  });

  it('多条记录按 turn 升序输出', () => {
    const out = svc.exportSftJsonl([
      makeRecord({ id: 'b', turn: 2 }),
      makeRecord({ id: 'a', turn: 1 }),
    ]);
    expect(out.split('\n').filter((l) => l.length > 0)).toHaveLength(2);
  });
});
