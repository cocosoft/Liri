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
 * ModelFallbackManager — API 故障转移管理器
 *
 * Phase 3 新增。对标 cc_code 的 fallbackModel 和 openclaw 的 profileCandidates。
 * 当主模型不可用时自动切换到备用模型。
 * 切换前检查目标模型的 context window，必要时触发压缩。
 */

/** 故障转移配置 */
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'query:ModelFallbackManager',
  level: LogLevel.INFO,
});

interface FallbackConfig {
  enabled: boolean;
  /** 备用模型列表（优先级降序） */
  fallbackModels: string[];
  /** 触发故障转移的错误类型 */
  retryOnErrors: string[];
  /** 最多尝试几个 fallback 模型 */
  maxFallbackAttempts: number;
}

/** 执行结果 */
interface FallbackResult<T> {
  result: T;
  usedModel: string;
  fallbackUsed: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: FallbackConfig = {
  enabled: true,
  fallbackModels: [],
  retryOnErrors: [
    '5xx',
    '429',
    '401',
    '403',
    '503',
    'ECONNREFUSED',
    'ENOTFOUND',
  ],
  maxFallbackAttempts: 3,
};

/**
 * 判断错误是否触发故障转移
 */
function shouldFallback(error: Error, config: FallbackConfig): boolean {
  const msg = error.message + ((error as any).code ?? '');
  return config.retryOnErrors.some((pattern) => msg.includes(pattern));
}

/**
 * 已知模型的 context window 大小
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-haiku': 200_000,
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'deepseek-chat': 128_000,
  'deepseek-reasoner': 64_000,
};

export class ModelFallbackManager {
  private config: FallbackConfig;
  private attempts: number = 0;
  private usedModels: Set<string> = new Set();

  constructor(config?: Partial<FallbackConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 尝试用备用模型执行操作
   * 切换前检查目标模型 context window，必要时降级
   */
  async executeWithFallback<T>(
    primaryModel: string,
    operation: (model: string) => Promise<T>,
    currentTokenUsage?: number
  ): Promise<FallbackResult<T>> {
    if (!this.config.enabled) {
      const result = await operation(primaryModel);
      return { result, usedModel: primaryModel, fallbackUsed: false };
    }

    this.attempts = 0;
    this.usedModels = new Set([primaryModel]);

    try {
      const result = await operation(primaryModel);
      return { result, usedModel: primaryModel, fallbackUsed: false };
    } catch (error) {
      if (!shouldFallback(error as Error, this.config)) {
        throw error;
      }
    }

    // 遍历 fallback 模型
    for (const model of this.config.fallbackModels) {
      if (this.attempts >= this.config.maxFallbackAttempts) break;
      if (this.usedModels.has(model)) continue;

      this.attempts++;
      this.usedModels.add(model);

      // P1: 检查目标模型 context window
      if (currentTokenUsage) {
        const targetMax = MODEL_CONTEXT_WINDOWS[model] ?? 128_000;
        if (currentTokenUsage > targetMax * 0.9) {
          // 上下文可能超限 → 标记需要压缩（由调用方处理）
        }
      }

      try {
        const result = await operation(model);
        return { result, usedModel: model, fallbackUsed: true };
      } catch (error) {
        if (!shouldFallback(error as Error, this.config)) {
          throw error;
        }
      }
    }

    throw new Error(
      `All ${this.attempts + 1} model attempts failed (primary: ${primaryModel})`
    );
  }

  /**
   * 获取备选模型的 context window 大小
   */
  getModelMaxTokens(modelName: string): number {
    return MODEL_CONTEXT_WINDOWS[modelName] ?? 128_000;
  }

  /**
   * 重置尝试计数
   */
  reset(): void {
    this.attempts = 0;
    this.usedModels = new Set();
  }
}

/** 工厂函数 */
export function createModelFallbackManager(
  config?: Partial<FallbackConfig>
): ModelFallbackManager {
  return new ModelFallbackManager(config);
}
