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
 * monitor-command-routes.ts — dispatchMonitorCommandRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleAcknowledgeAlert,
  handleExportLogs,
  handleInfrastructureStatus,
  handleMonitorAlerts,
  handleMonitorLogs,
  handleMonitorMetrics,
  handleMonitorSessionDetail,
  handleMonitorSessions,
  handleMonitorSummary,
  handleOTelMetrics,
  handleOrchestrationMetrics,
  handlePathGuardMetrics,
  handlePathGuardMetricsReset,
  handleResourceGovernorSnapshot,
  handleSessionsSummary,
  handleStartupError,
} from '../monitoring-handlers';
import {
  handleClientErrorReport,
  handleGetErrorStats,
} from '../error-report-handlers';
import { handleStateAll } from '../state-handlers';
import { handleTraceStats } from '../trace-handlers';
import {
  handleAnalyticsDashboard,
  handleHealthReport,
} from '../analytics-handlers';
import {
  handleApproveAllInbox,
  handleGetInbox,
  handleInboxCount,
  handleListInbox,
  handleReplyInbox,
  handleUndoApproval,
} from '../inbox-handlers';
import {
  handleBatch,
  handleCreateNotification,
  handleDeleteNotification,
  handleDismiss,
  handleListNotifications,
  handleMarkRead,
  handleReadAll,
  handleSearchNotifications,
  handleUnreadCount,
} from '../notification-handlers';
import {
  handleQueryAuditLogs,
  handleSecurityDashboard,
} from '../security-handlers';
import {
  handleCreateWorkflowTemplate,
  handleDeleteWorkflowTemplate,
  handleGetWorkflowTemplate,
  handleListWorkflowTemplates,
  handleRunWorkflowTemplate,
  handleUpdateWorkflowTemplate,
} from '../workflow-template-handlers';
import {
  handleCouncilStream,
  handleCreateCouncil,
  handleGetCouncil,
  handleListCouncils,
  handleSubmitStatement,
} from '../council-handlers';
import {
  handleDecisionClassify,
  handleEscalation,
  handleGetEscalations,
  handleGetResources,
  handleImpactAnalysis,
  handleResourceSchedule,
  handleRiskDetection,
} from '../orch-intelligence-handlers';
import {
  handleAppendRule,
  handleGetRule,
  handleListRules,
  handleLoadRulesForWorkItem,
  handleRulesOverview,
  handleWriteRule,
} from '../rule-handlers';
import { handleBottleneckAnalysis } from '../bottleneck-handlers';
import { handleExecuteCommand, handleListCommands } from '../commands-handlers';
// C1（2026-09-30 D-114，`workspace` 域 P2）：规则专业领域**类型位**改经服务层端口**逐字镜像**
import type { RuleSpecializationDto } from '@openliri/service/runtime/api/workspaceOpsPorts';

/**
 * dispatchMonitorCommandRoutes — monitor-command-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchMonitorCommandRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Monitor（观测读数 -> 诊断读数 -> 会话读数，顺序与拆分前一致）----
  if (await dispatchMonitorCoreRoutes(method, url, req, res, handlerCtx))
    return true;
  if (await dispatchMonitorDiagnosticsRoutes(method, url, req, res, handlerCtx))
    return true;
  if (await dispatchMonitorSessionsRoutes(method, url, req, res, handlerCtx))
    return true;
  // ---- Inbox ----
  if (await dispatchInboxRoutes(method, url, req, res, handlerCtx)) return true;

  // ---- Notifications ----
  if (await dispatchNotificationRoutes(method, url, req, res, handlerCtx))
    return true;

  // ---- OTel / 编排链路 / 基础设施 / Analytics ----
  if (await dispatchObservabilityRoutes(method, url, req, res, handlerCtx))
    return true;

  // ---- Security ----
  if (await dispatchSecurityRoutes(method, url, req, res, handlerCtx))
    return true;

  // ---- Workflow Templates ----
  if (await dispatchWorkflowTemplateRoutes(method, url, req, res, handlerCtx))
    return true;

  // ---- Council ----
  if (await dispatchCouncilRoutes(method, url, req, res, handlerCtx))
    return true;

  // ---- 编排智能 ----
  if (await dispatchOrchIntelligenceRoutes(method, url, req, res, handlerCtx))
    return true;

  // ---- 规则管理 ----
  if (await dispatchRuleRoutes(method, url, req, res, handlerCtx)) return true;

  // ---- 瓶颈感知 / Commands ----
  if (await dispatchCommandRoutes(method, url, req, res, handlerCtx))
    return true;

  return false;
}

/**
 * T3（2026-11-17）：Monitor 观测读数（原样搬出 `dispatchMonitorCommandRoutes`）。
 * 顺序不变：summary -> metrics -> alerts -> alerts/:id/acknowledge -> logs。
 * @returns true 表示已匹配并处理
 */
async function dispatchMonitorCoreRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (method === 'GET' && url === '/v1/monitor/summary') {
    await handleMonitorSummary(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/monitor/metrics')) {
    await handleMonitorMetrics(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/monitor/alerts')) {
    await handleMonitorAlerts(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/monitor\/alerts\/(.+)\/acknowledge$/)
  ) {
    await handleAcknowledgeAlert(handlerCtx, req, res, {
      $1: url.match(/^\/v1\/monitor\/alerts\/(.+)\/acknowledge$/)![1],
    });
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/monitor/logs')) {
    await handleMonitorLogs(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：诊断 / 指标 / 错误统计 / 状态聚合 / Trace / 日志导出（原样搬出）。
 */
async function dispatchMonitorDiagnosticsRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  // 路径幻觉守卫指标
  if (method === 'GET' && url === '/v1/metrics/path-guard') {
    await handlePathGuardMetrics(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/metrics/path-guard/reset') {
    await handlePathGuardMetricsReset(handlerCtx, req, res);
    return true;
  }
  // 启动错误日志
  if (method === 'GET' && url === '/v1/diagnostics/startup-error') {
    await handleStartupError(handlerCtx, req, res);
    return true;
  }
  // 跨会话资源治理读数（登记表 §2-#4 判据①取数口；默认关也可读，只观测不决策）
  if (method === 'GET' && url === '/v1/diagnostics/resource-governor') {
    await handleResourceGovernorSnapshot(handlerCtx, req, res);
    return true;
  }
  // 前端错误上报
  if (method === 'POST' && url === '/v1/errors/report') {
    await handleClientErrorReport(req, res);
    return true;
  }
  // P3-2.11: 后端错误统计
  if (method === 'GET' && url === '/v1/monitoring/errors') {
    handleGetErrorStats(req, res);
    return true;
  }
  // §十 阶段 D: 状态机聚合（R09-005）
  if (method === 'GET' && url === '/v1/state/all') {
    await handleStateAll(handlerCtx, req, res);
    return true;
  }
  // Trace 统计（必选项 — 暴露真实 API token 消耗数据）
  if (method === 'GET' && url === '/v1/trace/stats') {
    await handleTraceStats(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/monitor/logs/export') {
    await handleExportLogs(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：Monitor 会话读数 + 健康报告（原样搬出；顺序不变）。
 * 注意：`/v1/monitor/sessions/summary` 仍先被 `sessions/:id` 正则分支捕获（现状保留）。
 */
async function dispatchMonitorSessionsRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (method === 'GET' && url === '/v1/monitor/sessions') {
    await handleMonitorSessions(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/monitor\/sessions\/(.+)$/)) {
    await handleMonitorSessionDetail(handlerCtx, req, res, {
      $1: url.match(/^\/v1\/monitor\/sessions\/(.+)$/)![1],
    });
    return true;
  }
  if (method === 'GET' && url === '/v1/health/report') {
    await handleHealthReport(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/monitor/sessions/summary') {
    await handleSessionsSummary(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：Inbox（原样搬出；精确匹配仍在 `/v1/inbox/` 前缀分支之前）。
 */
async function dispatchInboxRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (url === '/v1/inbox' && method === 'GET') {
    await handleListInbox(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/inbox/count' && method === 'GET') {
    await handleInboxCount(req, res, handlerCtx);
    return true;
  }
  // P1-1（2026-11-06）：批量审批 —— 必须在下方 `/v1/inbox/` 前缀分支之前精确匹配
  if (url === '/v1/inbox/approve-all' && method === 'POST') {
    await handleApproveAllInbox(req, res, handlerCtx);
    return true;
  }
  if (url.startsWith('/v1/inbox/') && url !== '/v1/inbox/count') {
    if (url.endsWith('/reply') && method === 'POST') {
      await handleReplyInbox(req, res, handlerCtx);
      return true;
    }
    if (url.endsWith('/undo') && method === 'POST') {
      await handleUndoApproval(req, res, handlerCtx);
      return true;
    }
    if (method === 'GET') {
      await handleGetInbox(req, res, handlerCtx);
      return true;
    }
  }
  return false;
}

/**
 * T3（2026-11-17）：Notifications（原样搬出；保留字前缀仍在 id 分支之前）。
 */
async function dispatchNotificationRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (url === '/v1/notifications/unread-count' && method === 'GET') {
    await handleUnreadCount(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications/search' && method === 'GET') {
    await handleSearchNotifications(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications/read-all' && method === 'PATCH') {
    await handleReadAll(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications/batch' && method === 'PATCH') {
    await handleBatch(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications' && method === 'GET') {
    await handleListNotifications(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/notifications' && method === 'POST') {
    await handleCreateNotification(req, res, handlerCtx);
    return true;
  }
  if (url.startsWith('/v1/notifications/')) {
    const idMatch = url.match(/^\/v1\/notifications\/([^/]+)(\/.*)?$/);
    const id = idMatch ? idMatch[1] : '';
    const suffix = idMatch?.[2] || '';

    if (
      id &&
      id !== 'unread-count' &&
      id !== 'search' &&
      id !== 'read-all' &&
      id !== 'batch'
    ) {
      if (suffix === '/read' && method === 'PATCH') {
        await handleMarkRead(req, res, handlerCtx);
        return true;
      }
      if (suffix === '/dismiss' && method === 'PATCH') {
        await handleDismiss(req, res, handlerCtx);
        return true;
      }
      if (!suffix && method === 'DELETE') {
        await handleDeleteNotification(req, res, handlerCtx);
        return true;
      }
    }
  }
  return false;
}

/**
 * T3（2026-11-17）：OTel / 编排链路 / 基础设施 / Analytics（原样搬出）。
 */
async function dispatchObservabilityRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (method === 'GET' && url === '/v1/monitor/otel/metrics') {
    await handleOTelMetrics(handlerCtx, req, res);
    return true;
  }
  // U-13/H-2：编排链路 P50/P95（进程内，只读观测面）
  if (method === 'GET' && url === '/v1/monitor/orchestration') {
    await handleOrchestrationMetrics(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/infrastructure/status') {
    await handleInfrastructureStatus(handlerCtx, req, res);
    return true;
  }
  // ---- Analytics ----
  if (method === 'GET' && url === '/v1/analytics/dashboard') {
    await handleAnalyticsDashboard(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：Security（原样搬出）。
 */
async function dispatchSecurityRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (method === 'GET' && url === '/v1/security/dashboard') {
    await handleSecurityDashboard(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/security/audit-logs') {
    await handleQueryAuditLogs(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：Workflow Templates（原样搬出；精确在前、带参在后）。
 */
async function dispatchWorkflowTemplateRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (method === 'GET' && url === '/v1/workflows/templates') {
    await handleListWorkflowTemplates(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workflows\/templates\/(.+)$/)) {
    const templateId = url.match(/^\/v1\/workflows\/templates\/(.+)$/)![1];
    await handleGetWorkflowTemplate(handlerCtx, req, res, templateId);
    return true;
  }
  if (method === 'POST' && url === '/v1/workflows/templates') {
    await handleCreateWorkflowTemplate(handlerCtx, req, res);
    return true;
  }
  // P0-2(a)（2026-10-08）：模板执行入口（**唯一**触发；不扩 office:workflow 的 enum）
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workflows\/templates\/([^/]+)\/run$/)
  ) {
    const templateId = url.match(
      /^\/v1\/workflows\/templates\/([^/]+)\/run$/
    )![1];
    await handleRunWorkflowTemplate(handlerCtx, req, res, templateId);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/workflows\/templates\/(.+)$/)) {
    const templateId = url.match(/^\/v1\/workflows\/templates\/(.+)$/)![1];
    await handleUpdateWorkflowTemplate(handlerCtx, req, res, templateId);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/workflows\/templates\/(.+)$/)) {
    const templateId = url.match(/^\/v1\/workflows\/templates\/(.+)$/)![1];
    await handleDeleteWorkflowTemplate(handlerCtx, req, res, templateId);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：Council（原样搬出；顺序不变）。
 */
async function dispatchCouncilRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/council$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/council$/)![1];
    await handleListCouncils(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/council$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/council$/)![1];
    await handleCreateCouncil(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)$/)!;
    const sessionId = match[2];
    await handleGetCouncil(handlerCtx, req, res, sessionId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/stream$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/stream$/
    )!;
    const sessionId = match[2];
    await handleCouncilStream(handlerCtx, req, res, sessionId);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/statement$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/council\/([^/]+)\/statement$/
    )!;
    const sessionId = match[2];
    await handleSubmitStatement(handlerCtx, req, res, sessionId);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：编排智能（原样搬出）。
 */
async function dispatchOrchIntelligenceRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/impact$/)
  ) {
    await handleImpactAnalysis(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/risks$/)
  ) {
    await handleRiskDetection(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/decision$/)
  ) {
    await handleDecisionClassify(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/escalate$/)
  ) {
    await handleEscalation(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/escalations$/)
  ) {
    await handleGetEscalations(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/schedule$/)
  ) {
    await handleResourceSchedule(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/resources$/)
  ) {
    await handleGetResources(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：规则管理（原样搬出；顺序不变）。
 */
async function dispatchRuleRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/rules$/)) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules$/)!;
    const workspaceId = match[1];
    await handleListRules(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/overview$/)
  ) {
    await handleRulesOverview(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/rules\/load$/)) {
    await handleLoadRulesForWorkItem(handlerCtx, req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)!;
    const specialization = match[2];
    await handleGetRule(
      handlerCtx,
      req,
      res,
      specialization as RuleSpecializationDto
    );
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)!;
    const specialization = match[2];
    await handleWriteRule(
      handlerCtx,
      req,
      res,
      specialization as RuleSpecializationDto
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/rules\/([^/]+)$/)!;
    const specialization = match[2];
    await handleAppendRule(
      handlerCtx,
      req,
      res,
      specialization as RuleSpecializationDto
    );
    return true;
  }
  return false;
}

/**
 * T3（2026-11-17）：瓶颈感知与 Commands（原样搬出；顺序不变）。
 */
async function dispatchCommandRoutes(
  method: string,
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  // ---- 瓶颈感知 ----
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/intelligence\/bottleneck$/)
  ) {
    await handleBottleneckAnalysis(handlerCtx, req, res);
    return true;
  }

  // ---- Commands ----
  if (method === 'GET' && url === '/v1/commands') {
    await handleListCommands(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/commands/execute') {
    await handleExecuteCommand(handlerCtx, req, res);
    return true;
  }
  return false;
}
