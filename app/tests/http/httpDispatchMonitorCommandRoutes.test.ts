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
 * `dispatchMonitorCommandRoutes` 的**路由接线与顺序**特征化测试（T3 复杂度清理前置，2026-11-17）。
 *
 * 目的：把该分发的既有行为钉住，供后续按领域拆分（圈复杂度 144 → 阈值内）时对照：
 *  ① 精确匹配 / 前缀匹配 / 正则取值各命中对应 handler；
 *  ② 既有「先到先得」顺序被钉住（如 `/v1/monitor/sessions/summary` 现由
 *     `sessions/:id` 正则分支捕获，拆分段函数时不得改变这一现状）；
 *  ③ 未匹配 ⇒ 返回 `false` 且不调用任何 handler；
 *  ④ `handlerCtx` 透传口径与拆分前一致（按各 handler 的实参位次断言）。
 *
 * 手法：`spyOn` 各 handler 模块导出（bun 的 ESM live binding 会让分发模块取到桩），
 * 只断言"调用了谁 / 带了哪些参数"，不触真实 handler 实现。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type http from 'http';

import * as monitoringHandlers from '../../src/infrastructure/http/handlers/monitoring-handlers';
import * as errorReportHandlers from '../../src/infrastructure/http/handlers/error-report-handlers';
import * as stateHandlers from '../../src/infrastructure/http/handlers/state-handlers';
import * as traceHandlers from '../../src/infrastructure/http/handlers/trace-handlers';
import * as analyticsHandlers from '../../src/infrastructure/http/handlers/analytics-handlers';
import * as inboxHandlers from '../../src/infrastructure/http/handlers/inbox-handlers';
import * as notificationHandlers from '../../src/infrastructure/http/handlers/notification-handlers';
import * as securityHandlers from '../../src/infrastructure/http/handlers/security-handlers';
import * as workflowTemplateHandlers from '../../src/infrastructure/http/handlers/workflow-template-handlers';
import * as councilHandlers from '../../src/infrastructure/http/handlers/council-handlers';
import * as orchIntelligenceHandlers from '../../src/infrastructure/http/handlers/orch-intelligence-handlers';
import * as ruleHandlers from '../../src/infrastructure/http/handlers/rule-handlers';
import * as bottleneckHandlers from '../../src/infrastructure/http/handlers/bottleneck-handlers';
import * as commandsHandlers from '../../src/infrastructure/http/handlers/commands-handlers';
// S0（2026-11-17）：沙箱探针（诊断面）
import * as sandboxProbe from '../../src/infrastructure/http/handlers/sandbox-probe';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { dispatchMonitorCommandRoutes } from '../../src/infrastructure/http/handlers/routes/monitor-command-routes';

const spies: Array<{ mockRestore: () => void }> = [];

function stub<T extends object>(mod: T, key: keyof T) {
  const s = spyOn(mod as never, key as never).mockImplementation(
    (async () => {}) as never
  );
  spies.push(s as unknown as { mockRestore: () => void });
  return s as unknown as {
    mock: { calls: unknown[][] };
  };
}

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
});

function makeReq(url: string, method = 'GET'): http.IncomingMessage {
  return { url, method, headers: {} } as unknown as http.IncomingMessage;
}

const res = {} as http.ServerResponse;
const ctx = { readRequestBody: async () => '' } as unknown as HandlerCtx;
const noopBroadcast = () => {};

async function dispatch(url: string, method = 'GET'): Promise<boolean> {
  return dispatchMonitorCommandRoutes(
    makeReq(url, method),
    res,
    url,
    noopBroadcast,
    ctx
  );
}

describe('dispatchMonitorCommandRoutes：路由接线与顺序（特征化）', () => {
  it('① Monitor 精确 / 前缀 / 正则各归其位', async () => {
    const summary = stub(monitoringHandlers, 'handleMonitorSummary');
    const metrics = stub(monitoringHandlers, 'handleMonitorMetrics');
    const alerts = stub(monitoringHandlers, 'handleMonitorAlerts');
    const ack = stub(monitoringHandlers, 'handleAcknowledgeAlert');

    expect(await dispatch('/v1/monitor/summary')).toBe(true);
    expect(summary.mock.calls).toHaveLength(1);
    expect(summary.mock.calls[0]![0]).toBe(ctx);

    expect(await dispatch('/v1/monitor/metrics?range=1h')).toBe(true);
    expect(metrics.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/monitor/alerts?level=warn')).toBe(true);
    expect(alerts.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/monitor/alerts/a-1/acknowledge', 'POST')).toBe(
      true
    );
    expect(ack.mock.calls).toHaveLength(1);
    expect(ack.mock.calls[0]![3]).toEqual({ $1: 'a-1' });
  });

  it('② 既有顺序：/v1/monitor/sessions/summary 现由 sessions/:id 捕获', async () => {
    const sessions = stub(monitoringHandlers, 'handleMonitorSessions');
    const detail = stub(monitoringHandlers, 'handleMonitorSessionDetail');
    const sessionsSummary = stub(monitoringHandlers, 'handleSessionsSummary');

    expect(await dispatch('/v1/monitor/sessions')).toBe(true);
    expect(sessions.mock.calls).toHaveLength(1);
    expect(detail.mock.calls).toHaveLength(0);

    expect(await dispatch('/v1/monitor/sessions/s-9')).toBe(true);
    expect(detail.mock.calls).toHaveLength(1);
    expect(detail.mock.calls[0]![3]).toEqual({ $1: 's-9' });

    expect(await dispatch('/v1/monitor/sessions/summary')).toBe(true);
    expect(detail.mock.calls).toHaveLength(2);
    expect(detail.mock.calls[1]![3]).toEqual({ $1: 'summary' });
    expect(sessionsSummary.mock.calls).toHaveLength(0);
  });

  it('③ 导出 / 诊断 / 观测面路由命中', async () => {
    const exportLogs = stub(monitoringHandlers, 'handleExportLogs');
    const monitorLogs = stub(monitoringHandlers, 'handleMonitorLogs');
    const startupError = stub(monitoringHandlers, 'handleStartupError');
    const governor = stub(monitoringHandlers, 'handleResourceGovernorSnapshot');
    const otel = stub(monitoringHandlers, 'handleOTelMetrics');
    const orchestration = stub(
      monitoringHandlers,
      'handleOrchestrationMetrics'
    );
    const infra = stub(monitoringHandlers, 'handleInfrastructureStatus');
    const stateAll = stub(stateHandlers, 'handleStateAll');
    const traceStats = stub(traceHandlers, 'handleTraceStats');
    const errorStats = stub(errorReportHandlers, 'handleGetErrorStats');

    expect(await dispatch('/v1/monitor/logs/export', 'POST')).toBe(true);
    expect(exportLogs.mock.calls).toHaveLength(1);
    expect(monitorLogs.mock.calls).toHaveLength(0);

    expect(await dispatch('/v1/diagnostics/startup-error')).toBe(true);
    expect(startupError.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/diagnostics/resource-governor')).toBe(true);
    expect(governor.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/state/all')).toBe(true);
    expect(stateAll.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/trace/stats')).toBe(true);
    expect(traceStats.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/monitoring/errors')).toBe(true);
    expect(errorStats.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/monitor/otel/metrics')).toBe(true);
    expect(otel.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/monitor/orchestration')).toBe(true);
    expect(orchestration.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/infrastructure/status')).toBe(true);
    expect(infra.mock.calls).toHaveLength(1);
  });

  it('④ Inbox：精确在前、前缀分支区分 reply / undo / get', async () => {
    const list = stub(inboxHandlers, 'handleListInbox');
    const approveAll = stub(inboxHandlers, 'handleApproveAllInbox');
    const get = stub(inboxHandlers, 'handleGetInbox');
    const reply = stub(inboxHandlers, 'handleReplyInbox');
    const undo = stub(inboxHandlers, 'handleUndoApproval');

    expect(await dispatch('/v1/inbox')).toBe(true);
    expect(list.mock.calls).toHaveLength(1);
    expect(list.mock.calls[0]![2]).toBe(ctx);

    expect(await dispatch('/v1/inbox/approve-all', 'POST')).toBe(true);
    expect(approveAll.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/inbox/i-1')).toBe(true);
    expect(get.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/inbox/i-1/reply', 'POST')).toBe(true);
    expect(reply.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/inbox/i-1/undo', 'POST')).toBe(true);
    expect(undo.mock.calls).toHaveLength(1);
  });

  it('⑤ Notifications：保留字前缀不被 id 分支吞掉，子资源各归其位', async () => {
    const unread = stub(notificationHandlers, 'handleUnreadCount');
    const read = stub(notificationHandlers, 'handleMarkRead');
    const del = stub(notificationHandlers, 'handleDeleteNotification');
    const getInbox = stub(inboxHandlers, 'handleGetInbox');

    expect(await dispatch('/v1/notifications/unread-count')).toBe(true);
    expect(unread.mock.calls).toHaveLength(1);
    expect(getInbox.mock.calls).toHaveLength(0);

    expect(await dispatch('/v1/notifications/n-1/read', 'PATCH')).toBe(true);
    expect(read.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/notifications/n-1', 'DELETE')).toBe(true);
    expect(del.mock.calls).toHaveLength(1);
  });

  it('⑥ Workflow / Council / 规则 / 命令 参数取值不变', async () => {
    const run = stub(workflowTemplateHandlers, 'handleRunWorkflowTemplate');
    const listCouncil = stub(councilHandlers, 'handleListCouncils');
    const getCouncil = stub(councilHandlers, 'handleGetCouncil');
    const listRules = stub(ruleHandlers, 'handleListRules');
    const getRule = stub(ruleHandlers, 'handleGetRule');
    const execute = stub(commandsHandlers, 'handleExecuteCommand');
    const bottleneck = stub(bottleneckHandlers, 'handleBottleneckAnalysis');

    expect(await dispatch('/v1/workflows/templates/t-1/run', 'POST')).toBe(
      true
    );
    expect(run.mock.calls).toHaveLength(1);
    expect(run.mock.calls[0]![3]).toBe('t-1');

    expect(await dispatch('/v1/workspaces/w-1/council')).toBe(true);
    expect(listCouncil.mock.calls).toHaveLength(1);
    expect(listCouncil.mock.calls[0]![3]).toBe('w-1');

    expect(await dispatch('/v1/workspaces/w-1/council/s-1')).toBe(true);
    expect(getCouncil.mock.calls).toHaveLength(1);
    expect(getCouncil.mock.calls[0]![3]).toBe('s-1');

    expect(await dispatch('/v1/workspaces/w-1/rules')).toBe(true);
    expect(listRules.mock.calls).toHaveLength(1);
    expect(listRules.mock.calls[0]![3]).toBe('w-1');

    expect(await dispatch('/v1/workspaces/w-1/rules/security')).toBe(true);
    expect(getRule.mock.calls).toHaveLength(1);
    expect(getRule.mock.calls[0]![3]).toBe('security');

    expect(
      await dispatch('/v1/workspaces/w-1/intelligence/bottleneck', 'POST')
    ).toBe(true);
    expect(bottleneck.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/commands/execute', 'POST')).toBe(true);
    expect(execute.mock.calls).toHaveLength(1);
  });

  it('⑦ Analytics / Security 观测面命中', async () => {
    const dashboard = stub(analyticsHandlers, 'handleAnalyticsDashboard');
    const health = stub(analyticsHandlers, 'handleHealthReport');
    const secDashboard = stub(securityHandlers, 'handleSecurityDashboard');

    expect(await dispatch('/v1/analytics/dashboard')).toBe(true);
    expect(dashboard.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/health/report')).toBe(true);
    expect(health.mock.calls).toHaveLength(1);

    expect(await dispatch('/v1/security/dashboard')).toBe(true);
    expect(secDashboard.mock.calls).toHaveLength(1);
  });

  it('⑧ 沙箱探针（S0）走诊断面：GET /v1/diagnostics/sandbox/probe', async () => {
    const probe = stub(sandboxProbe, 'handleGetSandboxProbe');

    expect(await dispatch('/v1/diagnostics/sandbox/probe')).toBe(true);
    expect(probe.mock.calls).toHaveLength(1);
    // 与其它诊断 handler 同口径：只拿 req / res，不读 handlerCtx
    expect(probe.mock.calls[0]).toHaveLength(2);
  });

  it('⑨ 未匹配 ⇒ false 且不调用任何 handler', async () => {
    const summary = stub(monitoringHandlers, 'handleMonitorSummary');
    const list = stub(inboxHandlers, 'handleListInbox');
    const commands = stub(commandsHandlers, 'handleListCommands');

    expect(await dispatch('/v1/does-not-exist')).toBe(false);
    expect(summary.mock.calls).toHaveLength(0);
    expect(list.mock.calls).toHaveLength(0);
    expect(commands.mock.calls).toHaveLength(0);
  });
});
