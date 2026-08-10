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
 * GET /v1/background/status 字段契约测试（§9.3 P3 建议）
 * 防止聚合 API 字段结构回归（前端 BackgroundStatusPage 依赖固定字段）。
 *
 * 注意：不使用 mock.module（进程级副作用，bun 无法恢复，会污染同 worker 内其他
 * 测试文件，如 backgroundTaskEvent.test.ts 的 recordBackgroundTask 导入）。
 * 改用 spyOn(模块命名空间) + mockRestore，仅替换目标函数且可恢复。
 */

import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import * as dreamLogStore from '../../src/buddy/dreamLogStore';
import * as growthPersistence from '../../src/buddy/growthPersistence';
import * as backgroundTaskEvent from '../../src/monitoring/BackgroundTaskEvent';

// 命名空间 spy：替换目标函数，不破坏其他导出（recordBackgroundTask 等仍可用）
const dreamStatsSpy = spyOn(dreamLogStore, 'getDreamStats').mockImplementation(
  () =>
    ({
      totalRuns: 3,
      totalSkipped: 1,
      lastRunAt: 1786370000000,
    }) as never
);
const dreamLogsSpy = spyOn(dreamLogStore, 'getDreamLogs').mockImplementation(
  () => ({ logs: [{ ts: 1786370000000, phase: 'complete', note: 'ok' }] }) as never
);
const growthSpy = spyOn(
  growthPersistence,
  'loadGrowthState'
).mockImplementation(
  () =>
    ({
      totalCompleted: 2,
      totalSessions: 1,
      totalInsights: 4,
      consecutiveDays: 2,
      taskCompletionCount: 5,
      totalTaskExp: 50,
      unlockedAchievements: ['first'],
    }) as never
);
const taskLogSpy = spyOn(
  backgroundTaskEvent,
  'getBackgroundTaskLog'
).mockImplementation(
  () =>
    [
      {
        task: 'dream',
        phase: 'complete',
        startedAt: 1786370000000,
        durationMs: 1000,
      },
    ] as never
);

afterAll(() => {
  dreamStatsSpy.mockRestore();
  dreamLogsSpy.mockRestore();
  growthSpy.mockRestore();
  taskLogSpy.mockRestore();
});

// 动态加载被测 handler（静态 import 会被 ESM import 提升提前解析）
const { handleGetBackgroundStatus } = await import(
  '../../src/infrastructure/http/handlers/buddy-handlers'
);

function createRes(): {
  res: http.ServerResponse;
  body: string;
  status: number;
} {
  const out = { body: '', status: 0 };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get body() {
      return out.body;
    },
    get status() {
      return out.status;
    },
  };
}

const ctx = {
  sendError: (res: http.ServerResponse, _err: unknown) => {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'internal' }));
  },
} as unknown as HandlerCtx;

const req = {} as http.IncomingMessage;

describe('GET /v1/background/status 契约', () => {
  test('返回字段契约：dream.stats / dream.recentLogs / buddyGrowth.* / generatedAt', async () => {
    const created = createRes();
    await handleGetBackgroundStatus(ctx, req, created.res);
    expect(created.status).toBe(200);

    const data = JSON.parse(created.body) as Record<string, unknown>;
    // 顶层
    expect(typeof data.generatedAt).toBe('number');

    // dream 块
    expect(data.dream).toBeDefined();
    const dream = data.dream as Record<string, unknown>;
    const stats = dream.stats as Record<string, unknown>;
    expect(stats.totalRuns).toBe(3);
    expect(Array.isArray(dream.recentLogs)).toBe(true);
    const recentLogs = dream.recentLogs as Array<Record<string, unknown>>;
    expect(recentLogs[0].phase).toBe('complete');

    // buddyGrowth 块
    const g = data.buddyGrowth as Record<string, unknown>;
    expect(g.totalCompleted).toBe(2);
    expect(g.totalSessions).toBe(1);
    expect(g.totalInsights).toBe(4);
    expect(g.consecutiveDays).toBe(2);
    expect(g.taskCompletionCount).toBe(5);
    expect(g.totalTaskExp).toBe(50);
    expect(Array.isArray(g.unlockedAchievements)).toBe(true);

    // 统一后台任务事件（§9.3）
    expect(Array.isArray(data.tasks)).toBe(true);
    const tasks = data.tasks as Array<Record<string, unknown>>;
    expect(tasks[0].task).toBe('dream');
    expect(tasks[0].phase).toBe('complete');
  });

  test('依赖加载失败时返回 500 而非崩溃', async () => {
    // 临时让 getDreamStats 抛错，模拟依赖异常
    dreamStatsSpy.mockImplementation(() => {
      throw new Error('mock load failed');
    });
    const created = createRes();
    await handleGetBackgroundStatus(ctx, req, created.res);
    expect(created.status).toBe(500);

    // 恢复默认 mock，避免影响（若未来新增测试）
    dreamStatsSpy.mockImplementation(
      () =>
        ({
          totalRuns: 3,
          totalSkipped: 1,
          lastRunAt: 1786370000000,
        }) as never
    );
  });
});
