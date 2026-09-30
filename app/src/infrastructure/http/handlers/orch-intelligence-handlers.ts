/**
 * 编排智能 API 处理器
 *
 * 提供变更影响评估、风险识别、决策分级、异常升级、资源调度的 REST API：
 * - POST /v1/workspaces/:id/intelligence/impact   变更影响评估
 * - POST /v1/workspaces/:id/intelligence/risks    风险识别
 * - POST /v1/workspaces/:id/intelligence/decision  决策分级
 * - POST /v1/workspaces/:id/intelligence/escalate  异常升级
 * - GET  /v1/workspaces/:id/intelligence/escalations 活跃异常列表
 * - POST /v1/workspaces/:id/intelligence/schedule  资源调度
 * - GET  /v1/workspaces/:id/intelligence/resources 资源状态
 */

import type http from 'http';
import { handleError } from '@modules/error';
import type { HandlerCtx } from './handler-utils';
// C1（2026-09-30 D-113，`workspace` 域 P1）：5 个单例改经服务层端口**聚合句柄**
// （原具名导入**不在此处复写** —— 门禁不剥离注释，写了会让「对」复活，见台账 D-77）
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

/**
 * POST /v1/workspaces/:id/intelligence/impact
 * 变更影响评估
 */
export async function handleImpactAnalysis(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { changedFiles, changedContent } = data;

    if (!changedFiles || !Array.isArray(changedFiles)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少必要参数：changedFiles' }));
      return;
    }

    const { changeImpactAnalyzer } = await (
      await getCoreAPI().getWorkspaceOpsPort()
    ).getOrchIntelligence();
    const result = changeImpactAnalyzer.analyze(
      changedFiles,
      changedContent || ''
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:orch',
      action: 'impact_analysis',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '变更影响评估失败' }));
    }
  }
}

/**
 * POST /v1/workspaces/:id/intelligence/risks
 * 风险识别
 */
export async function handleRiskDetection(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { title, description, changedFiles } = data;

    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少必要参数：title' }));
      return;
    }

    const { riskDetector } = await (
      await getCoreAPI().getWorkspaceOpsPort()
    ).getOrchIntelligence();
    const risks = riskDetector.detect(
      title,
      description || '',
      changedFiles || []
    );

    const summary = riskDetector.getRiskSummary(risks);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ risks, summary }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:orch',
      action: 'risk_detection',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '风险识别失败' }));
    }
  }
}

/**
 * POST /v1/workspaces/:id/intelligence/decision
 * 决策分级
 */
export async function handleDecisionClassify(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { title, description, impactResult, risks } = data;

    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少必要参数：title' }));
      return;
    }

    const { decisionClassifier } = await (
      await getCoreAPI().getWorkspaceOpsPort()
    ).getOrchIntelligence();
    const result = decisionClassifier.classify(
      title,
      description || '',
      impactResult || null,
      risks || []
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:orch',
      action: 'decision_classify',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '决策分级失败' }));
    }
  }
}

/**
 * POST /v1/workspaces/:id/intelligence/escalate
 * 异常升级记录
 */
export async function handleEscalation(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { workItemId, type, description, suggestedDirection } = data;

    if (!workItemId || !type || !description) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: '缺少必要参数：workItemId, type, description' })
      );
      return;
    }

    const { escalationManager } = await (
      await getCoreAPI().getWorkspaceOpsPort()
    ).getOrchIntelligence();
    const request = escalationManager.recordEscalation(
      workItemId,
      type,
      description,
      suggestedDirection || ''
    );

    const shouldEscalate = escalationManager.shouldEscalate(workItemId, type);
    const advice = escalationManager.getEscalationAdvice(workItemId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        escalation: request,
        shouldEscalate,
        advice,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:orch',
      action: 'escalation',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '异常升级失败' }));
    }
  }
}

/**
 * GET /v1/workspaces/:id/intelligence/escalations
 * 获取活跃异常列表
 */
export async function handleGetEscalations(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { escalationManager } = await (
      await getCoreAPI().getWorkspaceOpsPort()
    ).getOrchIntelligence();
    const active = escalationManager.getActiveEscalations();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(active));
  } catch (err) {
    void handleError(err, {
      module: 'infra:handler:orch',
      action: 'get_escalations',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '获取活跃异常失败' }));
    }
  }
}

/**
 * POST /v1/workspaces/:id/intelligence/schedule
 * 资源调度
 */
export async function handleResourceSchedule(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body);
    const { workItemId, resources, priority } = data;

    if (!workItemId || !resources || !Array.isArray(resources)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少必要参数：workItemId, resources' }));
      return;
    }

    const { resourceScheduler } = await (
      await getCoreAPI().getWorkspaceOpsPort()
    ).getOrchIntelligence();
    const results = resourceScheduler.requestResource(
      workItemId,
      resources,
      priority || 0
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:orch',
      action: 'resource_schedule',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '资源调度失败' }));
    }
  }
}

/**
 * GET /v1/workspaces/:id/intelligence/resources
 * 获取资源状态
 */
export async function handleGetResources(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { resourceScheduler } = await (
      await getCoreAPI().getWorkspaceOpsPort()
    ).getOrchIntelligence();
    const status = resourceScheduler.getResourceStatus();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  } catch (err) {
    void handleError(err, {
      module: 'infra:handler:orch',
      action: 'get_resources',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '获取资源状态失败' }));
    }
  }
}
