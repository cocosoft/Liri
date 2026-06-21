/**
 * 工作项搜索 API Handler（对话式回顾）
 *
 * 支持自然语言描述搜索历史工作项：
 * - POST /v1/workspaces/:id/items/search  — 搜索工作项
 * - GET  /v1/workspaces/:id/items/review  — 工作项回顾摘要
 */

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { createWorkItemStore } from '@modules/workspace/WorkItemStore';
import { createLiriConfigManager } from '@modules/workspace/LiriConfigManager';
import { resolveWorkspacePath } from './workspaces-handlers';
import type {
  WorkItem,
  WorkItemSearchQuery,
  WorkItemSearchResult,
} from '@modules/workspace/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 搜索工作项
 * POST /v1/workspaces/:id/items/search
 *
 * 支持关键词、日期范围、状态、类型、标签等多维度过滤
 */
export async function handleSearchWorkItems(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const query: WorkItemSearchQuery = body ? JSON.parse(body) : {};

    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createWorkItemStore(manager.dir, manager);
    let items = store.list(workspaceId);

    // 关键词过滤（标题 + 描述）
    if (query.keywords) {
      const kw = query.keywords.toLowerCase();
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(kw) ||
          (item.description && item.description.toLowerCase().includes(kw))
      );
    }

    // 日期范围过滤
    if (query.dateRange) {
      const { start, end } = query.dateRange;
      items = items.filter((item) => {
        if (start && item.createdAt < start) return false;
        if (end && item.createdAt > end) return false;
        return true;
      });
    }

    // 状态过滤
    if (query.status && query.status.length > 0) {
      items = items.filter((item) => query.status!.includes(item.status));
    }

    // 类型过滤
    if (query.type && query.type.length > 0) {
      items = items.filter((item) => query.type!.includes(item.type));
    }

    // 标签过滤
    if (query.tags && query.tags.length > 0) {
      items = items.filter(
        (item) =>
          item.tags && item.tags.some((tag) => query.tags!.includes(tag))
      );
    }

    // 分配者过滤
    if (query.assigneeId) {
      items = items.filter(
        (item) =>
          item.assignment && item.assignment.assignee.id === query.assigneeId
      );
    }

    // 排序
    const sortBy = query.sortBy || 'updatedAt';
    const sortOrder = query.sortOrder || 'desc';
    items.sort((a, b) => {
      const aVal = a[sortBy] || '';
      const bVal = b[sortBy] || '';
      if (sortOrder === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

    const total = items.length;

    // 分页
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    items = items.slice(offset, offset + limit);

    const result: WorkItemSearchResult = {
      items,
      total,
      query,
      searchedAt: new Date().toISOString(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'search_workitems',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to search work items' } })
      );
    }
  }
}

/**
 * 工作项回顾摘要
 * GET /v1/workspaces/:id/items/review
 *
 * 返回工作项的统计摘要，用于 AI 对话式回顾
 */
export async function handleWorkItemReview(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createWorkItemStore(manager.dir, manager);
    const items = store.list(workspaceId);

    // 按状态统计
    const statusCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    let totalTokens = 0;
    let totalCost = 0;

    for (const item of items) {
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
      typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    }

    // 最近完成的工作项
    const recentlyCompleted = items
      .filter((item) => item.status === 'done')
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
      .slice(0, 10);

    // 当前进行中的工作项
    const inProgress = items.filter(
      (item) => item.status === 'running' || item.status === 'review'
    );

    const review = {
      workspaceId,
      totalItems: items.length,
      statusCounts,
      typeCounts,
      inProgress,
      recentlyCompleted,
      totalTokens,
      totalCostUSD: totalCost,
      generatedAt: new Date().toISOString(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(review));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'workitem_review' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get work item review' } })
      );
    }
  }
}
