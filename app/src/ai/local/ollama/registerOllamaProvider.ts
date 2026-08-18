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
 * ensureOllamaProviderRegistered — Ollama provider 注册（DB providers 表 → Registry）+ 模型同步
 *
 * 遵循 §1.5 模型数据一致性：仅经 ProviderManager 写 DB，再经 syncDBProvidersToRegistry 同步。
 *
 * 模型数据真实化（方案 C）：
 *   - YAML 不再种子任何本地（Ollama/llama.cpp）模型；
 *   - Ollama 模型全部来自运行时 /api/tags 实际扫描，且同步时删除
 *     model_registry 中"归属本 provider 但本地已不存在"的模型，保证 DB 只有真实可用的模型。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('ai:ollama');

const OLLAMA_PROVIDER_TYPE = 'ollama' as const;
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
/** 注册默认上下文窗口：现代本地模型可运行的安全操作窗口上限（探测失败时的兜底） */
const DEFAULT_OLLAMA_CONTEXT_WINDOW = 32768;

interface OllamaTag {
  name: string;
}

/** 探测本地 Ollama 服务并返回已安装模型名列表（不可达返回空） */
async function fetchOllamaTags(baseUrl: string): Promise<OllamaTag[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: OllamaTag[] };
    return data.models || [];
  } catch (err) {
    logger.debug('Ollama /api/tags 探测失败', {
      error: (err as Error).message,
    });
    return [];
  }
}

/**
 * 探测 Ollama 模型真实原生上下文长度（model_info['llama.context_length']）。
 * 这是该模型 num_ctx 的硬上限：若应用侧窗口超过它，Ollama 会直接拒绝
 * （"requested context length exceeds model max"）。失败返回 null（用注册默认值兜底）。
 * 与 llama.cpp probeLlamaNctx 同构：DB 跟随服务端真实值，而非配置抄写/硬编码。
 */
async function probeOllamaContextLength(
  baseUrl: string,
  modelName: string
): Promise<number | null> {
  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      model_info?: Record<string, unknown>;
    };
    const raw = data.model_info?.['llama.context_length'];
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * 同步 Ollama 真实模型到 model_registry（幂等）
 * 1. 删除 model_registry 中归属本 provider 但本地已不存在的模型（清理假数据）
 * 2. upsert 本地实际安装的模型
 * @returns 本次新增注册的模型数
 */
export async function syncOllamaModelsToRegistry(): Promise<number> {
  try {
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();
    const provider = (await providerManager.listProviders()).find(
      (p) => p.providerType === OLLAMA_PROVIDER_TYPE
    );
    if (!provider) return 0;
    const providerId = provider.id;
    const baseUrl = (provider.baseUrl || DEFAULT_OLLAMA_URL).replace(
      /\/+$/,
      ''
    );

    const tags = await fetchOllamaTags(baseUrl);
    if (tags.length === 0) {
      logger.debug('Ollama 可达但无已安装模型，跳过同步');
      return 0;
    }
    const localNames = new Set(tags.map((t) => t.name));

    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    await modelPricingService.initialize();

    const existingModels = await modelPricingService.getAllPricing();

    // 1. 清理：归属本 provider 但本地已不存在的模型
    let removed = 0;
    for (const m of existingModels) {
      if (m.providerId === providerId && !localNames.has(m.modelId)) {
        if (await modelPricingService.deleteModelById(m.id)) removed++;
      }
    }

    // 2. 注册：本地真实模型（已归属本 provider 的跟随真实窗口；被其他 provider 占用的跳过）
    let registered = 0;
    let updated = 0;
    for (const name of localNames) {
      // 探测真实上下文（llama.context_length），失败回退默认安全窗口。
      // min(真实, 默认) 兜底：既避免小窗口模型被 32768 撑爆 KV 缓存 OOM，
      // 也避免 num_ctx 超过模型原生上限被 Ollama 拒绝。
      const realCtx = await probeOllamaContextLength(baseUrl, name);
      const contextWindow = realCtx
        ? Math.min(realCtx, DEFAULT_OLLAMA_CONTEXT_WINDOW)
        : DEFAULT_OLLAMA_CONTEXT_WINDOW;

      const existing = await modelPricingService.getPricing(name);
      if (existing && existing.providerId === providerId) {
        // 已注册且归属本 provider：窗口与当前探测不一致则更新（跟随服务端真实值）
        if (existing.contextWindow !== contextWindow) {
          await modelPricingService.upsertPricing({
            modelId: name,
            contextWindow,
            inputCostPerMillion: existing.inputCostPerMillion,
            outputCostPerMillion: existing.outputCostPerMillion,
          });
          updated++;
        }
        continue;
      }
      if (existing && existing.providerId !== providerId) continue;
      await modelPricingService.upsertPricing({
        modelId: name,
        displayName: name,
        providerId,
        contextWindow,
        maxOutputTokens: 8192,
        capabilities: ['streaming', 'function_calling', 'tool_use'],
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
      });
      registered++;
    }

    if (registered > 0 || updated > 0 || removed > 0) {
      const { ModelRegistry } =
        await import('@modules/ai/models/ModelRegistry.js');
      ModelRegistry.getInstance()
        .refreshDbPricing()
        .catch((er: unknown) => {
          // @ignore-catch: 非关键缓存刷新
          logger.warning('refreshDbPricing 失败(ollama sync)', {
            error: (er as Error).message,
          });
        });
      const { modelRouter } = await import('@modules/ai/modelRouter.js');
      modelRouter.invalidateUuidCache().catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('invalidateUuidCache 失败(ollama sync)', {
          error: (er as Error).message,
        });
      });
      logger.info(
        `Ollama 模型同步: 新增 ${registered}，更新 ${updated}，清理 ${removed}`
      );
    }
    return registered;
  } catch (err) {
    await handleError(err, {
      module: 'ai:ollama',
      action: 'syncOllamaModelsToRegistry',
    });
    return 0;
  }
}

/**
 * 确保 Ollama provider 已注册到 DB 与 Registry，并同步真实模型
 * @returns 是否注册成功（本地 Ollama 服务不可用返回 false）
 */
export async function ensureOllamaProviderRegistered(): Promise<boolean> {
  try {
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();

    const existing = await providerManager.listProviders();
    const record = existing.find(
      (p) => p.providerType === OLLAMA_PROVIDER_TYPE
    );

    let baseUrl = DEFAULT_OLLAMA_URL;
    if (record) {
      baseUrl = (record.baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
    } else {
      await providerManager.createProvider({
        name: 'Ollama',
        providerType: OLLAMA_PROVIDER_TYPE,
        baseUrl,
        requiresAuth: false,
        isActive: true,
        category: 'third_party',
      });
      logger.info(`Ollama provider 已注册: ${baseUrl}`);
    }

    // 探测本地服务；不可达则不强制同步（用户可能稍后启动 Ollama）
    const tags = await fetchOllamaTags(baseUrl);
    if (tags.length === 0) {
      logger.debug('Ollama 服务不可达或无模型，跳过模型同步');
      return false;
    }

    const { syncDBProvidersToRegistry } =
      await import('@modules/ai/providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    // 本地真实模型同步到 model_registry（幂等）
    await syncOllamaModelsToRegistry();
    return true;
  } catch (err) {
    await handleError(err, {
      module: 'ai:ollama',
      action: 'ensureOllamaProviderRegistered',
    });
    return false;
  }
}
