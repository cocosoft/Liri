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
const { handlePdcaMetrics } = await import(
  '../../src/infrastructure/http/handlers/pdca-handlers'
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
    expect(
      json.tasks.some((t) => t.taskId === 'contract-test-task')
    ).toBe(true);

    // total：9 个指标字段齐备且为数值
    for (const key of METRIC_KEYS) {
      expect(json.total).toHaveProperty(key);
      expect(typeof json.total[key]).toBe('number');
    }
    expect(json.total.totalSteps).toBe(0); // 未建 plan，步骤为 0
  });
});
