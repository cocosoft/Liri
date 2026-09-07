import { describe, expect, test, beforeEach } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import { PitfallRegistry, normalizePitfallKey } from '@modules/tasks';

describe('PitfallRegistry（Teamwork P2b）', () => {
  let reg: PitfallRegistry;

  beforeEach(() => {
    reg = new PitfallRegistry(
      join(tmpdir(), `pitfall-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jsonl`)
    );
  });

  test('record 落盘后可检索（写入 → queryRecent 命中）', () => {
    reg.record({
      description: '写正文时误用 Markdown 表格嵌套',
      error: '表格嵌套导致渲染失败',
      source: 'pdl',
      contextSig: 'task-write',
    });
    const hits = reg.queryRecent({ source: 'pdl' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.rawDescription).toContain('表格');
    expect(hits[0]?.source).toBe('pdl');
  });

  test('验收 #5：同内容不重复写入（occurrenceCount 累计）', () => {
    reg.record({ description: '误用表格嵌套', error: 'err-a', source: 'pdl' });
    reg.record({ description: ' 误用表格嵌套 ', error: 'err-b', source: 'pdl' });
    expect(reg.count()).toBe(1);
    const hit = reg.queryRecent()[0];
    expect(hit?.occurrenceCount).toBe(2);
  });

  test('关键词粗筛 + limit 截断', () => {
    for (let i = 0; i < 8; i++) {
      reg.record({
        description: `候选 ${i} 缺引用来源`,
        error: '引用不足',
        source: 'verifier',
      });
    }
    reg.record({
      description: '另一个维度的问题',
      error: '维度偏差',
      source: 'pdl',
    });
    const kwHits = reg.queryRecent({ keyword: '引用' });
    expect(kwHits.every((e) => e.error.includes('引用'))).toBe(true);
    expect(reg.queryRecent({ keyword: '维度' })).toHaveLength(1);
    expect(reg.queryRecent({ limit: 3 })).toHaveLength(3);
  });

  test('normalizePitfallKey 折叠空白与大小写', () => {
    expect(normalizePitfallKey('  误用 表格 嵌套 ')).toBe('误用 表格 嵌套');
    expect(normalizePitfallKey('RAG Recall')).toBe('rag recall');
  });
});
