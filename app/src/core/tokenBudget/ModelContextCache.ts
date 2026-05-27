/**
 * 模型上下文窗口缓存
 *
 * 集中管理所有可用模型的上下文窗口信息，提供带 TTL 的缓存机制。
 * 支持从 ALL_MODEL_CONFIGS 和 PriceManager 两个来源自动发现。
 *
 * 使用场景：
 * - TokenBudgetController 初始化时优先从缓存获取 contextWindow
 * - TokenBudgetManagerImpl.setModel() 可降级使用缓存
 * - 系统启动时调用 applyDiscoveredContextWindows() 预填充
 */

import {
  ALL_MODEL_CONFIGS,
  getModelKeyByName,
} from '@modules/ai/models/ModelConfigs';
import { priceManager } from './PriceManager';

/** TTL 默认值: 5 分钟 */
const CACHE_TTL_MS = 5 * 60 * 1000;

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
 * 特性：
 * - 带 TTL 的自动过期
 * - 多来源自动发现（ModelConfigs / PriceManager）
 * - 更新时触发注册的回调
 */
export class ModelContextCache {
  private cache = new Map<string, ModelContextInfo>();
  private readonly ttl: number;
  private listeners: Array<() => void> = [];

  constructor(ttlMs: number = CACHE_TTL_MS) {
    this.ttl = ttlMs;
  }

  /**
   * 获取指定模型的上下文窗口信息
   * 已过期的条目自动删除并返回 null
   */
  get(modelName: string): ModelContextInfo | null {
    const entry = this.cache.get(modelName);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > this.ttl) {
      this.cache.delete(modelName);
      return null;
    }
    return entry;
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
    return this.get(modelName) !== null;
  }

  /** 获取所有缓存条目（自动清理过期条目） */
  getAll(): Map<string, ModelContextInfo> {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > this.ttl) {
        this.cache.delete(key);
      }
    }
    return new Map(this.cache);
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
    return this.cache.size;
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
      } catch {
        // 忽略单个监听器异常，确保其他监听器继续执行
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
    const models = [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-haiku-4-5',
      'deepseek-chat',
      'deepseek-reasoner',
      'gpt-4o',
      'gpt-4',
      'gpt-3.5-turbo',
    ];
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
      } catch {
        // 模型未在 PriceManager 中注册，跳过
      }
    }
    return count;
  }

  /** 从所有可用来源发现并缓存模型上下文窗口 */
  discoverAll(): DiscoveryResult {
    const beforeSize = this.cache.size;
    const modelConfigsCount = this.discoverFromModelConfigs();
    const priceManagerCount = this.discoverFromPriceManager();
    return {
      discovered: modelConfigsCount + priceManagerCount,
      total: this.cache.size,
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
