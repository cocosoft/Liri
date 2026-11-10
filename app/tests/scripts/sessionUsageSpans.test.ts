// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * §14.4 落地（2026-11-10）：单会话「工具面变化前后」请求级用量对比。
 *
 * 这些用例只锁**纯函数**（不读磁盘）：事件流 → 用量样本 / 工具面快照 → 分组统计 → 相邻差值。
 * 口径要点：
 * - 只认 `metric/timing` 且 `stage='request'` 且带真实 token 的记录；
 * - 工具面 = `context/model-input.tools.count`（含 `toolsRefSeq` 引用式去重的回溯）；
 * - 边界 = `tool_search` 之后的第一个工具面变化 > 首个变化 > `tool_search` 本身；
 * - 缺样本/缺字段一律如实记录在 `notes`，不用 0 或估算顶替（CS06）。
 */
import { describe, it, expect } from 'bun:test';
import type { LiriEvent } from '@modules/session/types/events';
import {
  buildSessionUsageReport,
  extractRequestUsages,
  extractSurfacePoints,
  findFirstToolSearch,
  formatReport,
  surfaceChanges,
} from '../../scripts/report-session-usage';

type Ev = { type: string; data?: Record<string, unknown> };

/** 造事件（seq 决定顺序；time 仅用于区间展示） */
function ev(seq: number, spec: Ev): LiriEvent {
  return {
    type: spec.type,
    seq,
    time: 1_700_000_000_000 + seq,
    sessionId: 'sess-usage-test',
    ...(spec.data ? { data: spec.data } : {}),
  } as unknown as LiriEvent;
}

function requestStart(seq: number, turn?: number): LiriEvent {
  return ev(seq, { type: 'request/start', data: turn ? { turn } : {} });
}

function usage(
  seq: number,
  inputTokens: number | undefined,
  outputTokens?: number,
  requestId?: number
): LiriEvent {
  return ev(seq, {
    type: 'metric/timing',
    data: {
      stage: 'request',
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    },
  });
}

function toolSearch(seq: number, query = 'select:broadcast'): LiriEvent {
  return ev(seq, {
    type: 'assistant/tool_call',
    data: { toolCallId: `c${seq}`, name: 'tool_search', args: { query } },
  });
}

function modelInput(seq: number, count: number): LiriEvent {
  return ev(seq, {
    type: 'context/model-input',
    data: { tools: { hash: `h${count}`, count, schemas: [] } },
  });
}

function modelInputRef(seq: number, refSeq: number): LiriEvent {
  return ev(seq, {
    type: 'context/model-input',
    data: { toolsRefSeq: refSeq },
  });
}

describe('extractRequestUsages — 只收真实用量', () => {
  it('忽略延迟条（stage=request 无 token）与回合级（stage=assistant）', () => {
    const events = [
      requestStart(1, 1),
      ev(2, { type: 'metric/timing', data: { stage: 'request', ttfb: 120 } }),
      usage(3, 1000, 50, 1),
      ev(4, {
        type: 'metric/timing',
        data: { stage: 'assistant', duration: 900, inputTokens: 9999 },
      }),
    ];
    const samples = extractRequestUsages(events);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      requestId: 1,
      seq: 3,
      inputTokens: 1000,
      outputTokens: 50,
      turn: 1,
    });
  });

  it('同一 requestId 多条完成事件 ⇒ 取 token 总量最大的一条', () => {
    const samples = extractRequestUsages([
      usage(10, 100, 10, 7),
      usage(11, 300, 20, 7),
    ]);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ seq: 11, inputTokens: 300 });
  });

  it('旧事件无 requestId ⇒ 以 seq 为键保留（不丢弃）', () => {
    const samples = extractRequestUsages([usage(21, 500), usage(22, 600)]);
    expect(samples.map((s) => s.requestId)).toEqual([null, null]);
    expect(samples.map((s) => s.seq)).toEqual([21, 22]);
  });
});

describe('extractSurfacePoints — 工具面快照', () => {
  it('直出 count 与 toolsRefSeq 回溯都能得到工具数', () => {
    const events = [modelInput(1, 60), modelInputRef(5, 1), modelInput(9, 75)];
    expect(extractSurfacePoints(events)).toEqual([
      { seq: 1, time: 1_700_000_000_001, toolCount: 60 },
      { seq: 5, time: 1_700_000_000_005, toolCount: 60 },
      { seq: 9, time: 1_700_000_000_009, toolCount: 75 },
    ]);
  });

  it('既无 count 也无可解析的 refSeq ⇒ 不产快照点（不猜）', () => {
    const events = [
      modelInputRef(3, 999),
      ev(4, { type: 'context/model-input', data: {} }),
    ];
    expect(extractSurfacePoints(events)).toEqual([]);
  });

  it('surfaceChanges 只报相邻不同的变化点', () => {
    const points = extractSurfacePoints([
      modelInput(1, 60),
      modelInput(3, 60),
      modelInput(5, 75),
      modelInput(7, 75),
      modelInput(9, 68),
    ]);
    expect(surfaceChanges(points).map((c) => [c.seq, c.from, c.to])).toEqual([
      [5, 60, 75],
      [9, 75, 68],
    ]);
  });
});

describe('findFirstToolSearch — 补回意图信号', () => {
  it('取首个 tool_search 调用并带出 query；其他工具不算', () => {
    const events = [
      ev(3, {
        type: 'assistant/tool_call',
        data: { toolCallId: 'a', name: 'file_read', args: {} },
      }),
      toolSearch(5, 'select:broadcast'),
      toolSearch(9, 'select:other'),
    ];
    expect(findFirstToolSearch(events)).toEqual({
      seq: 5,
      time: 1_700_000_000_005,
      query: 'select:broadcast',
    });
  });

  it('从未调用 tool_search ⇒ null', () => {
    expect(findFirstToolSearch([requestStart(1, 1)])).toBeNull();
  });
});

describe('buildSessionUsageReport — 分组与差值', () => {
  it('有工具面快照 ⇒ 按首个变化分组，并给档位聚合', () => {
    const events = [
      modelInput(1, 60),
      requestStart(2, 1),
      usage(3, 1000, 100, 2),
      usage(4, 1100, 100),
      modelInput(5, 75),
      requestStart(6, 1),
      usage(7, 1300, 120, 6),
      usage(8, 1500, 120),
    ];
    const report = buildSessionUsageReport('sess-usage-test', events);
    expect(report.boundary).toMatchObject({
      seq: 5,
      source: 'tools',
      fromToolCount: 60,
      toToolCount: 75,
    });
    expect(report.before?.requests).toBe(2);
    expect(report.after?.requests).toBe(2);
    expect(report.perToolCount).toEqual([
      {
        toolCount: 60,
        requests: 2,
        input: { sum: 2100, mean: 1050, median: 1050 },
        output: { sum: 200, mean: 100, median: 100 },
      },
      {
        toolCount: 75,
        requests: 2,
        input: { sum: 2800, mean: 1400, median: 1400 },
        output: { sum: 240, mean: 120, median: 120 },
      },
    ]);
    expect(report.adjacent).toMatchObject({
      inputDelta: 200,
      inputDeltaPercent: 18.2,
      outputDelta: 20,
    });
  });

  it('tool_search 后才有工具面变化 ⇒ 边界取"之后的第一个变化"', () => {
    const events = [
      modelInput(1, 60),
      modelInput(3, 68), // 变化发生在 tool_search 之前（如任务面切换）⇒ 不作边界
      toolSearch(5),
      modelInput(6, 75),
      usage(7, 900, 10),
    ];
    const report = buildSessionUsageReport('sess-usage-test', events);
    expect(report.boundary).toMatchObject({
      seq: 6,
      source: 'tools',
      fromToolCount: 68,
      toToolCount: 75,
      query: 'select:broadcast',
    });
    expect(report.surfaceChanges.map((c) => c.seq)).toEqual([3, 6]);
  });

  it('无工具面快照但调用了 tool_search ⇒ 退化为按调用位置分组', () => {
    const events = [
      usage(2, 1000, 100, 1),
      toolSearch(5),
      usage(7, 1300, 120, 6),
    ];
    const report = buildSessionUsageReport('sess-usage-test', events);
    expect(report.boundary).toMatchObject({
      seq: 5,
      source: 'tool_search',
      fromToolCount: null,
      toToolCount: null,
    });
    expect(report.before?.requests).toBe(1);
    expect(report.after?.requests).toBe(1);
    expect(report.adjacent).toMatchObject({
      inputDelta: 300,
      inputDeltaPercent: 30,
    });
  });

  it('既无变化也无 tool_search ⇒ 只给全会话基线并说明', () => {
    const events = [modelInput(1, 60), usage(2, 1000, 10), usage(4, 2000, 20)];
    const report = buildSessionUsageReport('sess-usage-test', events);
    expect(report.boundary).toBeNull();
    expect(report.before).toBeNull();
    expect(report.after).toBeNull();
    expect(report.adjacent).toBeNull();
    expect(report.baseline).toMatchObject({
      requests: 2,
      input: { sum: 3000, mean: 1500, median: 1500 },
      output: { sum: 30, mean: 15, median: 15 },
    });
    expect(report.notes.some((n) => n.includes('只给全会话基线'))).toBe(true);
  });

  it('完全没有用量样本 ⇒ 0 样本 + 明确说明（不造数）', () => {
    const report = buildSessionUsageReport('sess-usage-test', [toolSearch(3)]);
    expect(report.totalRequests).toBe(0);
    expect(report.before).toBeNull();
    expect(report.after).toBeNull();
    expect(report.adjacent).toBeNull();
    expect(
      report.notes.some((n) => n.includes('没有可用的请求级用量事件'))
    ).toBe(true);
  });

  it('边界前无样本 ⇒ before=null 且说明；相邻对比不成立', () => {
    const events = [toolSearch(3), usage(5, 900, 10, 4)];
    const report = buildSessionUsageReport('sess-usage-test', events);
    expect(report.before).toBeNull();
    expect(report.after?.requests).toBe(1);
    expect(report.adjacent).toBeNull();
    expect(report.notes.some((n) => n.includes('边界前没有用量样本'))).toBe(
      true
    );
  });

  it('边界前没有带 input 的样本 ⇒ 不给相邻对比（不拿 0 冒充）', () => {
    const events = [usage(2, undefined, 20), toolSearch(5), usage(7, 1500, 30)];
    expect(
      buildSessionUsageReport('sess-usage-test', events).adjacent
    ).toBeNull();
  });

  it('formatReport 输出分组、工具面变化、档位聚合与限制说明', () => {
    const events = [
      modelInput(1, 60),
      usage(2, 1000, 100, 1),
      modelInput(5, 75),
      usage(7, 1300, 120, 6),
    ];
    const text = formatReport(buildSessionUsageReport('sess-x', events));
    expect(text).toContain('会话 sess-x');
    expect(text).toContain('工具面变化');
    expect(text).toContain('seq 5：工具 60 → 75（+15）');
    expect(text).toContain('之前：请求 1 次');
    expect(text).toContain('之后：请求 1 次');
    expect(text).toContain('工具 60 个');
    expect(text).toContain('输入 +300（+30%）');
    expect(text).toContain('口径与限制');
  });
});
