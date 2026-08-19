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
 * 模型能力探测 + 本地服务状态 REST API 处理器
 *
 * 路由前缀:
 *   POST /v1/models/probe — 探测模型能力并（可选）持久化到 model_registry.capabilities
 *   GET  /v1/providers/status — 本地服务（Ollama/llama.cpp）运行状态
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { parseBody, sendJson, sendError } from './utils.js';
import { getModelCapabilityProbe } from '../services/ModelCapabilityProbe.js';

const logger = getLogger('ai:modelCapability');

/** AIProvider 的 isAvailable 探测方法（本地服务实现） */
type AvailableProvider = { isAvailable(): Promise<boolean> };

/**
 * POST /v1/models/probe — 探测模型能力并（可选）写回 DB
 * body: { modelId: string, persist?: boolean } 默认 persist=true
 * modelId 为模型名（与 /v1/models/test 一致），内部经 model_registry 定位 Provider。
 */
export async function handleProbeModelCapability(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const modelId = body.modelId as string | undefined;
    if (!modelId) {
      sendError(res, 'modelId 不能为空', 400);
      return;
    }
    const persist = body.persist !== false;

    const probe = getModelCapabilityProbe();
    const result = await probe.probe(modelId);

    let persisted = false;
    if (persist) {
      persisted = await probe.persist(modelId, result);
    }

    logger.info('模型能力探测接口完成', {
      modelId,
      persist,
      persisted,
      toolUse: result.tool_use,
      vision: result.vision,
      method: result.method,
    });
    sendJson(res, { data: { ...result, persisted } });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'probeModelCapability',
    });
    sendError(res, `能力探测失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/providers/status — 本地服务（Ollama/llama.cpp）运行状态
 * 仅探测本地可探测的 Provider；云端 Provider 不出现在结果中。
 */
export async function handleProviderStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { syncDBProvidersToRegistry } =
      await import('../providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();
    const { providerRegistry } =
      await import('../providers/ProviderRegistry.js');

    const statuses: Array<{
      providerType: string;
      running: boolean;
      detail?: { port?: number; model?: string };
    }> = [];

    for (const provider of providerRegistry.list()) {
      const providerType =
        providerRegistry.getProviderTypeById(provider.id) ?? provider.id;
      // 仅本地可探测服务（Ollama/llama.cpp），云端不探测
      if (providerType !== 'ollama' && providerType !== 'llamacpp') continue;

      // isAvailable 不在 AIProvider 接口（本地服务特有），duck typing 判断
      const available = provider as unknown as AvailableProvider;
      let running = false;
      try {
        running =
          typeof available.isAvailable === 'function'
            ? await available.isAvailable()
            : false;
      } catch (err) {
        logger.debug('本地服务状态探测失败', {
          providerType,
          error: String(err),
        });
        running = false;
      }

      let detail: { port?: number; model?: string } | undefined;
      if (providerType === 'llamacpp') {
        const { llamaCppServerManager } =
          await import('../local/llama/LlamaCppServerManager.js');
        try {
          const st = await llamaCppServerManager.getStatus();
          detail = { port: st.port, model: st.model };
        } catch {
          // @ignore-catch: 状态详情缺失不影响 running 判定
        }
      }
      statuses.push({ providerType, running, detail });
    }

    sendJson(res, { data: statuses });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'providerStatus',
    });
    sendError(res, `获取服务状态失败: ${(err as Error).message}`, 500);
  }
}
