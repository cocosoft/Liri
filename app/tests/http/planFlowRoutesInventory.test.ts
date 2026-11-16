// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// plan-flow 路由清单守卫（P3-2，2026-11-16）
//
// `dispatchPlanFlowRoutes` 是「顺序即语义」的路由表：`/v1/pdca/decisions` 必须先于
// `/v1/pdca/:taskId` 详情（否则决策日志会被当成 taskId）；写反不会编译失败，只会静默错配。
// 本表用「每个 handler 只调用一次 + 源码内调用顺序」钉住外移前后的等价性。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/plan-flow-routes.ts',
    import.meta.url
  ),
  'utf8'
);

/** 源码内的调用顺序（与匹配顺序一一对应） */
const CALL_ORDER = [
  // Plans & Flows
  'handleListPlans',
  'handleCreatePlan',
  'handleGetPlanDAG',
  'handleGetPlan',
  'handleExecutePlan',
  'handleAbortPlan',
  'handleListFlows',
  'handleListPatterns',
  'handleExportPatternCatalog',
  'handleGetFlow',
  // PDCA
  'handlePdcaStart',
  'handleResearchStart',
  'handlePdcaDecisionLog',
  'handlePdcaAbortTask',
  'handlePdcaResumeTask',
  'handlePdcaStatus',
  'handlePdcaAudit',
  'handlePdcaConfirm',
  'handlePdcaReviewStep',
  'handlePdcaDecideStep',
  'handlePdcaList',
  'handlePdcaMetrics',
  // Kanban
  'handleKanbanList',
  'handleKanbanCreate',
  'handleKanbanUpdate',
  'handleKanbanDelete',
  'handleKanbanMove',
] as const;

describe('plan-flow 路由清单', () => {
  it('27 个 handler 各被调用一次（漏项 = 路由丢失）', () => {
    for (const handler of CALL_ORDER) {
      expect(ROUTES.split(`await ${handler}(`).length - 1).toBe(1);
    }
  });

  it('调用顺序与匹配顺序一致（顺序即语义）', () => {
    const positions = CALL_ORDER.map((h) => ROUTES.indexOf(`await ${h}(`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('决策日志先于 PDCA 任务详情（否则 decisions 被当成 taskId）', () => {
    const decisions = ROUTES.indexOf('/v1/pdca/decisions');
    const detail = ROUTES.indexOf('/^\\/v1\\/pdca\\/([^/]+)$/');
    expect(decisions).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(-1);
    expect(decisions).toBeLessThan(detail);
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
