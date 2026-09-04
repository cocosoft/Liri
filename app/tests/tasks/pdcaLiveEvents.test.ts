// MIT License
// Copyright (c) 2026 Liri
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
 * PDCA 独立事件通道契约测试（OBS，M1a，2026-09-04）
 *
 * 守护：载荷 JSON 安全（无 undefined——D1 校验教训，见 F2）；
 * schemaVersion/type/time 恒在；核心归属字段与 data 分离。
 */
import { describe, it, expect } from 'bun:test';
import {
  buildPdcaLivePayload,
  type PdcaLiveEventType,
} from '../../src/tasks/PdcaLiveEvents';

function assertJsonSafe(value: unknown, path = '$'): void {
  if (value === undefined) {
    throw new Error(`载荷含 undefined: ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertJsonSafe(v, `${path}.${k}`);
    }
  }
}

describe('PdcaLiveEvents 事件契约（M1a）', () => {
  it('完整载荷：schemaVersion/type/time + 归属 + data 分离', () => {
    const p = buildPdcaLivePayload(
      'pdca:stage:complete',
      123456,
      { taskId: 't1', planId: 'p1', sessionId: 's1' },
      { stage: 'execute', status: 'completed', percent: 100 }
    );
    expect(p.schemaVersion).toBe(1);
    expect(p.type).toBe('pdca:stage:complete');
    expect(p.time).toBe(123456);
    expect(p.taskId).toBe('t1');
    expect((p.data as Record<string, unknown>).stage).toBe('execute');
  });

  it('可选字段 undefined 被省略（JSON 安全，无 D1 拒写）', () => {
    const p = buildPdcaLivePayload(
      'pdca:stage:phase',
      1,
      { sessionId: 's1' }, // taskId/planId/projectId 全缺
      { stage: 'execute', currentStep: undefined, tokenCost: undefined }
    );
    expect('taskId' in p).toBe(false);
    expect('planId' in p).toBe(false);
    const data = p.data as Record<string, unknown>;
    expect('currentStep' in data).toBe(false);
    expect('tokenCost' in data).toBe(false);
    assertJsonSafe(p);
    expect(() => JSON.stringify(p)).not.toThrow();
  });

  it('阶段枚举事件类型均支持', () => {
    const types: PdcaLiveEventType[] = [
      'pdca:stage:start',
      'pdca:stage:phase',
      'pdca:stage:complete',
      'pdca:stage:fail',
      'pdca:tool:executed',
    ];
    for (const t of types) {
      const p = buildPdcaLivePayload(t, 1, { sessionId: 's' }, {});
      expect(p.type).toBe(t);
      assertJsonSafe(p);
    }
  });
});
