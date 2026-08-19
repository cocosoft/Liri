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
 * ModelCapabilityProbe — 统一模型能力探测
 *
 * 探测模型是否支持工具调用（tool_use）、视觉（vision）等核心能力，
 * 供「添加模型后自动检测」「模型列表手动检测」使用。
 *
 * 策略按 Provider 实现分派，静态优先（免费、毫秒级、不消耗推理资源）：
 *  - Ollama:  GET /api/show（template 工具槽位 + projector_info）
 *  - llama.cpp: /props（chat_template_caps）
 *  - 其他 Provider: 跳过（云端能力由用户在 UI 配置，避免发真实请求消耗额度）
 *
 * 探测结果可持久化到 model_registry.capabilities（DB 为唯一事实来源），
 * 与现有能力标签合并，不覆盖用户手动配置。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { AIProvider } from '../providers/AIProvider';
import { providerRegistry } from '../providers/ProviderRegistry';
import { modelPricingService } from '../models/ModelPricingService';

const logger = getLogger('ai:capabilityProbe');

/** 单项能力的探测值：true=支持，false=不支持，unknown=无法判定 */
export type ProbeValue = boolean | 'unknown';

/** 探测结果 */
export interface CapabilityProbeResult {
  modelId: string;
  providerType: string | null;
  tool_use: ProbeValue;
  vision: ProbeValue;
  /** 探测方式：static=静态探测，skipped=跳过（云端），failed=失败 */
  method: 'static' | 'skipped' | 'failed';
}

/** 实现 probeCapabilities 的 Provider（本地可静态探测的扩展点） */
type ProbeableProvider = AIProvider & {
  probeCapabilities(model: string): Promise<{
    tool_use: ProbeValue;
    vision: ProbeValue;
  }>;
};

export class ModelCapabilityProbe {
  /**
   * 探测模型能力。通过 model_registry 定位 Provider，按实现分派静态探测。
   * 探测失败/不可探测返回 unknown/skipped，不抛异常（不阻断主流程）。
   */
  async probe(modelId: string): Promise<CapabilityProbeResult> {
    const { syncDBProvidersToRegistry } =
      await import('../providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    const providerId = providerRegistry.resolveModelToProviderId(modelId);
    const provider = providerId ? providerRegistry.get(providerId) : undefined;
    const providerType = provider
      ? (providerRegistry.getProviderTypeById(provider.id) ?? provider.id)
      : null;

    if (!provider) {
      logger.debug('能力探测：模型对应 Provider 未找到', { modelId });
      return {
        modelId,
        providerType,
        tool_use: 'unknown',
        vision: 'unknown',
        method: 'failed',
      };
    }

    // 本地可静态探测的 Provider（实现 probeCapabilities 即纳入）
    const probeable = provider as ProbeableProvider;
    if (typeof probeable.probeCapabilities === 'function') {
      try {
        const { tool_use, vision } = await probeable.probeCapabilities(modelId);
        logger.info('能力探测完成（static）', {
          modelId,
          providerType,
          tool_use,
          vision,
        });
        return { modelId, providerType, tool_use, vision, method: 'static' };
      } catch (err) {
        await handleError(err, {
          module: 'ai:modelManagement',
          action: 'probeCapabilities',
        });
        return {
          modelId,
          providerType,
          tool_use: 'unknown',
          vision: 'unknown',
          method: 'failed',
        };
      }
    }

    logger.debug('能力探测：该 Provider 不支持静态探测，跳过', {
      modelId,
      providerType,
    });
    return {
      modelId,
      providerType,
      tool_use: 'unknown',
      vision: 'unknown',
      method: 'skipped',
    };
  }

  /**
   * 将探测结果持久化到 model_registry.capabilities（与现有能力合并，不覆盖）。
   * 仅写入探测确认 true/false 的能力；unknown 不写入。
   * 返回是否成功（模型不存在返回 false）。
   */
  async persist(
    modelId: string,
    result: CapabilityProbeResult
  ): Promise<boolean> {
    try {
      await modelPricingService.initialize();
      const existing = await modelPricingService.getPricing(modelId);
      if (!existing) return false;

      const base = new Set<string>(existing.capabilities || []);
      if (result.tool_use === true) base.add('tool_use');
      else if (result.tool_use === false) base.delete('tool_use');
      if (result.vision === true) base.add('vision');
      else if (result.vision === false) base.delete('vision');

      const capabilities = Array.from(base);
      await modelPricingService.upsertPricing({
        modelId,
        capabilities,
        // upsertPricing 的必填字段：沿用现有价格避免被清空
        inputCostPerMillion: existing.inputCostPerMillion ?? 0,
        outputCostPerMillion: existing.outputCostPerMillion ?? 0,
      });

      // 刷新运行时缓存，保证数出同源
      const { ModelRegistry } = await import('../models/ModelRegistry.js');
      ModelRegistry.getInstance()
        .refreshDbPricing()
        .catch((er: unknown) => {
          // @ignore-catch: 非关键缓存刷新
          logger.warning('refreshDbPricing 失败', {
            modelId,
            error: (er as Error).message,
          });
        });
      const { modelRouter } = await import('../modelRouter.js');
      modelRouter.invalidateUuidCache().catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('invalidateUuidCache 失败', {
          modelId,
          error: (er as Error).message,
        });
      });

      logger.info('能力探测结果已持久化', { modelId, capabilities });
      return true;
    } catch (err) {
      await handleError(err, {
        module: 'ai:modelManagement',
        action: 'probePersist',
      });
      return false;
    }
  }
}

export const modelCapabilityProbe = new ModelCapabilityProbe();

/** 单例访问 */
export function getModelCapabilityProbe(): ModelCapabilityProbe {
  return modelCapabilityProbe;
}
