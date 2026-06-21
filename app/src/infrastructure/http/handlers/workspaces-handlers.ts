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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import type { SessionInfo } from '@modules/runtime/api/CoreAPI';
import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import {
  createLiriConfigManager,
  detectLiriDir,
} from '@modules/workspace/LiriConfigManager';
import { createWorkItemStore } from '@modules/workspace/WorkItemStore';
import { createChangeSetStore } from '@modules/workspace/ChangeSetStore';
import { createProjectStore } from '@modules/workspace/ProjectStore';
import type { WorkItem } from '@modules/workspace/types';

const logger = new Logger({ level: LogLevel.INFO });

// ========== Workspaces Handlers ==========

export async function handleListWorkspaces(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { buildEntries } =
      await import('@modules/commands/builtin/workspace/WorkspaceStorage');
    const entries = await buildEntries();

    const workspaces = entries.map((entry) => ({
      id: entry.meta.id,
      name: entry.name,
      description: entry.meta.description,
      createdAt: new Date(entry.meta.createdAt).getTime(),
      updatedAt: new Date(entry.meta.updatedAt).getTime(),
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(workspaces));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {} /* res可能已结束, 忽略 */
    }
  }
}

// ========== Workspace Session Handlers ==========

/**
 * 列出工作空间下的所有会话
 * GET /v1/workspaces/:id/sessions
 */
export async function handleListWorkspaceSessions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const sessions = await coreAPI.listSessions();

    // 过滤出属于该工作空间的会话
    const workspaceSessions = sessions.filter(
      (s: SessionInfo) => s.metadata?.workspaceId === workspaceId
    );

    const result = workspaceSessions.map((s: SessionInfo) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount || 0,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'workspace_session_list',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to list workspace sessions' },
        })
      );
    }
  }
}

/**
 * 为工作空间创建会话
 * POST /v1/workspaces/:id/sessions
 */
export async function handleCreateWorkspaceSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { title, mode = 'plan' } = JSON.parse(body || '{}');

    const coreAPI = getCoreAPI();
    const session = await coreAPI.createSession({
      title: title || `Workspace Session - ${workspaceId}`,
      metadata: {
        workspaceId,
        workMode: mode,
        type: 'workspace',
      },
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: session.id,
        title: session.title,
        workspaceId,
        mode,
        createdAt: session.createdAt,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'workspace_session_create',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to create workspace session' },
        })
      );
    }
  }
}

// ========== Work Items Handlers ==========

/**
 * 列出工作空间的工作项
 * GET /v1/workspaces/:id/items
 */
export async function handleListWorkItems(
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'work_items_list' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to list work items' } })
      );
    }
  }
}

/**
 * 创建或更新工作项
 * POST /v1/workspaces/:id/items
 */
export async function handleCreateWorkItem(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const {
      title,
      description,
      type = 'task',
      tags,
      priority,
    } = JSON.parse(body || '{}');

    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'title is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createWorkItemStore(manager.dir, manager);
    const item = store.create({
      workspaceId,
      title,
      description,
      type,
      tags,
      priority,
    });

    logger.info(`工作项已创建: ${title}`, { workspaceId, itemId: item.id });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(item));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'work_item_create',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to create work item' } })
      );
    }
  }
}

/**
 * 更新工作项状态
 * PATCH /v1/workspaces/:id/items/:itemId
 */
export async function handleUpdateWorkItem(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  itemId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const updates = JSON.parse(body || '{}');

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createWorkItemStore(manager.dir, manager);
    const updated = store.update(itemId, updates);

    if (!updated) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Work item not found' } }));
      return;
    }

    logger.info(`工作项已更新: ${updated.title}`, {
      itemId,
      status: updated.status,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'work_item_update',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to update work item' } })
      );
    }
  }
}

// ========== .liri/ 配置 Handlers ==========

/**
 * 根据 workspaceId 解析工作空间的文件系统路径
 */
export async function resolveWorkspacePath(
  workspaceId: string
): Promise<string | null> {
  try {
    const { buildEntries } =
      await import('@modules/commands/builtin/workspace/WorkspaceStorage');
    const entries = await buildEntries();
    const entry = entries.find((e) => e.meta.id === workspaceId);
    return entry ? entry.path : null;
  } catch {
    return null;
  }
}

/**
 * 检测 .liri/ 目录
 * GET /v1/workspaces/:id/liri/detect
 */
export async function handleDetectLiriDir(
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

    const result = detectLiriDir(wsPath);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'liri_detect' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to detect .liri directory' },
        })
      );
    }
  }
}

/**
 * 初始化 .liri/ 目录结构
 * POST /v1/workspaces/:id/liri/init
 */
export async function handleInitLiriDir(
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
    manager.init();

    const result = manager.detect();

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'liri_init' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to initialize .liri directory' },
        })
      );
    }
  }
}

/**
 * 获取工作空间配置摘要
 * GET /v1/workspaces/:id/config
 */
export async function handleGetWorkspaceConfig(
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
    const summary = manager.getSummary();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'liri_config_get' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get workspace config' } })
      );
    }
  }
}

/**
 * 更新工作空间配置
 * PUT /v1/workspaces/:id/config
 */
export async function handleUpdateWorkspaceConfig(
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

    const body = await ctx.readRequestBody(req);
    const updates = JSON.parse(body || '{}');

    const manager = createLiriConfigManager(wsPath);
    const merged = manager.updateConfig(updates);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(merged));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'liri_config_update',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to update workspace config' },
        })
      );
    }
  }
}

/**
 * 获取工作空间规则
 * GET /v1/workspaces/:id/rules
 */
export async function handleGetWorkspaceRules(
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
    const rules = manager.loadRules();

    res.writeHead(200, { 'Content-Type': 'text/markdown' });
    res.end(rules);
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'liri_rules_get' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get workspace rules' } })
      );
    }
  }
}

/**
 * 更新工作空间规则
 * PUT /v1/workspaces/:id/rules
 */
export async function handleUpdateWorkspaceRules(
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

    const body = await ctx.readRequestBody(req);
    const { content } = JSON.parse(body || '{}');

    if (content === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'content is required' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    manager.saveRules(content);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'liri_rules_update',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to update workspace rules' },
        })
      );
    }
  }
}

// ========== 变更集 Handlers ==========

/**
 * 列出工作项的变更集
 * GET /v1/workspaces/:id/items/:itemId/changesets
 */
export async function handleListChangeSets(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  itemId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createChangeSetStore(manager.dir);
    const changesets = store.listByWorkItem(itemId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(changesets));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'changesets_list' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to list change sets' } })
      );
    }
  }
}

/**
 * 创建变更集
 * POST /v1/workspaces/:id/items/:itemId/changesets
 */
export async function handleCreateChangeSet(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  itemId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { description, files } = JSON.parse(body || '{}');

    if (!description) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'description is required' } })
      );
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createChangeSetStore(manager.dir);
    const changeset = store.create({ workItemId: itemId, description, files });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(changeset));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'changesets_create',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to create change set' } })
      );
    }
  }
}

/**
 * 获取变更集详情
 * GET /v1/workspaces/:id/changesets/:changesetId
 */
export async function handleGetChangeSet(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  changesetId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createChangeSetStore(manager.dir);
    const changeset = store.get(changesetId);

    if (!changeset) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Change set not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(changeset));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'changesets_get' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get change set' } })
      );
    }
  }
}

/**
 * 添加文件变更到变更集
 * POST /v1/workspaces/:id/changesets/:changesetId/files
 */
export async function handleAddFileChange(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  changesetId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { path, change, additions, deletions } = JSON.parse(body || '{}');

    if (!path || !change) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'path and change are required' } })
      );
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createChangeSetStore(manager.dir);
    const updated = store.recordFileChange(
      changesetId,
      path,
      change,
      additions,
      deletions
    );

    if (!updated) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Change set not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'changesets_add_file',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to add file change' } })
      );
    }
  }
}

/**
 * 更新变更集状态（审核）
 * PATCH /v1/workspaces/:id/changesets/:changesetId
 */
export async function handleUpdateChangeSet(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  changesetId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { status } = JSON.parse(body || '{}');

    if (!status) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'status is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createChangeSetStore(manager.dir);
    const updated = store.updateStatus(changesetId, status);

    if (!updated) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Change set not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'changesets_update',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to update change set' } })
      );
    }
  }
}

/**
 * 获取变更集统计摘要
 * GET /v1/workspaces/:id/changesets/:changesetId/summary
 */
export async function handleGetChangeSetSummary(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  changesetId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const store = createChangeSetStore(manager.dir);
    const summary = store.getSummary(changesetId);

    if (!summary) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Change set not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'changesets_summary',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to get change set summary' },
        })
      );
    }
  }
}

// ========== Project Handlers ==========

/**
 * 列出工作空间中的项目
 * GET /v1/workspaces/:id/projects
 */
export async function handleListProjects(
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
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const projects = store.list(workspaceId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projects));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'projects_list' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to list projects' } })
      );
    }
  }
}

/**
 * 创建项目
 * POST /v1/workspaces/:id/projects
 */
export async function handleCreateProject(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { name, description, template, tags } = JSON.parse(body || '{}');

    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'name is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const project = store.create({
      workspaceId,
      name,
      description,
      template,
      tags,
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(project));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'project_create' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to create project' } })
      );
    }
  }
}

/**
 * 获取项目详情
 * GET /v1/workspaces/:id/projects/:projectId
 */
export async function handleGetProject(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  projectId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const project = store.get(projectId);

    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Project not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(project));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'project_get' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to get project' } }));
    }
  }
}

/**
 * 更新项目
 * PATCH /v1/workspaces/:id/projects/:projectId
 */
export async function handleUpdateProject(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  projectId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const updates = JSON.parse(body || '{}');

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const updated = store.update(projectId, updates);

    if (!updated) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Project not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'project_update' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to update project' } })
      );
    }
  }
}

/**
 * 删除项目
 * DELETE /v1/workspaces/:id/projects/:projectId
 */
export async function handleDeleteProject(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  projectId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const deleted = store.delete(projectId);

    if (!deleted) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Project not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'project_delete' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to delete project' } })
      );
    }
  }
}

/**
 * 获取项目看板
 * GET /v1/workspaces/:id/projects/:projectId/board
 */
export async function handleGetProjectBoard(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  projectId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const board = store.buildBoard(projectId);

    if (!board) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Project not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(board));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'project_board' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get project board' } })
      );
    }
  }
}

/**
 * 获取项目级规则
 * GET /v1/workspaces/:id/projects/:projectId/rules
 */
export async function handleGetProjectRules(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  projectId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const project = store.get(projectId);

    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Project not found' } }));
      return;
    }

    const rules = store.getRules(projectId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: rules }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'project_rules' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to get project rules' } })
      );
    }
  }
}

/**
 * 更新项目级规则
 * PUT /v1/workspaces/:id/projects/:projectId/rules
 */
export async function handleUpdateProjectRules(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  projectId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { content } = JSON.parse(body || '{}');

    if (content === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'content is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const project = store.get(projectId);

    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Project not found' } }));
      return;
    }

    store.saveRules(projectId, content);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'project_rules_update',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to update project rules' } })
      );
    }
  }
}

/**
 * 获取工作项模板列表
 * GET /v1/workspaces/:id/templates
 */
export async function handleGetTemplates(
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
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const templates = store.getTemplates();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(templates));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'templates_list' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to list templates' } })
      );
    }
  }
}

/**
 * 按模板创建工作项
 * POST /v1/workspaces/:id/projects/:projectId/items
 */
export async function handleCreateProjectWorkItem(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  projectId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { title, description, type } = JSON.parse(body || '{}');

    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'title is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);

    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const manager = createLiriConfigManager(wsPath);
    const workItemStore = createWorkItemStore(manager.dir, manager);
    const store = createProjectStore(manager.dir, workItemStore);
    const item = store.createWorkItemFromTemplate(projectId, {
      title,
      description,
      type,
    });

    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Project not found' } }));
      return;
    }

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(item));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'project_item_create',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Failed to create project work item' },
        })
      );
    }
  }
}
