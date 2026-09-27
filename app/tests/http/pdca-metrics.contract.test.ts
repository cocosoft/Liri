// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GET /v1/tasks/pdca/metrics 契约测试（S1 灰度观测，P1-5 §5 S1）
 * 验证响应包含 tasks[]（每任务 taskId + metrics）与 total（PdcaMetrics 9 字段聚合）。
 */
import { describe, expect, test } from 'bun:test';
import type http from 'http';
import { getOrCreateOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';

// 动态加载被测 handler（静态 import 会被 ESM import 提升提前解析）
const { handlePdcaMetrics } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

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

const req = {} as http.IncomingMessage;

/** PdcaMetrics 全字段（与 LongRunningTaskOrchestrator.PdcaMetrics 一致） */
const METRIC_KEYS = [
  'totalCycles',
  'totalSteps',
  'completedSteps',
  'failedSteps',
  'avgStepDurationMs',
  'avgReviewScore',
  'reviewPassRate',
  'toolFailureSteps',
  'abortRate',
] as const;

describe('GET /v1/tasks/pdca/metrics 契约', () => {
  test('返回 tasks[] + total 全指标字段（PdcaMetrics 9 字段）', async () => {
    getOrCreateOrchestrator('contract-test-task');

    const created = createRes();
    await handlePdcaMetrics(req, created.res);

    expect(created.status).toBe(200);
    const json = JSON.parse(created.body) as {
      tasks: Array<{ taskId: string; metrics: Record<string, number> }>;
      total: Record<string, number>;
    };

    // tasks[]：种子 orchestrator 已登记
    expect(Array.isArray(json.tasks)).toBe(true);
    expect(json.tasks.some((t) => t.taskId === 'contract-test-task')).toBe(
      true
    );

    // total：9 个指标字段齐备且为数值
    for (const key of METRIC_KEYS) {
      expect(json.total).toHaveProperty(key);
      expect(typeof json.total[key]).toBe('number');
    }
    // 2026-09-26（macOS CI 实测 `Expected: 0 / Received: 2`）：原断言 `json.total.totalSteps === 0`
    // 依赖**全局聚合**，而 orchestrator 注册表是**进程级单例** ⇒ 其他用例泄漏进来的任务会让它非 0。
    // 改为**按本用例任务**断言（与执行顺序解耦）——本用例的意图本就是"该任务未建 plan ⇒ 步骤 0"。
    const mine = json.tasks.find((t) => t.taskId === 'contract-test-task');
    expect(mine).toBeDefined();
    expect(mine?.metrics.totalSteps).toBe(0); // 未建 plan，步骤为 0
  });
});
