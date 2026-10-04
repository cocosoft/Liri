// MIT License
// Copyright (c) 2026 190615273@qq.com

// ToolResultPersister — 工具结果二级防御（上下文侧 spill + 持久化侧同口径改写）测试
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  prepareToolResultsForContext,
  shrinkToolResultMessageForPersistence,
  SINGLE_RESULT_LIMIT_CHARS,
  PREVIEW_CHARS,
} from '../../src/tools/services/ToolResultPersister';

// 用 **LIRI_DATA_DIR**（`core/paths.ts` 唯一识别的覆盖变量）指向临时目录，避免污染 ~/.pyapp/data/
// ⚠️ 原写 `PYAPP_DATA_DIR` —— 该变量**不被 `core/paths.ts` 识别**（见 project_rules §1.13
// 「按文档配置会静默失效」）⇒ 隔离静默失效，测试产物此前写进了真实 `~/.pyapp/data/tool-results/`。
const tmpDataDir = join(tmpdir(), `tool-result-test-${Date.now()}`);
const origDataDir = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  process.env.LIRI_DATA_DIR = tmpDataDir;
});
afterAll(() => {
  if (origDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = origDataDir;
});

function makeResult(id: string, content: string) {
  // D-239（2026-10-02）订正：契约是 **chat 域**形态（载荷在 `result`）—— 与唯一生产调用方
  // `ReActToolLoop.processedResults`（来源于 `ToolExecutionService._executeInternal` 的
  // `result: toolResult.data`）及消费方 `_buildToolRoundMessages` / `createToolResultMessage`
  // **同字段**。⚠️ 此前该 fixture 用 `{ data }`（tools 域）⇒ **单测形态 ≠ 生产形态**，
  // 掩盖了 B2-c 引入的「二级/三级防御整体空转」（D-239）。
  return {
    normalizedToolCall: { id, name: 'testTool' },
    result: {
      result: content,
      error: undefined,
      metadata: {} as Record<string, unknown>,
    },
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

describe('shrinkToolResultMessageForPersistence — 持久化侧同口径改写（D-240 形态订正）', () => {
  const big = 'y'.repeat(SINGLE_RESULT_LIMIT_CHARS + 1000);
  const block = (id: string, value: string) => ({
    type: 'tool_result',
    value,
    toolCallId: id,
  });

  it('内存活形态 ContentBlock[]（生产形态）：落盘 + 块值替换为 preview + 引用文案', async () => {
    const content = [block('c-blk', JSON.stringify(big))];
    const r = await shrinkToolResultMessageForPersistence({
      id: 'm-blk',
      // 生产实况：`Message.toolCallId` 为顶层字段 ⇒ 落盘文件名须与上下文侧 `normalizedToolCall.id` 同名
      toolCallId: 'c-blk',
      content,
      metadata: {},
    });
    expect(r.changed).toBe(true);
    expect(r.toolResultPath).toContain('tool-results');
    expect(r.toolResultPath?.endsWith('c-blk.txt')).toBe(true);
    expect(r.toolResultFullChars).toBe(big.length);
    const out = r.content as Array<{ value: string }>;
    expect(out[0]!.value.length).toBeLessThan(big.length);
    expect(out[0]!.value).toContain('完整内容已保存到');
    // 预览取自**还原后的载荷**（不含 JSON 引号）—— 与上下文侧 preview 同口径
    expect(out[0]!.value.startsWith('yyy')).toBe(true);
  });

  it('字符串形态（历史/JSONL）：仍可改写', async () => {
    const content = JSON.stringify([block('c-str', JSON.stringify(big))]);
    const r = await shrinkToolResultMessageForPersistence({
      id: 'm-str',
      content,
      metadata: { toolCallId: 'c-str' },
    });
    expect(r.changed).toBe(true);
    expect(typeof r.content).toBe('string');
    expect(r.content as string).toContain('完整内容已保存到');
  });

  it('未超限 / 已含引用文案：原样返回（零开销 + 幂等）', async () => {
    const small = [
      block('c-small', JSON.stringify('small')),
      { type: 'text', value: 'z'.repeat(SINGLE_RESULT_LIMIT_CHARS + 100) },
    ];
    const r1 = await shrinkToolResultMessageForPersistence({
      id: 'm-small',
      content: small,
      metadata: { toolCallId: 'c-small' },
    });
    expect(r1.changed).toBe(false);
    expect(r1.content).toBe(small);

    const done = [
      block(
        'c-done',
        'y'.repeat(PREVIEW_CHARS) +
          '[工具结果超出上下文预算，完整内容已保存到 p]'
      ),
    ];
    const r2 = await shrinkToolResultMessageForPersistence({
      id: 'm-done',
      content: done,
      metadata: { toolCallId: 'c-done' },
    });
    expect(r2.changed).toBe(false);
  });
});

describe('shrinkToolResultMessageForPersistence — 持久化侧单轮聚合（P0-3 / D-238 第1条）', () => {
  const msgOf = (id: string, n: number) => ({
    id: `m-${id}`,
    toolCallId: id,
    content: [
      { type: 'tool_result', value: JSON.stringify('x'.repeat(n)), toolCallId: id },
    ],
    metadata: {} as Record<string, unknown>,
  });

  it('轮内累计超 TURN_BUDGET_CHARS ⇒ 后续单条未超限者也被 spill', async () => {
    const turnAcc = { chars: 0 };
    // 4 条各 45,000（单条 ≤ 50,000）⇒ 累计 180,000 ≤ 200,000 ⇒ 均不改写
    for (let i = 0; i < 4; i++) {
      const r = await shrinkToolResultMessageForPersistence(
        msgOf(`c-p0-${i}`, 45_000),
        { turnAcc }
      );
      expect(r.changed).toBe(false);
    }
    expect(turnAcc.chars).toBe(180_000);
    // 第 5 条 ⇒ 累计 225,000 > 200,000 ⇒ 强制 spill（单条仍 ≤ 50,000）
    const r5 = await shrinkToolResultMessageForPersistence(
      msgOf('c-p0-4', 45_000),
      { turnAcc }
    );
    expect(r5.changed).toBe(true);
    expect(r5.toolResultPath).toBeTruthy();
    expect(turnAcc.chars).toBe(225_000);
  });

  it('未传 turnAcc ⇒ 与历史一致：单条 ≤ 阈值不改写（零回归）', async () => {
    const r = await shrinkToolResultMessageForPersistence(
      msgOf('c-noacc', 45_000)
    );
    expect(r.changed).toBe(false);
  });
});
