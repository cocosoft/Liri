// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 分析面板载荷特征化（P3-2，2026-11-16）
//
// `handleAnalyticsDashboard` 的复杂度来自「事件分类 → 四组聚合 → 持久化优先回退内存」
// 串在一个处理器里。判错只表现为「面板某项恒为 0 / 取错数据源」（不报错）
// ⇒ 外移聚合段前先把每项的可见取值来源钉住。
//
// 聚合段已外移为纯函数（categorizeEvents / buildTopTools / buildTopErrors /
// collectLatencies / sumModelUsage / buildDashboardPayload）⇒ 直接对纯函数断言，
// **不桩全局模块**（Bun 的模块级 mock 进程级不可撤销，会污染后续测试文件）。
// 处理器本体只锁两条与持久化无关的路径：依赖缺失、聚合抛错。

import { describe, expect, it } from 'bun:test';
import http from 'node:http';
import {
  buildDashboardPayload,
  buildTopErrors,
  buildTopTools,
  categorizeEvents,
  collectLatencies,
  handleAnalyticsDashboard,
  setAnalyticsDependencies,
  sumModelUsage,
  type DashboardTotals,
} from '../../src/infrastructure/http/handlers/analytics-handlers';

const EMPTY_STATS = { totalEvents: 0, totalSessions: 0, activeSessions: 0 };
const EMPTY_TOOL_CALL_STATS = {
  totalCalls: 0,
  uniqueTools: 0,
  topTools: [] as Array<{ name: string; count: number }>,
};
const NULL_PERSISTED = {
  toolStats: null,
  errorStats: null,
  latencyStats: null,
  sessionCount: null,
};

const EVENTS = [
  { type: 'tool_call', metadata: { tool_name: 'file_read' } },
  { type: 'tool_result', name: 'file_read' },
  { type: 'tool_execute', metadata: { toolName: 'bash' } },
  { type: 'error', metadata: { errorType: 'API_ERROR' } },
  { type: 'api_error', name: 'RATE_LIMIT' },
  { type: 'performance', metadata: { metricValue: 100 } },
  { type: 'performance', metadata: { metricValue: 300 } },
  { type: 'performance', metadata: { metricValue: 0 } },
  { type: 'llm_request' },
  { type: 'query_complete' },
];

describe('事件分类', () => {
  it('按类型分四组：工具 3 / 错误 2 / 性能 3 / LLM 2', () => {
    const c = categorizeEvents(EVENTS);
    expect(c.toolEvents).toHaveLength(3);
    expect(c.errorEvents).toHaveLength(2);
    expect(c.perfEvents).toHaveLength(3);
    expect(c.llmEvents).toHaveLength(2);
  });

  it('无关事件不落入任何分组', () => {
    const c = categorizeEvents([{ type: 'other' }, { name: 'no-type' }]);
    expect(c.toolEvents).toEqual([]);
    expect(c.errorEvents).toEqual([]);
    expect(c.perfEvents).toEqual([]);
    expect(c.llmEvents).toEqual([]);
  });
});

describe('工具统计', () => {
  it('按名聚合（兼容 tool_name / toolName / name 三种埋点），降序输出', () => {
    const { topTools, uniqueCount } = buildTopTools(
      categorizeEvents(EVENTS).toolEvents
    );
    expect(uniqueCount).toBe(2);
    expect(topTools).toEqual([
      { name: 'file_read', count: 2 },
      { name: 'bash', count: 1 },
    ]);
  });

  it('缺名事件归入 unknown；前 10 条截断但 uniqueCount 保留全量', () => {
    const events = [
      ...Array.from({ length: 12 }, (_, i) => ({
        type: 'tool_call',
        name: `tool_${i}`,
      })),
      { type: 'tool_call' },
    ];
    const { topTools, uniqueCount } = buildTopTools(events);
    expect(topTools).toHaveLength(10);
    expect(uniqueCount).toBe(13);
    expect(topTools.some((t) => t.name === 'unknown')).toBe(false);
  });

  it('空输入 ⇒ 空列表与 0', () => {
    expect(buildTopTools([])).toEqual({ topTools: [], uniqueCount: 0 });
  });
});

describe('错误统计', () => {
  it('按类型聚合（兼容 errorType / name），降序输出', () => {
    const errors = buildTopErrors(categorizeEvents(EVENTS).errorEvents);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.count === 1)).toBe(true);
    expect(errors.map((e) => e.type).sort()).toEqual([
      'API_ERROR',
      'RATE_LIMIT',
    ]);
  });

  it('缺类型事件归入 unknown', () => {
    expect(buildTopErrors([{ type: 'error' }])).toEqual([
      { type: 'unknown', count: 1 },
    ]);
  });
});

describe('延迟样本', () => {
  it('仅取正数、升序；无性能服务时只有事件值', () => {
    expect(collectLatencies(EVENTS, null)).toEqual([100, 300]);
  });

  it('性能监控服务的时长并入并重排', () => {
    const perfService = {
      getInstance: () => ({
        getAllMetrics: () => [
          { duration: 50 },
          { duration: 0 },
          { duration: 200 },
        ],
      }),
    };
    expect(collectLatencies(EVENTS, perfService)).toEqual([50, 100, 200, 300]);
  });

  it('服务无正数时长时不改动样本', () => {
    const perfService = {
      getInstance: () => ({ getAllMetrics: () => [{ duration: 0 }] }),
    };
    expect(collectLatencies([], perfService)).toEqual([]);
  });
});

describe('Token / 成本合计', () => {
  it('按模型累加输入 / 输出 / 成本 / 请求数', () => {
    const totals = sumModelUsage({
      'model-a': {
        inputTokens: 100,
        outputTokens: 50,
        costUSD: 0.5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        requestCount: 3,
      },
      'model-b': {
        inputTokens: 20,
        outputTokens: 10,
        costUSD: 0.25,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        requestCount: 2,
      },
    });
    expect(totals).toEqual({
      totalInputTokens: 120,
      totalOutputTokens: 60,
      totalCostUSD: 0.75,
      totalRequests: 5,
    });
  });

  it('requestCount 缺省按 0 计', () => {
    const totals = sumModelUsage({
      m: {
        inputTokens: 1,
        outputTokens: 1,
        costUSD: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        requestCount: 0,
      },
    });
    expect(totals.totalRequests).toBe(0);
  });
});

describe('面板载荷：持久化不可用 ⇒ 回退内存聚合', () => {
  const totals: DashboardTotals = {
    totalInputTokens: 120,
    totalOutputTokens: 60,
    totalCostUSD: 0.75,
    totalRequests: 5,
  };
  const baseInput = {
    totals,
    llmEventCount: 2,
    toolEventCount: 3,
    errorEventCount: 2,
    totalEventCount: 10,
    uniqueToolCount: 2,
    topTools: [
      { name: 'file_read', count: 2 },
      { name: 'bash', count: 1 },
    ],
    topErrors: [
      { type: 'API_ERROR', count: 1 },
      { type: 'RATE_LIMIT', count: 1 },
    ],
    latencies: [100, 300],
    toolCallStats: EMPTY_TOOL_CALL_STATS,
    persisted: NULL_PERSISTED,
    stats: { totalEvents: 10, totalSessions: 2, activeSessions: 1 },
  };

  it('tokens / cost：来自 costTracker 合计，请求数优先事件条数', () => {
    const payload = buildDashboardPayload(baseInput) as {
      tokens: Record<string, number>;
      cost: { totalCostUSD: number };
    };
    expect(payload.tokens).toEqual({
      totalInputTokens: 120,
      totalOutputTokens: 60,
      totalTokens: 180,
      totalLLMRequests: 2,
    });
    expect(payload.cost).toEqual({ totalCostUSD: 0.75 });
  });

  it('tools / errors：用内存事件条数与聚合列表', () => {
    const payload = buildDashboardPayload(baseInput) as {
      tools: { totalToolCalls: number; uniqueToolsUsed: number };
      errors: { totalErrors: number; errorRate: number };
    };
    expect(payload.tools.totalToolCalls).toBe(3);
    expect(payload.tools.uniqueToolsUsed).toBe(2);
    expect(payload.errors.totalErrors).toBe(2);
    // 2/10 事件 ⇒ 20%
    expect(payload.errors.errorRate).toBe(20);
  });

  it('performance / session：按样本算百分位与统计回退', () => {
    const payload = buildDashboardPayload(baseInput) as {
      performance: Record<string, number>;
      session: Record<string, number>;
    };
    expect(payload.performance).toEqual({
      averageLatencyMs: 200,
      p50LatencyMs: 100,
      p95LatencyMs: 300,
      p99LatencyMs: 300,
      totalMetrics: 2,
    });
    expect(payload.session).toEqual({
      totalEvents: 10,
      totalSessions: 2,
      activeSessions: 1,
    });
  });
});

describe('面板载荷：持久化可用 ⇒ 覆盖内存聚合', () => {
  it('四组统计均取持久化值（工具/错误/延迟/会话）', () => {
    const payload = buildDashboardPayload({
      totals: {
        totalInputTokens: 1,
        totalOutputTokens: 1,
        totalCostUSD: 0,
        totalRequests: 0,
      },
      llmEventCount: 0,
      toolEventCount: 3,
      errorEventCount: 2,
      totalEventCount: 10,
      uniqueToolCount: 2,
      topTools: [],
      topErrors: [],
      latencies: [100],
      toolCallStats: {
        totalCalls: 7,
        uniqueTools: 4,
        topTools: [{ name: 'mem', count: 7 }],
      },
      persisted: {
        toolStats: {
          totalToolCalls: 21,
          uniqueToolsUsed: 9,
          topTools: [{ name: 'db', count: 21 }],
        },
        errorStats: {
          totalCalls: 30,
          totalErrors: 5,
          errorRate: 16.67,
          topErrors: [{ type: 'DB_ERROR', count: 5 }],
        },
        latencyStats: {
          sampleCount: 40,
          averageLatencyMs: 123.45,
          p50LatencyMs: 100,
          p95LatencyMs: 400,
          p99LatencyMs: 900,
        },
        sessionCount: { total: 12, active: 3 },
      },
      stats: { totalEvents: 10, totalSessions: 2, activeSessions: 1 },
    }) as {
      tokens: Record<string, number>;
      tools: Record<string, unknown>;
      errors: Record<string, unknown>;
      performance: Record<string, number>;
      session: Record<string, number>;
    };

    // 无 LLM 事件 ⇒ 请求数回退 costTracker 合计（此处 0）
    expect(payload.tokens.totalLLMRequests).toBe(0);
    expect(payload.tools).toEqual({
      totalToolCalls: 21,
      uniqueToolsUsed: 9,
      topTools: [{ name: 'db', count: 21 }],
    });
    expect(payload.errors).toEqual({
      totalErrors: 5,
      errorRate: 16.67,
      topErrors: [{ type: 'DB_ERROR', count: 5 }],
    });
    expect(payload.performance).toEqual({
      averageLatencyMs: 123.45,
      p50LatencyMs: 100,
      p95LatencyMs: 400,
      p99LatencyMs: 900,
      totalMetrics: 40,
    });
    expect(payload.session).toEqual({
      totalEvents: 10,
      totalSessions: 12,
      activeSessions: 3,
    });
  });
});

type Captured = { status: number; body: Record<string, unknown> };

/** 最小 ServerResponse 替身：只记录 writeHead/end */
function makeRes(): { res: http.ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: {} };
  const res = {
    writeHead(status: number) {
      captured.status = status;
    },
    end(body: string) {
      captured.body = JSON.parse(body) as Record<string, unknown>;
    },
  } as unknown as http.ServerResponse;
  return { res, captured };
}

describe('处理器：与持久化无关的两条路径', () => {
  it('依赖缺失 ⇒ 200 + 空对象（不抛错）', async () => {
    setAnalyticsDependencies(null, null, null);
    const { res, captured } = makeRes();
    await handleAnalyticsDashboard(
      {} as never,
      {} as http.IncomingMessage,
      res
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({});
  });

  it('getEvents 抛错 ⇒ 200 + 全零载荷（不抛给调用方）', async () => {
    setAnalyticsDependencies(
      {
        getEvents: () => {
          throw new Error('boom');
        },
        getStats: () => EMPTY_STATS,
        getToolCallStats: () => EMPTY_TOOL_CALL_STATS,
      },
      {
        getTotalCostUSD: () => 0,
        getTotalInputTokens: () => 0,
        getTotalOutputTokens: () => 0,
        getModelUsage: () => ({}),
      },
      null
    );
    try {
      const { res, captured } = makeRes();
      await handleAnalyticsDashboard(
        {} as never,
        {} as http.IncomingMessage,
        res
      );
      expect(captured.status).toBe(200);
      expect(captured.body.tokens).toEqual({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalLLMRequests: 0,
      });
      expect(captured.body.tools).toEqual({
        totalToolCalls: 0,
        uniqueToolsUsed: 0,
        topTools: [],
      });
      expect(captured.body.session).toEqual({
        totalEvents: 0,
        totalSessions: 0,
        activeSessions: 0,
      });
      expect(typeof captured.body.generatedAt).toBe('number');
    } finally {
      setAnalyticsDependencies(null, null, null);
    }
  });
});
