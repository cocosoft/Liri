/**
 * 模型字符串工具服务
 * 处理模型字符串的解析、标准化和管理
 */

import { getAIModelManager } from './AIModelManager.js';

/**
 * 模型名称类型
 */
export type ModelName = string;

/**
 * 模型设置类型
 */
export type ModelSetting = ModelName | string | null;

/**
 * 模型字符串工具服务
 */
export class ModelStringService {
  private static instance: ModelStringService;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ModelStringService {
    if (!ModelStringService.instance) {
      ModelStringService.instance = new ModelStringService();
    }
    return ModelStringService.instance;
  }

  /**
   * 解析用户指定的模型
   */
  parseUserSpecifiedModel(modelInput: ModelSetting): ModelName {
    if (modelInput === null || modelInput === undefined) {
      return this.getDefaultMainLoopModel();
    }

    const manager = getAIModelManager();
    return manager.parseUserSpecifiedModel(modelInput);
  }

  /**
   * 获取默认主循环模型
   */
  getDefaultMainLoopModel(): ModelName {
    return 'claude-3-5-sonnet-20240620';
  }

  /**
   * 获取默认Opus模型
   */
  getDefaultOpusModel(): ModelName {
    return 'claude-3-opus-20240229';
  }

  /**
   * 获取默认Sonnet模型
   */
  getDefaultSonnetModel(): ModelName {
    return 'claude-3-5-sonnet-20240620';
  }

  /**
   * 获取默认Haiku模型
   */
  getDefaultHaikuModel(): ModelName {
    return 'claude-3-5-haiku-20240620';
  }

  /**
   * 标准化模型字符串用于API
   */
  normalizeModelStringForAPI(model: string): string {
    const manager = getAIModelManager();
    return manager.normalizeModelStringForAPI(model);
  }

  /**
   * 渲染模型名称
   */
  renderModelName(model: ModelName): string {
    const manager = getAIModelManager();
    return manager.getModelDisplayName(model);
  }

  /**
   * 渲染模型设置
   */
  renderModelSetting(setting: ModelSetting): string {
    if (setting === null) {
      return `Default (${this.renderModelName(this.getDefaultMainLoopModel())})`;
    }

    const resolvedModel = this.parseUserSpecifiedModel(setting);
    if (setting === resolvedModel) {
      return this.renderModelName(resolvedModel);
    }
    return `${setting} (${this.renderModelName(resolvedModel)})`;
  }

  /**
   * 检查模型是否支持1M上下文
   */
  supports1MContext(model: string): boolean {
    const manager = getAIModelManager();
    return manager.supports1MContext(model);
  }

  /**
   * 获取模型上下文窗口大小
   */
  getContextWindow(model: string): number {
    const manager = getAIModelManager();
    return manager.getContextWindow(model);
  }

  /**
   * 获取模型显示名称
   */
  getModelDisplayName(model: string): string {
    const manager = getAIModelManager();
    return manager.getModelDisplayName(model);
  }

  /**
   * 获取模型价格字符串
   */
  getModelPricingString(model: string): string {
    const manager = getAIModelManager();
    return manager.getModelPricingString(model);
  }

  /**
   * 检查是否为有效的模型
   */
  isValidModel(model: string): boolean {
    const manager = getAIModelManager();
    return manager.hasModel(model);
  }

  /**
   * 获取所有可用模型
   */
  getAvailableModels(): string[] {
    const manager = getAIModelManager();
    return manager.getAvailableModels();
  }

  /**
   * 获取所有模型别名
   */
  getModelAliases(): string[] {
    const manager = getAIModelManager();
    return manager.getModelAliases();
  }

  /**
   * 检测模型族
   */
  getModelFamily(model: string): string {
    const manager = getAIModelManager();
    return manager.getModelFamily(model);
  }
}

/**
 * 获取模型字符串工具服务实例
 */
export function getModelStringService(): ModelStringService {
  return ModelStringService.getInstance();
}

/**
 * 获取主循环模型（便捷函数）
 */
export function getMainLoopModel(): ModelName {
  const service = getModelStringService();
  return service.getDefaultMainLoopModel();
}

/**
 * 解析用户指定的模型（便捷函数）
 */
export function parseUserSpecifiedModel(model: ModelSetting): ModelName {
  const service = getModelStringService();
  return service.parseUserSpecifiedModel(model);
}

/**
 * 渲染模型名称（便捷函数）
 */
export function renderModelName(model: ModelName): string {
  const service = getModelStringService();
  return service.renderModelName(model);
}

/**
 * 渲染模型设置（便捷函数）
 */
export function renderModelSetting(setting: ModelSetting): string {
  const service = getModelStringService();
  return service.renderModelSetting(setting);
}
