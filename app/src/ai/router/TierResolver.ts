// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * TierResolver — Tier → Model/Provider 映射解析器
 *
 * 职责：根据 RouterConfig.tiers 配置，将 Judge 输出的 tier 解析为
 * 具体的 model + provider。支持 providerHint 显式指定供应商，
 * 否则通过 ProviderRegistry 的模型前缀匹配自动推导。
 */

import { ProviderRegistry } from '@modules/ai';
import type { RouterConfig, RouterTier, RouteDecision } from './types.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export class TierResolver {
  constructor(
    private config: RouterConfig,
    private providerRegistry: ProviderRegistry
  ) {}

  /**
   * 根据 tier 解析出完整的路由决策
   */
  resolve(tier: RouterTier): RouteDecision {
    // 从配置中获取该 tier 的模型映射
    const tierConfig =
      this.config.tiers[tier] || this.config.tiers[this.config.defaultTier];

    if (!tierConfig) {
      logger.warning('TierResolver: 无可用 tier 配置，使用默认', { tier });
      return {
        provider: '',
        model: '',
        tier: this.config.defaultTier,
        reason: `无 tier=${tier} 配置，使用默认`,
      };
    }

    // 确定 provider
    let providerId = tierConfig.providerHint || '';
    if (!providerId) {
      // 通过模型前缀匹配 ProviderRegistry
      providerId = this.inferProvider(tierConfig.model);
    }

    logger.debug('TierResolver: 解析完成', {
      tier,
      model: tierConfig.model,
      provider: providerId,
    });

    return {
      provider: providerId,
      model: tierConfig.model,
      tier,
      reason: `TierResolver: ${tier} → ${tierConfig.model}${providerId ? ` @ ${providerId}` : ''}`,
    };
  }

  /**
   * 通过模型名前缀从 ProviderRegistry 自动匹配 provider
   *
   * 委托给 ProviderRegistry.resolveModelToProviderId()，消除重复实现。
   * resolveModelToProviderId 包含 toLowerCase 归一化处理。
   */
  private inferProvider(model: string): string {
    try {
      return this.providerRegistry.resolveModelToProviderId(model) ?? '';
    } catch {
      return '';
    }
  }

  /**
   * 更新配置（运行时 config 变化时调用）
   */
  updateConfig(config: RouterConfig): void {
    this.config = config;
  }
}
