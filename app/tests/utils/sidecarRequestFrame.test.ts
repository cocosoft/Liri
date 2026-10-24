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
 * 请求帧 `meta.traceparent` 契约（基础设施专项 §6-#6）。
 *
 * 关键约束：**没有 trace 上下文时不改帧形状** —— 侧车协议已上线，
 * 任何"多一个空对象"都可能影响对端校验。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildRequestFrame,
  decodeFrame,
  encodeFrame,
  parseTraceparent,
  traceIdOf,
} from '../../src/utils/sidecarIpc';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

describe('请求帧 trace 元数据', () => {
  it('无 traceparent ⇒ 帧形状与既有完全一致（不含 meta）', () => {
    expect(buildRequestFrame('1', 'lsp.hover', { a: 1 })).toEqual({
      id: '1',
      method: 'lsp.hover',
      params: { a: 1 },
    });
  });

  it('params 缺省 ⇒ 空对象（与既有写入端一致）', () => {
    expect(buildRequestFrame('1', 'ping')).toEqual({
      id: '1',
      method: 'ping',
      params: {},
    });
  });

  it('有 traceparent ⇒ meta 携带，其余字段不变', () => {
    expect(buildRequestFrame('2', 'lsp.hover', {}, TRACEPARENT)).toEqual({
      id: '2',
      method: 'lsp.hover',
      params: {},
      meta: { traceparent: TRACEPARENT },
    });
  });

  it('经分帧往返后 meta 仍可读', () => {
    const decoded = decodeFrame(
      encodeFrame(buildRequestFrame('3', 'lsp.hover', {}, TRACEPARENT))
    );
    expect(
      (decoded?.meta as { traceparent?: string } | undefined)?.traceparent
    ).toBe(TRACEPARENT);
  });
});

describe('traceparent 解析（侧车侧消费）', () => {
  it('合法 ⇒ 三要素守恒', () => {
    expect(parseTraceparent(TRACEPARENT)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      sampled: true,
    });
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)?.sampled).toBe(
      false
    );
  });

  it('非法形态一律 null（不臆造 trace）', () => {
    const bad: unknown[] = [
      undefined,
      null,
      42,
      '',
      `01-${TRACE_ID}-${SPAN_ID}-01`, // 版本非 00
      `00-${'0'.repeat(32)}-${SPAN_ID}-01`, // 全零 traceId
      `00-${TRACE_ID}-${'0'.repeat(16)}-01`, // 全零 spanId
      `00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`, // traceId 短
      `00-${TRACE_ID}-${SPAN_ID}-1`, // flags 非两位
      `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`, // 大写
    ];
    for (const value of bad) expect(parseTraceparent(value)).toBeNull();
  });

  it('traceIdOf：从帧取 traceId；缺 meta / 非法 ⇒ undefined', () => {
    expect(
      traceIdOf(buildRequestFrame('1', 'lsp.hover', {}, TRACEPARENT))
    ).toBe(TRACE_ID);
    expect(traceIdOf(buildRequestFrame('1', 'lsp.hover'))).toBeUndefined();
    expect(
      traceIdOf({ id: '1', method: 'm', meta: { traceparent: 'bad' } })
    ).toBeUndefined();
    expect(traceIdOf({ id: '1', method: 'm', meta: 'x' })).toBeUndefined();
    expect(traceIdOf(null)).toBeUndefined();
  });
});
