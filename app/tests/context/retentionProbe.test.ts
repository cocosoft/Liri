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
 * M5：压缩后「关键实体保留度」确定性探针
 * spec：.trae/specs/compaction-retention-probe.md（裁定 D1=折叠区口径 / D2=0.4 / D3=仅告警）
 */
import { describe, expect, it } from 'bun:test';
import {
  extractKeyEntities,
  measureRetention,
  mergeRetention,
  MAX_MISSING_REPORTED,
} from '../../src/context/compaction/retentionProbe.js';

describe('M5 extractKeyEntities — 确定性抽取', () => {
  it('命中各类高价值实体（路径 / URL / 环境变量 / snake_case / camelCase / 带单位数值）', () => {
    const entities = extractKeyEntities(
      '修改 app/src/ai/router/TaskDecomposer.ts，参考 https://example.com/doc，' +
        '读取 API_KEY_2，调用 snake_case_name 与 camelCaseName，耗时 300s（87%）'
    );
    expect(entities.has('app/src/ai/router/TaskDecomposer.ts')).toBe(true);
    expect(entities.has('https://example.com/doc')).toBe(true);
    expect(entities.has('API_KEY_2')).toBe(true);
    expect(entities.has('snake_case_name')).toBe(true);
    expect(entities.has('camelCaseName')).toBe(true);
    expect(entities.has('300s')).toBe(true);
    expect(entities.has('87%')).toBe(true);
  });

  it('剥离尾部标点（URL 后的逗号不并入 token）', () => {
    const entities = extractKeyEntities('见 https://example.com/doc, 然后');
    expect(entities.has('https://example.com/doc')).toBe(true);
  });

  it('去重', () => {
    const entities = extractKeyEntities('alpha_beta alpha_beta alpha_beta');
    expect(entities.size).toBe(1);
  });

  it('空串 / 无可辨识实体 ⇒ 空集（不抛错）', () => {
    expect(extractKeyEntities('').size).toBe(0);
    expect(extractKeyEntities('a b c').size).toBe(0); // 短于 MIN_ENTITY_LENGTH
  });
});

describe('M5 measureRetention — 保留度度量', () => {
  it('原文无实体 ⇒ total=0 且 ratio=1（视为无损，不制造假告警）', () => {
    const r = measureRetention('a b c', 'whatever');
    expect(r.total).toBe(0);
    expect(r.ratio).toBe(1);
  });

  it('全部保留 ⇒ ratio=1，missing 为空', () => {
    const r = measureRetention('调用 snake_case_name', '调用 snake_case_name');
    expect(r.total).toBe(1);
    expect(r.retained).toBe(1);
    expect(r.ratio).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it('全部丢失 ⇒ ratio=0 且 missing 列出', () => {
    const r = measureRetention('调用 snake_case_name 与 camelCaseName', '无');
    expect(r.ratio).toBe(0);
    expect(r.missing.sort()).toEqual(['camelCaseName', 'snake_case_name']);
  });

  it('部分保留 ⇒ ratio = retained / total', () => {
    const r = measureRetention(
      'snake_case_name camelCaseName',
      'snake_case_name'
    );
    expect(r.total).toBe(2);
    expect(r.retained).toBe(1);
    expect(r.ratio).toBe(0.5);
    expect(r.missing).toEqual(['camelCaseName']);
  });

  it('missing 上报有上限（防日志爆量）', () => {
    const src = Array.from({ length: 50 }, (_, i) => `entity_name_${i}`).join(
      ' '
    );
    const r = measureRetention(src, '');
    expect(r.total).toBe(50);
    expect(r.missing.length).toBe(MAX_MISSING_REPORTED);
  });
});

describe('M5 mergeRetention — 跨批聚合', () => {
  it('按实体总量加权（非各批 ratio 的算术平均）', () => {
    // 小批全丢（1/1）+ 大批全留（9/9）⇒ 加权 9/10=0.9（算术平均会是 0.5）
    const merged = mergeRetention([
      { total: 1, retained: 0, ratio: 0, missing: ['lost_one'] },
      { total: 9, retained: 9, ratio: 1, missing: [] },
    ]);
    expect(merged.total).toBe(10);
    expect(merged.retained).toBe(9);
    expect(merged.ratio).toBeCloseTo(0.9, 5);
    expect(merged.missing).toEqual(['lost_one']);
  });

  it('全部批次 total=0 ⇒ ratio=1（不适用，不告警）', () => {
    const merged = mergeRetention([
      { total: 0, retained: 0, ratio: 1, missing: [] },
    ]);
    expect(merged.total).toBe(0);
    expect(merged.ratio).toBe(1);
  });

  it('空数组 ⇒ ratio=1', () => {
    expect(mergeRetention([]).ratio).toBe(1);
  });
});
