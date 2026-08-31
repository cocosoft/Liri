// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GoalMetricsService 落库测试（S2，P1-5 §5 S2 + StageOrchestrator §4.6）
 * 验证两类行类型（不互踩字段）：
 *   - goal_metrics：row_type='stage'，含 stage_id（stage 粒度）
 *   - usage_records：会话 usage 行（message 粒度，avgTokenCostPerTask 数据源）
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GoalMetricsService } from '../../src/tasks/db/GoalMetricsService';

const dbPath = join(tmpdir(), `goal-metrics-test-${Date.now()}.db`);
const svc = new GoalMetricsService(dbPath);

afterAll(() => {
  try {
    rmSync(dbPath, { force: true });
  } catch {
    /* 清理失败不阻断 */
  }
});

describe('GoalMetricsService — S2 两类行类型落库', () => {
  test('stage 粒度：goal_metrics 写入 row_type=stage 且含 stage_id', async () => {
    await svc.init();
    await svc.recordStageMetric({
      goalId: 'goal-test-1',
      sessionId: 'session-a',
      stageId: 'execute',
      maxTurns: 20,
      totalTurns: 3,
      totalTokens: 1200,
      durationMs: 5000,
    });

    const rows = await svc.queryStageMetrics('goal-test-1');
    expect(rows.length).toBe(1);
    expect(rows[0].goalId).toBe('goal-test-1');
    expect(rows[0].rowType).toBe('stage');
    expect(rows[0].stageId).toBe('execute');
    expect(rows[0].totalTokens).toBe(1200);
    expect(rows[0].totalTurns).toBe(3);
    // P1-2（2026-08-31）：turn 预算上限落库
    expect(rows[0].maxTurns).toBe(20);
  });

  test('message 粒度：usage_records 写入会话 usage 行', async () => {
    await svc.recordMessageUsage({
      sessionId: 'session-a',
      totalTokens: 800,
      costEstimated: 0.012,
      durationMs: 3000,
    });

    const rows = await svc.queryMessageUsage('session-a');
    expect(rows.length).toBe(1);
    expect(rows[0].sessionId).toBe('session-a');
    expect(rows[0].totalTokens).toBe(800);
    expect(rows[0].costEstimated).toBe(0.012);
  });

  test('两类行类型互不干扰（不互踩字段）', async () => {
    const stages = await svc.queryStageMetrics('goal-test-1');
    const usages = await svc.queryMessageUsage('session-a');
    // stage 行只出现在 goal_metrics，message 行只出现在 usage_records
    expect(stages.some((s) => s.stageId === 'execute')).toBe(true);
    expect(usages.length).toBe(1);
    expect(usages[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
