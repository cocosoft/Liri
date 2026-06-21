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
// IMPLIED, BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type http from 'node:http';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';

/**
 * 获取 ClawHubAdapter 实例
 */
async function getClawHubAdapter(): Promise<unknown> {
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

/**
 * 创建（安装）技能
 */
export async function handleCreateSkill(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
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
    broadcastEvent('skill:created', { skill });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 更新指定技能
 */
export async function handleUpdateSkillById(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    const skill = await adapter.updateSkill(skillId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(skill));
    broadcastEvent('skill:updated', { skill });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除（卸载）技能
 */
export async function handleDeleteSkill(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    await adapter.uninstallSkill(skillId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({}));
    broadcastEvent('skill:deleted', { skillId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 启用技能
 */
export async function handleEnableSkill(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    await adapter.enableSkill(skillId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ id: skillId, status: 'enabled' }));
    broadcastEvent('skill:enabled', { skillId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 禁用技能
 */
export async function handleDisableSkill(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  skillId: string
): Promise<void> {
  try {
    const adapter = await getClawHubAdapter();
    await adapter.disableSkill(skillId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ id: skillId, status: 'disabled' }));
    broadcastEvent('skill:disabled', { skillId });
  } catch (err) {
    sendError(res, err);
  }
}
