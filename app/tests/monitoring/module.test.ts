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
 * createModule — §十一 可观测性零样板门面测试
 * 验证：Logger 实例复用、handleError 自动携带 module+action、trace span 成功/异常路径。
 *
 * 注意：不使用 mock.module（进程级副作用会污染其他测试文件），
 * 错误/追踪断言通过真实依赖的可观测面（getErrorStats / spyOn 单例实例方法）。
 */

import { describe, expect, spyOn, test } from 'bun:test';
import { SpanStatusCode } from '@opentelemetry/api';
import { getErrorStats } from '../../src/error/handleError';
import { getLogger, getOTelTracing } from '../../src/monitoring';
import { createModule } from '../../src/monitoring/module';

describe('createModule — §十一 零样板门面', () => {
  test('logger 与 getLogger(name) 复用同一缓存实例', () => {
    const m = createModule('test:facade');
    const m2 = createModule('test:facade');
    expect(m.logger).toBe(getLogger('test:facade'));
    expect(m.logger).toBe(m2.logger);
  });

  test('error() 经真实 handleError 自动携带 module + action', async () => {
    const before = getErrorStats().total;
    const m = createModule('test:facade');
    await m.error(new Error('boom'), 'send');

    const after = getErrorStats();
    expect(after.total).toBe(before + 1);
    // recent[0] 为最新记录（unshift）
    expect(after.recent[0].module).toBe('test:facade');
    expect(after.recent[0].action).toBe('send');
  });

  test('trace() 成功路径：返回结果且 span 结束', async () => {
    const tracing = getOTelTracing();
    const endSpy = spyOn(tracing, 'endSpan');
    try {
      const m = createModule('test:facade');
      const result = await m.trace('test-op', async () => 42);
      expect(result).toBe(42);
      expect(endSpy).toHaveBeenCalledTimes(1);
    } finally {
      endSpy.mockRestore();
    }
  });

  test('trace() 异常路径：span 以 ERROR 结束并重新抛出', async () => {
    const tracing = getOTelTracing();
    const endSpy = spyOn(tracing, 'endSpan');
    try {
      const m = createModule('test:facade');
      await expect(
        m.trace('test-op', async () => {
          throw new Error('trace-fail');
        })
      ).rejects.toThrow('trace-fail');

      expect(endSpy).toHaveBeenCalledTimes(1);
      const [, status] = endSpy.mock.calls[0] as [unknown, SpanStatusCode];
      expect(status).toBe(SpanStatusCode.ERROR);
    } finally {
      endSpy.mockRestore();
    }
  });
});
