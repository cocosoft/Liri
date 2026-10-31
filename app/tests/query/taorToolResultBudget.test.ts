/**
 * TAOR 工具结果入上下文前的体积闸（2026-10-31）
 *
 * 背景：TAOR/LRO 批处理路径此前把工具结果**全量** `JSON.stringify` 进 messages，
 * 真机 `pdca_*` 大结果撑爆上下文（溢出 400）。本闸复用 chat 侧 `ToolResultPersister`，
 * 语义：超单条/单轮预算 ⇒ 落盘 `tool-results/<toolCallId>.txt` + 上下文留安全预览与路径引用。
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { shrinkOversizedRawResults } from '../../src/query/taor/toolResultBudget';
import {
  SINGLE_RESULT_LIMIT_CHARS,
  PREVIEW_CHARS,
} from '../../src/tools/services/ToolResultPersister';

// 用 **LIRI_DATA_DIR**（`core/paths.ts` 唯一识别的覆盖变量）指向临时目录，避免污染 ~/.pyapp/data/
const tmpDataDir = join(tmpdir(), `taor-result-budget-${Date.now()}`);
const origDataDir = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  process.env.LIRI_DATA_DIR = tmpDataDir;
});
afterAll(() => {
  if (origDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = origDataDir;
});

type Raw = {
  toolCallId?: string;
  result?: unknown;
  metadata?: { toolResultPath?: string; toolResultFullChars?: number };
};

const call = (id: string) => ({ id, name: 'file_read' });

describe('shrinkOversizedRawResults — 工具结果体积闸', () => {
  it('小结果原样保留（引用未变，零开销）', async () => {
    const raw = {
      toolCallId: 'c-small',
      result: { success: true, content: 'ok' },
    };
    const rawResults: Array<Raw | undefined> = [raw];
    await shrinkOversizedRawResults(rawResults, [call('c-small')]);

    expect(rawResults[0]).toBe(raw);
    expect((rawResults[0] as Raw).result).toEqual({
      success: true,
      content: 'ok',
    });
  });

  it('单条超限 ⇒ 落盘 + 结果替换为预览与路径引用', async () => {
    const big = 'x'.repeat(SINGLE_RESULT_LIMIT_CHARS + 5_000);
    const rawResults: Array<Raw | undefined> = [
      { toolCallId: 'c-big', result: { success: true, content: big } },
    ];
    await shrinkOversizedRawResults(rawResults, [call('c-big')]);

    const replaced = rawResults[0] as Raw;
    const preview = replaced.result as string;
    expect(typeof preview).toBe('string');
    expect(preview.length).toBeGreaterThan(PREVIEW_CHARS);
    expect(preview.length).toBeLessThan(big.length);
    expect(preview).toContain('完整内容已保存到');
    expect(preview).toContain('read_file');

    const path = replaced.metadata?.toolResultPath;
    expect(path).toContain('tool-results');
    // 落盘内容 = **完整**原始载荷（JSON 形态），供模型 read_file 回读
    const saved = await readFile(path as string, 'utf8');
    expect(saved).toContain(big);
    expect(replaced.metadata?.toolResultFullChars).toBe(saved.length);
  });

  it('单轮聚合超限 ⇒ 各条均低于单条预算也被 spill', async () => {
    const per = 45_000;
    const rawResults: Array<Raw | undefined> = Array.from(
      { length: 5 },
      (_, i) => ({
        toolCallId: `c-agg-${i}`,
        result: { success: true, content: `${i}`.repeat(per) },
      })
    );
    await shrinkOversizedRawResults(
      rawResults,
      Array.from({ length: 5 }, (_, i) => call(`c-agg-${i}`))
    );

    // 5×45K = 225K > 200K 单轮预算（chat 侧同口径）
    expect((rawResults[0] as Raw).result as string).toContain(
      '完整内容已保存到'
    );
    expect((rawResults[4] as Raw).result as string).toContain(
      '完整内容已保存到'
    );
  });

  it('空结果数组不报错（无工具调用轮）', async () => {
    const rawResults: Array<Raw | undefined> = [];
    await shrinkOversizedRawResults(rawResults, []);
    expect(rawResults).toHaveLength(0);
  });
});
