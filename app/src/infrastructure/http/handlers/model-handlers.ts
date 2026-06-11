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
 * model-handlers.ts — 模型相关 HTTP 处理器（从 LocalHTTPService 提取）
 */

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

// ── 处理器 ────────────────────────────────────────────────────────

/**
 * GET /v1/models — 模型列表（DB 驱动）
 */
export async function handleListModels(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { providerManager } = await import('@modules/ai/providers/ProviderManager.js');
    const { modelPricingService } = await import('@modules/ai/models/ModelPricingService.js');
    await providerManager.initialize();
    await modelPricingService.initialize();

    const { syncDBProvidersToRegistry } = await import('@modules/ai/providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    const providers = await providerManager.listProviders();
    const pricingList = await modelPricingService.getAllPricing();
    const pricingByModel = new Map(pricingList.map(
      (pr: {
        modelId: string; providerId?: string; displayName: string; enabled: boolean;
        inputCostPerMillion: number; outputCostPerMillion: number;
        cacheReadCostPerMillion: number; cacheWriteCostPerMillion: number;
        providerType?: string;
      }) => [pr.modelId, pr],
    ));

    const models: Array<{
      id: string; name: string; provider: string; providerId: string;
      type: string; context_length: number; enabled: boolean; requiresAuth: boolean;
      pricing?: Record<string, number>;
    }> = [];

    for (const pr of pricingList) {
      let matchingProvider;
      if (pr.providerId) {
        matchingProvider = providers.find((p) => p.id === pr.providerId);
      } else {
        matchingProvider = providers.find(
          (p) =>
            pr.modelId.startsWith(p.providerType) ||
            p.name.toLowerCase().includes(pr.modelId.split('-')[0]),
        );
      }
      models.push({
        id: pr.modelId,
        name: pr.displayName || pr.modelId,
        provider: matchingProvider?.name || pr.modelId.split('-')[0],
        providerId: matchingProvider?.id || '',
        requiresAuth: matchingProvider ? matchingProvider.requiresAuth : true,
        type: 'chat',
        context_length: 65536,
        enabled: pr.enabled !== undefined
          ? pr.enabled
          : matchingProvider ? matchingProvider.isActive : true,
        pricing: {
          inputPer1M: pr.inputCostPerMillion,
          outputPer1M: pr.outputCostPerMillion,
          cacheReadPer1M: pr.cacheReadCostPerMillion || undefined,
          cacheWritePer1M: pr.cacheWriteCostPerMillion || undefined,
        } as Record<string, number>,
      });
    }

    if (models.length === 0) {
      models.push({
        id: 'pyapp-default', name: 'Liri 默认', provider: 'pyapp', providerId: '',
        requiresAuth: false, type: 'chat', context_length: 65536, enabled: true,
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ object: 'list', data: models }));
  } catch (err) {
    logger.error('获取模型列表失败', { error: (err as Error).message });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      object: 'list',
      data: [{
        id: 'pyapp-default', name: 'Liri 默认', provider: 'pyapp', providerId: '',
        type: 'chat', context_length: 65536, enabled: true,
      }],
    }));
  }
}

/**
 * GET /v1/system/skills/:id/files/content — 系统技能文件内容
 */
export async function handleSystemSkillFileContent(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  try {
    const skillId = params?.['$1'] || '';
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const filePath = urlObj.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: 'path 参数必填' } }));
      return;
    }

    const { readFile } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { resolveProjectRoot, resolvePyappHome } = await import('@modules/core/paths');
    const pathMod = await import('node:path');

    const candidateDirs = [
      pathMod.join(resolveProjectRoot(), 'app', 'src', 'builtin', 'skills', decodeURIComponent(skillId)),
      pathMod.join(resolvePyappHome(), 'skills', decodeURIComponent(skillId)),
    ];

    let skillDir = '';
    for (const dir of candidateDirs) {
      if (existsSync(pathMod.join(dir, 'SKILL.md'))) {
        skillDir = dir;
        break;
      }
    }

    if (!skillDir) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '技能未找到' } }));
      return;
    }

    const fullPath = pathMod.join(skillDir, filePath);
    if (!existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '文件不存在' } }));
      return;
    }

    const content = await readFile(fullPath, 'utf-8');
    const ext = pathMod.extname(fullPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.md': 'text/markdown', '.txt': 'text/plain',
      '.json': 'application/json', '.ts': 'text/typescript',
      '.tsx': 'text/typescript', '.js': 'text/javascript',
      '.css': 'text/css', '.html': 'text/html',
    };
    res.writeHead(200, { 'Content-Type': `${mimeTypes[ext] || 'text/plain'}; charset=utf-8` });
    res.end(content);
  } catch (err) {
    logger.error('获取技能文件内容失败', { error: (err as Error).message });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '读取文件失败' } }));
  }
}

/**
 * POST /v1/models/test — 测试模型连接
 */
export async function handleTestModel(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { readRequestBody } = await import('./handler-utils');
    const body = await readRequestBody(req);
    const { modelId, providerId } = JSON.parse(body);

    const { syncDBProvidersToRegistry } = await import('@modules/ai/providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    const { providerRegistry } = await import('@modules/ai/providers/ProviderRegistry.js');
    const provider = providerRegistry.has(providerId) ? providerRegistry.get(providerId) : undefined;

    if (!provider) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: `Provider ${providerId} 未找到` } }));
      return;
    }

    // 发送简单测试消息
    const result = await provider.chat(
      [{ role: 'user', content: 'ping' }],
      { model: modelId, maxTokens: 10 },
    );

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, response: result }));
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/current — 获取当前模型
 */
export async function handleGetCurrentModel(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { providerRegistry } = await import('@modules/ai/providers/ProviderRegistry.js');
    const defaultProviderId = providerRegistry.getDefaultProviderId();
    let defaultModel = null;
    if (defaultProviderId && providerRegistry.has(defaultProviderId)) {
      const provider = providerRegistry.get(defaultProviderId);
      defaultModel = { id: defaultProviderId, name: provider.displayName };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(defaultModel || { id: '', name: '' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * PUT /v1/models/switch — 切换模型
 */
export async function handleSwitchModel(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { readRequestBody } = await import('./handler-utils');
    const body = await readRequestBody(req);
    const { modelId } = JSON.parse(body);
    const { providerRegistry } = await import('@modules/ai/providers/ProviderRegistry.js');
    providerRegistry.setDefaultProvider(modelId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /v1/tasks — 任务列表
 */
export async function handleGetTasks(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { taskRegistry } = await import('@modules/tasks/TaskRegistry.js');
    const tasks = taskRegistry.getAllTasks().map(t => t.taskState);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(tasks));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * POST /v1/tasks/save — 保存任务
 */
export async function handleSaveTasks(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { readRequestBody } = await import('./handler-utils');
    const body = await readRequestBody(req);
    const { tasks } = JSON.parse(body);
    const { taskRegistry } = await import('@modules/tasks/TaskRegistry.js');
    const { NoteTask } = await import('@modules/tasks/NoteTask.js');
    // 移除全部现存任务
    for (const t of taskRegistry.getAllTasks()) {
      await taskRegistry.remove(t.id);
    }
    // 注册新任务
    for (const taskData of tasks) {
      const noteTask = new NoteTask(taskData.id, taskData.description || '');
      taskRegistry.register(noteTask, taskData.id);
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * POST /v1/models/default — 设置默认模型
 */
export async function handleSetDefaultModel(
  _ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const { readRequestBody } = await import('./handler-utils');
    const body = await readRequestBody(req);
    const { modelId } = JSON.parse(body);
    const { providerRegistry } = await import('@modules/ai/providers/ProviderRegistry.js');
    providerRegistry.setDefaultProvider(modelId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}