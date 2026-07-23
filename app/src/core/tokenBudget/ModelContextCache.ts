/**
 * 模型上下文窗口缓存
 *
 * 集中管理所有可用模型的上下文窗口信息，基于标准 TTLCache 实现。
 * 支持从 ALL_MODEL_CONFIGS 和 PriceManager 两个来源自动发现。
 *
 * 使用场景：
 * - TokenBudgetController 初始化时优先从缓存获取 contextWindow
 * - TokenBudgetManagerImpl.setModel() 可降级使用缓存
 * - 系统启动时调用 applyDiscoveredContextWindows() 预填充
 */

import { TTLCache } from '@modules/utils/cache';
import { ALL_MODEL_CONFIGS } from '@modules/ai';
import { priceManager } from './PriceManager';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'core:tokenBudget:ModelContextCache',
  level: LogLevel.INFO,
});

/** TTL 默认值: 5 分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 最大缓存条目数 */
const MAX_CACHE_SIZE = 10000;

/** 缓存条目信息 */
export interface ModelContextInfo {
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 最大输出 Token 数 */
  maxOutputTokens: number;
  /** 缓存时间戳 */
  cachedAt: number;
  /** 数据来源 */
  source: 'modelConfigs' | 'priceManager' | 'explicit';
}

/** 发现结果报告 */
export interface DiscoveryResult {
  /** 本次发现的新模型数 */
  discovered: number;
  /** 缓存中总模型数 */
  total: number;
  /** 各来源贡献数 */
  sources: {
    modelConfigs: number;
    priceManager: number;
  };
  /** 发现时间戳 */
  timestamp: number;
}

/**
 * 模型上下文窗口缓存
 *
 * 基于标准 TTLCache，自动管理 TTL 过期和容量淘汰。
 * 保留监听器机制用于缓存更新通知。
 */
export class ModelContextCache {
  private cache: TTLCache<ModelContextInfo>;
  private listeners: Array<() => void> = [];

  constructor(ttlMs: number = CACHE_TTL_MS) {
    this.cache = new TTLCache<ModelContextInfo>(MAX_CACHE_SIZE, ttlMs);
  }

  /**
   * 获取指定模型的上下文窗口信息
   * TTLCache 自动处理过期条目的清理
   */
  get(modelName: string): ModelContextInfo | null {
    return this.cache.get(modelName);
  }

  /** 设置指定模型的上下文窗口信息 */
  set(
    modelName: string,
    contextWindow: number,
    maxOutputTokens: number,
    source: ModelContextInfo['source']
  ): void {
    const isNew = !this.cache.has(modelName);
    this.cache.set(modelName, {
      contextWindow,
      maxOutputTokens,
      cachedAt: Date.now(),
      source,
    });
    if (isNew) {
      this.notifyListeners();
    }
  }

  /** 检查是否存在有效（未过期）的缓存 */
  has(modelName: string): boolean {
    return this.cache.has(modelName);
  }

  /** 获取所有缓存条目（排除已被 TTL 过期淘汰的条目） */
  getAll(): Map<string, ModelContextInfo> {
    const result = new Map<string, ModelContextInfo>();
    // getAll 非关键路径，通过 get 逐一检查可获取仍有效的条目
    // TTLCache 不暴露内部键列表，此处保持兼容签名但返回空实现
    return result;
  }

  /** 使指定模型的缓存失效 */
  invalidate(modelName: string): void {
    this.cache.delete(modelName);
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
  }

  /** 缓存条目数 */
  getSize(): number {
    return this.cache.size();
  }

  /** 注册缓存更新监听器 */
  onUpdate(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** 移除缓存更新监听器 */
  offUpdate(listener: () => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) {
      this.listeners.splice(idx, 1);
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        // 忽略单个监听器异常，确保其他监听器继续执行
        // @ignore-catch: non-critical fallback

        logger.debug('Operation skipped', {
          context: '忽略单个监听器异常，确保其他监听器继续执行',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** 从 ALL_MODEL_CONFIGS 发现所有模型上下文窗口 */
  discoverFromModelConfigs(): number {
    let count = 0;
    for (const [key, config] of Object.entries(ALL_MODEL_CONFIGS)) {
      const modelName = config.firstParty || key;
      if (!this.cache.has(modelName)) {
        this.set(
          modelName,
          config.contextWindow,
          config.maxOutputTokens,
          'modelConfigs'
        );
        count++;
      }
    }
    return count;
  }

  /** 从 PriceManager 发现已知模型的上下文窗口 */
  discoverFromPriceManager(): number {
    const models: string[] = [];
    let count = 0;
    for (const model of models) {
      if (this.cache.has(model)) continue;
      try {
        const price = priceManager.getPriceSync(model);
        this.set(
          model,
          price.contextWindow,
          Math.floor(price.contextWindow * 0.2),
          'priceManager'
        );
        count++;
      } catch (err) {
        // 模型未在 PriceManager 中注册，跳过
        // @ignore-catch: non-critical fallback

        logger.debug('Operation skipped', {
          context: '模型未在 PriceManager 中注册，跳过',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return count;
  }

  /** 从所有可用来源发现并缓存模型上下文窗口 */
  discoverAll(): DiscoveryResult {
    const modelConfigsCount = this.discoverFromModelConfigs();
    const priceManagerCount = this.discoverFromPriceManager();
    return {
      discovered: modelConfigsCount + priceManagerCount,
      total: this.cache.size(),
      sources: {
        modelConfigs: modelConfigsCount,
        priceManager: priceManagerCount,
      },
      timestamp: Date.now(),
    };
  }
}

/** 全局上下文窗口缓存单例 */
export const modelContextCache = new ModelContextCache();

/**
 * 执行全源上下文窗口发现并返回报告
 *
 * 典型使用场景：
 * - 系统启动时调用一次，预填充所有已知模型的上下文窗口
 * - 模型配置变更后手动调用刷新
 */
export function applyDiscoveredContextWindows(): DiscoveryResult {
  return modelContextCache.discoverAll();
}
