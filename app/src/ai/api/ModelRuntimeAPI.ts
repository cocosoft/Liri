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
 * Model Runtime 子域 REST API 处理器
 *
 * 路由前缀: /v1/models（运行时：列表/测试/当前/切换/任务分工/阶段映射/默认模型）
 * 以及 /v1/skills/system/:id/files/content（系统技能文件内容）
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { ModelCapability } from '../models/types';
import { trackUsage } from '@modules/ai';
import {
  getModelCapabilities,
  getModelContextWindow,
} from '../models/ModelConfigs';
import { modelPricingService } from '../models/ModelPricingService.js';
import type { AIProvider } from '../providers/AIProvider.js';
import { parseBody, sendJson, sendError } from './utils.js';

/**
 * GET /v1/models — 模型列表（DB 驱动）
 */
export async function handleListModels(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('model.list', {});

  try {
    const { providerManager } = await import('../providers/ProviderManager.js');
    // modelPricingService 已通过顶部静态 import 引入
    await providerManager.initialize();
    await modelPricingService.initialize();

    const { syncDBProvidersToRegistry } =
      await import('../providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    const providers = await providerManager.listProviders();
    const pricingList = await modelPricingService.getAllPricing();
    const pricingByModel = new Map(
      pricingList.map(
        (pr: {
          modelId: string;
          providerId?: string;
          displayName: string;
          enabled: boolean;
          inputCostPerMillion: number;
          outputCostPerMillion: number;
          cacheReadCostPerMillion: number;
          cacheWriteCostPerMillion: number;
          billingMode?: string;
          pricePerRequest?: number;
          timeBasedPricing?: unknown[];
          pricingSource?: string;
          providerType?: string;
        }) => [pr.modelId, pr]
      )
    );

    const models: Array<{
      id: string; // UUID
      modelId: string; // 模型名
      name: string;
      provider: string;
      providerId: string;
      type: string;
      context_length: number;
      enabled: boolean;
      requiresAuth: boolean;
      pricing?: {
        inputPer1M: number;
        outputPer1M: number;
        cacheReadPer1M?: number;
        cacheWritePer1M?: number;
        billingMode?: string;
        pricePerRequest?: number;
        timeBasedPricing?: unknown[];
        pricingSource?: string;
      };
    }> = [];

    const { providerRegistry } =
      await import('../providers/ProviderRegistry.js');

    for (const pr of pricingList) {
      let matchingProvider:
        | {
            id: string;
            name: string;
            requiresAuth: boolean;
            isActive: boolean;
          }
        | undefined;

      // 1. 优先匹配 DB 已配置的 Provider（ProviderManager.listProviders）
      if (pr.providerId) {
        matchingProvider = providers.find((p) => p.id === pr.providerId);
        // 兼容 model_registry.provider_id 存 provider_type（如 'deepseek'）的场景：
        // 按 provider_type 匹配 ai_providers 记录，保证数出同源下模型可见可管理
        if (!matchingProvider) {
          matchingProvider = providers.find(
            (p) => p.providerType === pr.providerId
          );
        }
      } else {
        const modelProvider = providerRegistry.getByModel(pr.modelId);
        if (modelProvider) {
          matchingProvider = providers.find((p) => p.id === modelProvider.id);
        }
      }

      // 2. DB 未匹配时回退到运行时已注册的 Provider：
      //    环境变量等未落库的 Provider 也能让模型在列表中可见、可管理（数出同源兼容）
      if (!matchingProvider) {
        let runtimeProvider: AIProvider | undefined;
        if (pr.providerId) {
          try {
            // get() 找不到会抛 AppError，属正常"未注册"分支，回退到按模型名查找
            runtimeProvider = providerRegistry.get(pr.providerId);
          } catch {
            runtimeProvider = undefined;
          }
        }
        if (!runtimeProvider) {
          runtimeProvider = providerRegistry.getByModel(pr.modelId);
        }
        if (runtimeProvider) {
          matchingProvider = {
            id: runtimeProvider.id,
            name: runtimeProvider.displayName,
            requiresAuth: true,
            isActive: true,
          };
        }
      }
      const caps =
        pr.capabilities && pr.capabilities.length > 0
          ? pr.capabilities
          : getModelCapabilities(pr.modelId);
      const modelType: string = caps.includes(ModelCapability.IMAGE_GENERATION)
        ? 'image'
        : caps.includes(ModelCapability.VIDEO_GENERATION)
          ? 'video'
          : caps.includes(ModelCapability.RERANKING)
            ? 'reranking'
            : caps.includes(ModelCapability.EMBEDDING)
              ? 'embedding'
              : caps.includes(ModelCapability.TEXT_TO_SPEECH) ||
                  caps.includes(ModelCapability.SPEECH_RECOGNITION)
                ? 'voice'
                : 'chat';

      // 仅当定价记录有匹配的活跃供应商时才纳入模型列表
      // 避免 YAML 种子数据在不配置供应商时被当作可用模型展示
      if (!matchingProvider) continue;

      models.push({
        id: pr.id, // UUID
        modelId: pr.modelId, // 模型名（新增）
        name: pr.displayName || pr.modelId,
        provider: matchingProvider.name,
        providerId: matchingProvider.id,
        requiresAuth: matchingProvider.requiresAuth,
        type: modelType,
        context_length: getModelContextWindow(pr.modelId),
        enabled:
          pr.enabled !== undefined ? pr.enabled : matchingProvider.isActive,
        pricing: {
          inputPer1M: pr.inputCostPerMillion,
          outputPer1M: pr.outputCostPerMillion,
          cacheReadPer1M: pr.cacheReadCostPerMillion || undefined,
          cacheWritePer1M: pr.cacheWriteCostPerMillion || undefined,
          billingMode: pr.billingMode || 'token',
          pricePerRequest: pr.pricePerRequest || undefined,
          timeBasedPricing: pr.timeBasedPricing || undefined,
          pricingSource: pr.pricingSource || undefined,
        },
      });
    }

    // 不返回 mock 数据。若无活跃供应商对应的模型，返回空列表，
    // 前端据此引导用户前往配置页面。

    otel.endSpan(span, SpanStatusCode.OK);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ object: 'list', data: models }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listModels',
    });
    otel.endSpan(span, SpanStatusCode.ERROR, (err as Error).message);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({ error: `获取模型列表失败: ${(err as Error).message}` })
    );
  }
}

/**
 * GET /v1/skills/system/:id/files/content — 系统技能文件内容
 */
export async function handleSystemSkillFileContent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  try {
    const skillId = match?.[1] || '';
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const filePath = urlObj.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: 'path 参数必填' } }));
      return;
    }

    const { readFile } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { resolveProjectRoot, resolvePyappHome } =
      await import('@modules/core/paths');
    const pathMod = await import('path');

    const candidateDirs = [
      pathMod.join(
        resolveProjectRoot(),
        'app',
        'src',
        'builtin',
        'skills',
        decodeURIComponent(skillId)
      ),
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
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
    };
    res.writeHead(200, {
      'Content-Type': `${mimeTypes[ext] || 'text/plain'}; charset=utf-8`,
    });
    res.end(content);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getSkillFileContent',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '读取文件失败' } }));
  }
}

/**
 * POST /v1/models/test — 测试模型连接
 */
export async function handleTestModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId, providerId } = body;

    const { syncDBProvidersToRegistry } =
      await import('../providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    const { providerRegistry } =
      await import('../providers/ProviderRegistry.js');
    const provider = providerRegistry.has(providerId)
      ? providerRegistry.get(providerId)
      : undefined;

    if (!provider) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({ error: { message: `Provider ${providerId} 未找到` } })
      );
      return;
    }

    const _trackStart = Date.now();
    const result = await provider.chat([{ role: 'user', content: 'ping' }], {
      model: modelId,
      maxTokens: 10,
    });

    trackUsage(result, {
      model: modelId,
      providerId: providerId,
      latencyMs: Date.now() - _trackStart,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, response: result }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'testModel',
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/current — 获取当前模型信息
 */
export async function handleGetCurrentModel(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    const { resolveModelRoute, RouteKey } =
      await import('../router/resolveModelRoute.js');
    const { TASK_DEFINITIONS } = await import('../modelRouter.js');
    const { providerRegistry } =
      await import('../providers/ProviderRegistry.js');
    const { getTotalCostUSD } = await import('@modules/cost/CostTracker.js');

    const coreAPI = getCoreAPI();
    const lastDecision = coreAPI.getLastRouteDecision();
    const smartRouter = coreAPI.getSmartRouter();

    let routingMode: 'dynamic' | 'static' | 'off' = 'static';
    if (smartRouter?.isEnabled()) {
      routingMode = 'dynamic';
    } else if (smartRouter && !smartRouter.isEnabled()) {
      routingMode = 'off';
    }

    // 优先级：用户显式选择的模型 > 上次路由决策 > 静态路由解析
    // 用户通过状态栏/侧边栏切换模型时，handleSwitchModel 调 setModelName 存储
    // lastDecision 仅在聊天流式过程中设置，轮询时可能为空或指向旧模型
    const explicitModel = coreAPI.getModelName();
    const currentModel =
      explicitModel ||
      lastDecision?.model ||
      (await resolveModelRoute(RouteKey.CHAT));
    const defaultProviderId =
      lastDecision?.provider ?? providerRegistry.getDefaultProviderId() ?? '';

    // 查找当前模型的 UUID 并验证是否为聊天模型
    await modelPricingService.initialize();
    let currentRecord = currentModel
      ? await modelPricingService.getPricing(currentModel)
      : undefined;

    // 若当前模型为非聊天模型（如 Embedding），标记 isNonChat 让前端展示警告
    // 不再清空 currentRecord — 前端据此显示模型名 + 黄色警告而非空白
    const nonChatCaps = [
      'image_generation',
      'video_generation',
      'text_to_video',
      'image_to_video',
      'embedding',
      'text_to_speech',
      'speech_recognition',
      'reranking',
      'moderation',
      'image_editing',
    ];
    const isNonChat =
      currentRecord?.capabilities?.some((c) => nonChatCaps.includes(c)) ??
      false;

    const response = {
      modelId: currentRecord?.modelId || '',
      modelUuid: currentRecord?.id || '',
      provider: defaultProviderId,
      routerTier: lastDecision?.tier ?? null,
      routingMode,
      taskType: 'chat',
      costThisSession: getTotalCostUSD(),
      availableTasks: TASK_DEFINITIONS,
      isNonChat,
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(response));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getCurrentModel',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * POST /v1/models/switch — 切换模型
 *
 * 查找 Provider 的正确链路：模型记录 → providerId → ProviderRegistry，
 * 而非从模型名猜测（getByModel 只适用于无 DB 记录的临时模型）。
 */
export async function handleSwitchModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId } = body; // 可能是 UUID，也可能是模型名（会话 metadata.model 存模型名）
    await modelPricingService.initialize();
    // 兼容两种标识：先按 UUID 查，查不到再按 model_id（模型名）查
    let record = await modelPricingService.getPricingById(modelId);
    if (!record?.modelId) {
      record = await modelPricingService.getPricing(modelId);
    }
    if (!record?.modelId) {
      sendError(res, '模型不存在', 404);
      return;
    }
    const modelName = record.modelId;

    const { providerRegistry } =
      await import('../providers/ProviderRegistry.js');
    const { modelRouter } = await import('../modelRouter.js');

    // 正确路径：从模型记录的 providerId 查找已注册的 Provider
    let resolvedProvider: AIProvider | undefined;
    if (record.providerId) {
      const { getRegistryId, registerProviderFromDB } =
        await import('../providers/ProviderSyncService.js');
      const registryId = getRegistryId(record.providerId);
      if (registryId && providerRegistry.has(registryId)) {
        resolvedProvider = providerRegistry.get(registryId);
      } else {
        // Provider 未同步到 Registry，实时同步
        await registerProviderFromDB(record.providerId);
        const syncedId = getRegistryId(record.providerId);
        if (syncedId) {
          resolvedProvider = providerRegistry.get(syncedId);
        }
      }
    }

    if (!resolvedProvider) {
      const msg = record.providerId
        ? `模型 ${modelName} 的供应商 (${record.providerId}) 未找到或未启用`
        : `模型 ${modelName} 缺少供应商绑定`;
      sendError(res, msg, 400);
      return;
    }

    providerRegistry.setDefaultProvider(resolvedProvider.id);

    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    getCoreAPI().setModelName(modelName);

    // 持久化到 DB（current + default），同时更新 UUID→模型名 缓存
    await modelRouter.setCurrentModel(modelId, modelName);

    // data.modelId 统一返回 UUID（model_registry.id），前端 currentModelId 恒为 UUID
    sendJson(res, { data: { modelId: record.id, modelName } });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'switchModel',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/tasks/definitions — 获取任务定义列表
 */
export async function handleGetTaskDefinitions(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { TASK_DEFINITIONS } = await import('../modelRouter.js');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(TASK_DEFINITIONS));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getTaskDefinitions',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/tasks — 获取任务分工配置
 */
export async function handleGetTasks(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { modelRouter } = await import('../modelRouter.js');
    const tasks = modelRouter.getTasks();
    await modelPricingService.initialize();
    const allModels = await modelPricingService.getAllPricing();
    const modelNames: Record<string, string> = {};
    for (const m of allModels) {
      if (m.id) modelNames[m.id] = m.displayName || m.modelId;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tasks, modelNames }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getTasks',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * PUT /v1/models/tasks — 保存任务分工配置
 */
export async function handleSaveTasks(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { modelRouter } = await import('../modelRouter.js');
    await modelRouter.setTasks(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'updateTasks',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * S3: GET /v1/models/phase-mapping — 获取阶段→模型直配映射
 */
export async function handleGetPhaseMapping(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { modelRouter } = await import('../modelRouter.js');
    const mapping = modelRouter.getPhaseMapping();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(mapping));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * S3: PUT /v1/models/phase-mapping — 保存阶段→模型直配映射
 */
export async function handleSavePhaseMapping(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelRouter } = await import('../modelRouter.js');
    await modelRouter.setPhaseMapping(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/tasks/validate — 校验任务分工（检查模型能力匹配）
 */
export async function handleValidateTasks(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { modelRouter } = await import('../modelRouter.js');
    const issues = await modelRouter.validateTaskAssignment();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ valid: issues.length === 0, issues }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'validateTasks',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * PUT /v1/models/default — 设置默认模型
 *
 * 同步更新 ProviderRegistry、CoreAPI 和 ModelRouter，
 * 确保状态栏轮询和任务路由均能感知到变更。
 */
export async function handleSetDefaultModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId, providerId } = body;
    if (!modelId) {
      sendError(res, 'modelId 不能为空', 400);
      return;
    }

    await modelPricingService.initialize();

    // modelId 可以是模型名（如 "deepseek-chat"）或 UUID
    let record = await modelPricingService.getPricing(modelId);
    if (!record) {
      record = await modelPricingService.getPricingById(modelId);
    }
    if (!record) {
      sendError(res, `模型 ${modelId} 不存在`, 404);
      return;
    }

    // 设置 CoreAPI 当前模型名（状态栏轮询依赖）
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    getCoreAPI().setModelName(record.modelId);

    // 持久化到 DB 并更新 UUID 缓存
    const { modelRouter } = await import('../modelRouter.js');
    await modelRouter.setCurrentModel(record.id, record.modelId);

    // 设置默认 Provider
    if (providerId) {
      const { providerRegistry } =
        await import('../providers/ProviderRegistry.js');
      try {
        providerRegistry.setDefaultProvider(providerId);
      } catch {
        // provider 不在 Registry 中，跳过（不影响模型设置）
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'setDefaultModel',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}
