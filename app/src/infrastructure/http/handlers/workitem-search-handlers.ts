/**
 * 工作项搜索 API Handler（对话式回顾）
 *
 * 支持自然语言描述搜索历史工作项：
 * - POST /v1/workspaces/:id/items/search  — 搜索工作项
 * - GET  /v1/workspaces/:id/items/review  — 工作项回顾摘要
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
// C1（2026-09-30 D-114，`workspace` 域 P2）：工作空间配置 / 工作项存储 / 类型改经服务层端口
// （原具名导入**不在此处复写** —— 门禁不剥离注释，写了会让「对」复活，见台账 D-77）
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import type {
  WorkItemSearchQueryDto,
  WorkItemSearchResultDto,
} from '@modules/runtime/api/workspaceOpsPorts';
import { resolveWorkspacePath } from './workspaces-handlers';

/** C1（D-114）：工作空间上下文（配置 + 工作项存储）经端口取用 */
async function getWorkspaceContext(wsPath: string) {
  return (await getCoreAPI().getWorkspaceOpsPort()).getWorkspaceContext(wsPath);
}

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
    const query: WorkItemSearchQueryDto = body ? JSON.parse(body) : {};

    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const wsCtx = await getWorkspaceContext(wsPath);
    const store = wsCtx.getWorkItemStore();
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

    const result: WorkItemSearchResultDto = {
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

    const wsCtx = await getWorkspaceContext(wsPath);
    const store = wsCtx.getWorkItemStore();
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
