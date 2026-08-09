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
  handlePathGuardMetrics,
  handlePathGuardMetricsReset,
  handleSessionsSummary,
  handleStartupError,
} from '../monitoring-handlers';
import {
  handleClientErrorReport,
  handleGetErrorStats,
} from '../error-report-handlers';
import { handleTraceStats } from '../trace-handlers';
import {
  handleAnalyticsDashboard,
  handleHealthReport,
} from '../analytics-handlers';
import {
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
import type { RuleSpecialization } from '@modules/workspace/RuleEngine';

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
  // ---- Monitor ----
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
  // Trace 统计（必选项 — 暴露真实 API token 消耗数据）
  if (method === 'GET' && url === '/v1/trace/stats') {
    await handleTraceStats(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/monitor/logs/export') {
    await handleExportLogs(handlerCtx, req, res);
    return true;
  }
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

  // ---- Inbox ----
  if (url === '/v1/inbox' && method === 'GET') {
    await handleListInbox(req, res, handlerCtx);
    return true;
  }
  if (url === '/v1/inbox/count' && method === 'GET') {
    await handleInboxCount(req, res, handlerCtx);
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

  // ---- Notifications ----
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

  if (method === 'GET' && url === '/v1/monitor/otel/metrics') {
    await handleOTelMetrics(handlerCtx, req, res);
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

  // ---- Security ----
  if (method === 'GET' && url === '/v1/security/dashboard') {
    await handleSecurityDashboard(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/security/audit-logs') {
    await handleQueryAuditLogs(handlerCtx, req, res);
    return true;
  }

  // ---- Workflow Templates ----
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

  // ---- Council ----
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

  // ---- 编排智能 ----
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

  // ---- 规则管理 ----
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
      specialization as RuleSpecialization
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
      specialization as RuleSpecialization
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
      specialization as RuleSpecialization
    );
    return true;
  }

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
