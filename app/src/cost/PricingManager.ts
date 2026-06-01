//
/**
 * 定价管理器
 * 用于管理模型定价的更新和版本控制
 */

import { logForDebugging } from '../utils/debug.js';
import { ModelPricing } from './ModelPricing.js';
import { ModelRegistry } from '@modules/ai/models/ModelRegistry';

/**
 * 定价版本信息
 */
export interface PricingVersion {
  /** 版本号 */
  version: string;
  /** 更新时间戳 */
  timestamp: number;
  /** 更新描述 */
  description: string;
  /** 定价配置 */
  pricing: Record<string, ModelPricing>;
}

/**
 * 定价更新历史
 */
export class PricingUpdateHistory {
  private history: PricingVersion[] = [];
  private maxHistorySize: number = 100;

  /**
   * 添加定价更新记录
   */
  addUpdate(version: PricingVersion): void {
    this.history.push(version);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
    logForDebugging('定价更新记录已添加', {
      version: version.version,
      description: version.description,
    });
  }

  /**
   * 获取更新历史
   */
  getHistory(): PricingVersion[] {
    return [...this.history];
  }

  /**
   * 获取最新版本
   */
  getLatestVersion(): PricingVersion | undefined {
    return this.history[this.history.length - 1];
  }

  /**
   * 获取指定版本
   */
  getVersion(version: string): PricingVersion | undefined {
    return this.history.find((v) => v.version === version);
  }

  /**
   * 清空历史
   */
  clear(): void {
    this.history = [];
    logForDebugging('定价更新历史已清空');
  }
}

/**
 * 定价管理器
 */
export class PricingManager {
  private currentPricing: Record<string, ModelPricing>;
  private version: string = '1.0.0';
  private updateHistory: PricingUpdateHistory;
  private listeners: Set<(version: string) => void> = new Set();

  constructor() {
    this.currentPricing = {};
    this.updateHistory = new PricingUpdateHistory();
    this.updateHistory.addUpdate({
      version: this.version,
      timestamp: Date.now(),
      description: '初始定价配置',
      pricing: { ...this.currentPricing },
    });
    logForDebugging('定价管理器已初始化', { version: this.version });
  }

  /**
   * 获取当前定价
   */
  getCurrentPricing(): Record<string, ModelPricing> {
    return { ...this.currentPricing };
  }

  /**
   * 获取模型定价
   * 优先查询本地定价，回退到 ModelRegistry
   */
  getModelPricing(modelName: string): ModelPricing | undefined {
    const local = this.currentPricing[modelName];
    if (local) return local;

    try {
      const registry = ModelRegistry.getInstance();
      const pricing = registry.getModelPricing(modelName);
      if (pricing) {
        const fullPricing = registry.getModel(modelName)?.pricing;
        return {
          inputPricePerMillion: pricing.inputPer1M,
          outputPricePerMillion: pricing.outputPer1M,
          cacheReadPricePerMillion: fullPricing?.cacheReadPer1M ?? 0,
          cacheCreationPricePerMillion: fullPricing?.cacheWritePer1M ?? 0,
          webSearchPricePerRequest: 0.01,
        };
      }
    } catch {
      // ModelRegistry 不可用时忽略
    }

    return undefined;
  }

  /**
   * 设置模型定价
   */
  setModelPricing(modelName: string, pricing: ModelPricing): void {
    const oldPricing = this.currentPricing[modelName];
    this.currentPricing[modelName] = pricing;
    logForDebugging('模型定价已更新', {
      modelName,
      oldPricing,
      newPricing: pricing,
    });
  }

  /**
   * 批量更新定价
   */
  updatePricing(
    pricing: Record<string, ModelPricing>,
    description: string
  ): void {
    const oldPricing = { ...this.currentPricing };
    this.currentPricing = { ...this.currentPricing, ...pricing };

    // 更新版本号
    this.version = this.incrementVersion(this.version);

    // 添加更新记录
    this.updateHistory.addUpdate({
      version: this.version,
      timestamp: Date.now(),
      description,
      pricing: { ...this.currentPricing },
    });

    logForDebugging('定价已批量更新', { version: this.version, description });

    // 通知监听器
    this.notifyListeners(this.version);
  }

  /**
   * 添加模型定价
   */
  addModelPricing(modelName: string, pricing: ModelPricing): void {
    if (this.currentPricing[modelName]) {
      logForDebugging(`模型 ${modelName} 已存在，将覆盖`, { level: 'warn' });
    }
    this.currentPricing[modelName] = pricing;
    logForDebugging('模型定价已添加', { modelName, pricing });
  }

  /**
   * 删除模型定价
   */
  removeModelPricing(modelName: string): void {
    if (!this.currentPricing[modelName]) {
      logForDebugging(`模型 ${modelName} 不存在`, { level: 'warn' });
      return;
    }
    delete this.currentPricing[modelName];
    logForDebugging('模型定价已删除', { modelName });
  }

  /**
   * 获取当前版本
   */
  getVersion(): string {
    return this.version;
  }

  /**
   * 获取更新历史
   */
  getUpdateHistory(): PricingVersion[] {
    return this.updateHistory.getHistory();
  }

  /**
   * 获取最新版本信息
   */
  getLatestVersionInfo(): PricingVersion | undefined {
    return this.updateHistory.getLatestVersion();
  }

  /**
   * 回滚到指定版本
   */
  rollbackToVersion(version: string): boolean {
    const versionInfo = this.updateHistory.getVersion(version);
    if (!versionInfo) {
      logForDebugging(`版本 ${version} 不存在`, { level: 'error' });
      return false;
    }

    this.currentPricing = { ...versionInfo.pricing };
    this.version = version;
    logForDebugging('已回滚到指定版本', { version });

    // 通知监听器
    this.notifyListeners(this.version);

    return true;
  }

  /**
   * 注册定价变更监听器
   */
  onPricingChange(listener: (version: string) => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除定价变更监听器
   */
  offPricingChange(listener: (version: string) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知定价变更监听器
   */
  private notifyListeners(version: string): void {
    for (const listener of this.listeners) {
      try {
        listener(version);
      } catch (error) {
        logForDebugging(
          `定价变更监听器执行失败: ${error instanceof Error ? error.message : String(error)}`,
          { level: 'error' }
        );
      }
    }
  }

  /**
   * 增加版本号
   */
  private incrementVersion(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2]++; // 增加补丁版本号
    return parts.join('.');
  }

  /**
   * 导出定价配置
   */
  exportPricing(): string {
    const data = {
      version: this.version,
      timestamp: Date.now(),
      pricing: this.currentPricing,
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * 导入定价配置
   */
  importPricing(json: string, description: string): boolean {
    try {
      const data = JSON.parse(json);
      if (!data.pricing || typeof data.pricing !== 'object') {
        logForDebugging('无效的定价配置格式', { level: 'error' });
        return false;
      }

      this.updatePricing(data.pricing, description);
      return true;
    } catch (error) {
      logForDebugging(
        `导入定价配置失败: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'error' }
      );
      return false;
    }
  }
}

/**
 * 全局定价管理器实例
 */
export const pricingManager = new PricingManager();

/**
 * 获取当前定价
 */
export function getCurrentPricing(): Record<string, ModelPricing> {
  return pricingManager.getCurrentPricing();
}

/**
 * 获取模型定价
 */
export function getModelPricing(modelName: string): ModelPricing | undefined {
  return pricingManager.getModelPricing(modelName);
}

/**
 * 设置模型定价
 */
export function setModelPricing(
  modelName: string,
  pricing: ModelPricing
): void {
  pricingManager.setModelPricing(modelName, pricing);
}

/**
 * 批量更新定价
 */
export function updatePricing(
  pricing: Record<string, ModelPricing>,
  description: string
): void {
  pricingManager.updatePricing(pricing, description);
}

/**
 * 添加模型定价
 */
export function addModelPricing(
  modelName: string,
  pricing: ModelPricing
): void {
  pricingManager.addModelPricing(modelName, pricing);
}

/**
 * 删除模型定价
 */
export function removeModelPricing(modelName: string): void {
  pricingManager.removeModelPricing(modelName);
}

/**
 * 获取当前版本
 */
export function getPricingVersion(): string {
  return pricingManager.getVersion();
}

/**
 * 获取更新历史
 */
export function getPricingUpdateHistory(): PricingVersion[] {
  return pricingManager.getUpdateHistory();
}

/**
 * 回滚到指定版本
 */
export function rollbackToVersion(version: string): boolean {
  return pricingManager.rollbackToVersion(version);
}

/**
 * 导出定价配置
 */
export function exportPricing(): string {
  return pricingManager.exportPricing();
}

/**
 * 导入定价配置
 */
export function importPricing(json: string, description: string): boolean {
  return pricingManager.importPricing(json, description);
}
