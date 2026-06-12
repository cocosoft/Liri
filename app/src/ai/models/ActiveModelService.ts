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
 * 运行时活跃模型查询服务
 *
 * 封装 model_pricing 表的 enabled 查询，提供 30s 缓存。
 * 作为全项目活跃模型列表的「单一事实来源」。
 *
 * 使用方式:
 *   import { activeModelService } from './ActiveModelService.js';
 *   const modelId = await activeModelService.getEffectiveModel('ollama');
 *
 * 历史说明：重命名自 ActiveModelProvider（原名有 Provider 后缀但非 AI Provider），
 * 更名为 ActiveModelService 以消除与 AIProvider 的歧义。
 */

import { modelPricingService, type ModelPricingRecord } from './ModelPricingService.js';

const CACHE_TTL_MS = 30_000;

class ActiveModelService {
  private cache: { models: ModelPricingRecord[]; timestamp: number } | null = null;

  /** 获取所有启用模型的 ModelPricingRecord 列表 */
  async getActiveModels(): Promise<ModelPricingRecord[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < CACHE_TTL_MS) {
      return this.cache.models;
    }
    await modelPricingService.initialize();
    const all = await modelPricingService.getAllPricing();
    const active = all.filter((m) => m.enabled);
    this.cache = { models: active, timestamp: now };
    return active;
  }

  /** 获取所有启用模型的 ID 列表 */
  async getActiveModelIds(): Promise<string[]> {
    const models = await this.getActiveModels();
    return models.map((m) => m.modelId);
  }

  /** 验证模型是否可用（存在且 enabled） */
  async isModelAvailable(modelId: string): Promise<boolean> {
    const models = await this.getActiveModels();
    return models.some((m) => m.modelId === modelId);
  }

  /**
   * 获取有效的模型 ID
   *
   * 优先级：
   *   1. preferredModel（如果存在且启用）
   *   2. preferredProvider 下的第一个启用模型
   *   3. 全局第一个启用模型
   *   4. null（无可用模型）
   */
  async getEffectiveModel(
    preferredModel?: string,
    preferredProvider?: string,
  ): Promise<string | null> {
    const active = await this.getActiveModels();
    if (!active.length) return null;

    // 1. 首选指定模型（如果启用）
    if (preferredModel && active.some((m) => m.modelId === preferredModel)) {
      return preferredModel;
    }

    // 2. 指定 provider 的第一个启用模型
    if (preferredProvider) {
      const byProvider = active.filter((m) => m.providerId === preferredProvider);
      if (byProvider.length) return byProvider[0].modelId;
    }

    // 3. 全局第一个启用模型
    return active[0].modelId;
  }

  /** 获取指定 provider 的启用模型 */
  async getActiveModelsByProvider(providerId: string): Promise<ModelPricingRecord[]> {
    const all = await this.getActiveModels();
    return all.filter((m) => m.providerId === providerId);
  }

  /** 清除缓存，下次查询重新加载 */
  refreshCache(): void {
    this.cache = null;
  }
}

export const activeModelService = new ActiveModelService();
