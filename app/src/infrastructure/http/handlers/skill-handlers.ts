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
import { handleError } from '@modules/error/handleError';

/**
 * 获取 ClawHubAdapter 实例
 */
async function getClawHubAdapter(): Promise<any> {
  try {
    const { thirdPartyAdapterRegistry } =
      await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
    const registered = thirdPartyAdapterRegistry.get('clawhub');
    if (registered) {
      return registered;
    }
  } catch {
    // 注册表不可用时 fallback
  }

  const { ClawHubAdapter } =
    await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');
  const adapter = ClawHubAdapter.getInstance();
  if (!adapter['initialized']) {
    await adapter.initialize();
  }
  return adapter;
}

// ========== SkillCRUD Handlers ==========

export async function handleCreateSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { skillId, sourceUrl } = JSON.parse(body);

      if (!skillId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'skillId is required' } }));
        return;
      }

      const adapter = await getClawHubAdapter();
      const skill = await adapter.installSkill(skillId, sourceUrl);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(skill));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

export async function handleUpdateSkillById(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      const skill = await adapter.updateSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(skill));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

export async function handleDeleteSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      await adapter.uninstallSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({}));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

export async function handleEnableSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      await adapter.enableSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ id: skillId, status: 'enabled' }));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

export async function handleDisableSkill(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await getClawHubAdapter();
      await adapter.disableSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ id: skillId, status: 'disabled' }));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }
