/**
 * 团队管理 API Handler
 *
 * RESTful API for Team CRUD and member management
 * - GET    /v1/workspaces/:id/teams
 * - POST   /v1/workspaces/:id/teams
 * - GET    /v1/workspaces/:id/teams/:teamId
 * - PUT    /v1/workspaces/:id/teams/:teamId
 * - DELETE /v1/workspaces/:id/teams/:teamId
 * - POST   /v1/workspaces/:id/teams/:teamId/members
 * - DELETE /v1/workspaces/:id/teams/:teamId/members/:memberId
 * - PUT    /v1/workspaces/:id/teams/:teamId/members/:memberId/role
 */

import type http from 'node:http';
import * as path from 'node:path';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { createTeamStore } from '@modules/workspace/TeamStore';
import { resolveWorkspacePath } from './workspaces-handlers';

/**
 * 获取或创建 TeamStore
 */
function getTeamStore(wsPath: string) {
  const teamsDir = path.join(wsPath, '.liri', 'teams');
  return createTeamStore(teamsDir);
}

/**
 * 列出团队
 * GET /v1/workspaces/:id/teams
 */
export async function handleListTeams(
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

    const store = getTeamStore(wsPath);
    const teams = store.list(workspaceId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(teams));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'list_teams' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to list teams' } }));
    }
  }
}

/**
 * 创建团队
 * POST /v1/workspaces/:id/teams
 */
export async function handleCreateTeam(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body || '{}');

    if (!data.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Team name is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const store = getTeamStore(wsPath);
    const team = store.create({
      workspaceId,
      name: data.name,
      description: data.description || '',
      members: data.members || [],
      tags: data.tags,
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(team));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'create_team' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to create team' } }));
    }
  }
}

/**
 * 获取团队详情
 * GET /v1/workspaces/:id/teams/:teamId
 */
export async function handleGetTeam(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  teamId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const store = getTeamStore(wsPath);
    const team = store.get(teamId);

    if (!team) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Team not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(team));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'get_team' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to get team' } }));
    }
  }
}

/**
 * 更新团队
 * PUT /v1/workspaces/:id/teams/:teamId
 */
export async function handleUpdateTeam(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  teamId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body || '{}');

    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const store = getTeamStore(wsPath);
    const team = store.update(teamId, data);

    if (!team) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Team not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(team));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'update_team' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to update team' } }));
    }
  }
}

/**
 * 删除团队
 * DELETE /v1/workspaces/:id/teams/:teamId
 */
export async function handleDeleteTeam(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  teamId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const store = getTeamStore(wsPath);
    const deleted = store.delete(teamId);

    if (!deleted) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Team not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'delete_team' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Failed to delete team' } }));
    }
  }
}

/**
 * 添加团队成员
 * POST /v1/workspaces/:id/teams/:teamId/members
 */
export async function handleAddTeamMember(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  teamId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body || '{}');

    if (!data.id || !data.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Member id and name are required' },
        })
      );
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const store = getTeamStore(wsPath);
    const team = store.addMember(teamId, {
      id: data.id,
      name: data.name,
      role: data.role || 'member',
      isAgent: data.isAgent || false,
      model: data.model,
    });

    if (!team) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Team not found' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(team));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'add_team_member' });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to add team member' } })
      );
    }
  }
}

/**
 * 移除团队成员
 * DELETE /v1/workspaces/:id/teams/:teamId/members/:memberId
 */
export async function handleRemoveTeamMember(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  teamId: string,
  memberId: string
): Promise<void> {
  try {
    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const store = getTeamStore(wsPath);
    const team = store.removeMember(teamId, memberId);

    if (!team) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Team or member not found' } })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(team));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'remove_team_member',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to remove team member' } })
      );
    }
  }
}

/**
 * 更新成员角色
 * PUT /v1/workspaces/:id/teams/:teamId/members/:memberId/role
 */
export async function handleUpdateMemberRole(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceId: string,
  teamId: string,
  memberId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = JSON.parse(body || '{}');

    if (!data.role) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Role is required' } }));
      return;
    }

    const wsPath = await resolveWorkspacePath(workspaceId);
    if (!wsPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Workspace not found' } }));
      return;
    }

    const store = getTeamStore(wsPath);
    const team = store.updateMemberRole(teamId, memberId, data.role);

    if (!team) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Team or member not found' } })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(team));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'update_member_role',
    });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Failed to update member role' } })
      );
    }
  }
}
