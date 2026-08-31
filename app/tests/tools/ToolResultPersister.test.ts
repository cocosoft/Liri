// MIT License
// Copyright (c) 2026 190615273@qq.com

// ToolResultPersister — 工具结果二级防御（落盘路径引用 + 单轮聚合 spill）测试
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  prepareToolResultsForContext,
  SINGLE_RESULT_LIMIT_CHARS,
  PREVIEW_CHARS,
} from '../../src/tools/services/ToolResultPersister';

// 用 PYAPP_DATA_DIR 指向临时目录，避免污染 ~/.pyapp/data/
const tmpDataDir = join(tmpdir(), `tool-result-test-${Date.now()}`);
const origDataDir = process.env.PYAPP_DATA_DIR;

beforeAll(() => {
  process.env.PYAPP_DATA_DIR = tmpDataDir;
});
afterAll(() => {
  if (origDataDir === undefined) delete process.env.PYAPP_DATA_DIR;
  else process.env.PYAPP_DATA_DIR = origDataDir;
});

function makeResult(id: string, content: string) {
  return {
    normalizedToolCall: { id, name: 'testTool' },
    result: { result: content, metadata: {} as Record<string, unknown> },
  };
}

describe('prepareToolResultsForContext — 工具结果二级防御', () => {
  it('小结果（不超单条/单轮预算）不落盘不替换', async () => {
    const items = [makeResult('c1', 'small content')];
    await prepareToolResultsForContext(items);
    expect(items[0]!.result.result).toBe('small content');
    expect(items[0]!.result.metadata?.toolResultPath).toBeUndefined();
  });

  it('单条超限：落盘 + 上下文替换为 preview + 路径引用', async () => {
    const big = 'x'.repeat(SINGLE_RESULT_LIMIT_CHARS + 1000);
    const items = [makeResult('c-big', big)];
    await prepareToolResultsForContext(items);

    const replaced = items[0]!.result.result as string;
    // preview 长度 + 路径引用通知，远小于原文
    expect(replaced.length).toBeLessThan(big.length);
    expect(replaced.length).toBeGreaterThan(PREVIEW_CHARS);
    expect(replaced).toContain('完整内容已保存到');
    expect(replaced).toContain('read_file');
    expect(items[0]!.result.metadata?.toolResultPath).toContain('tool-results');
    expect(items[0]!.result.metadata?.toolResultFullChars).toBe(big.length);
  });

  it('单轮聚合超限：spill 未持久化结果（各条均低于单条预算）', async () => {
    // 5 个 45K 结果：各自 < 50K 单条预算，但合计 225K > 200K 单轮预算 → 纯聚合 spill
    const items = Array.from({ length: 5 }, (_, i) =>
      makeResult(`c-agg-${i}`, `${i}`.repeat(45_000))
    );
    await prepareToolResultsForContext(items);

    expect(items[0]!.result.result as string).toContain('完整内容已保存到');
    expect(items[4]!.result.result as string).toContain('完整内容已保存到');
  });

  it('单轮聚合恰好未超限时不 spill', async () => {
    // 4 个 45K：合计 180K < 200K，各 < 50K → 不落盘
    const items = Array.from({ length: 4 }, (_, i) =>
      makeResult(`c-ok-${i}`, `${i}`.repeat(45_000))
    );
    await prepareToolResultsForContext(items);
    expect(items[0]!.result.metadata?.toolResultPath).toBeUndefined();
    expect(items[3]!.result.metadata?.toolResultPath).toBeUndefined();
  });
});
