//
/**
 * AI状态同步服务
 * 负责将AI模型状态与AppState同步
 */

import { getGlobalStore } from '../core/state/AppStateStore.js';
import type { AppState } from '../core/state/AppState.js';
import { getAIModelManager } from './AIModelManager.js';
import { getModelStringService } from './ModelStringService.js';

/**
 * AI状态
 */
export interface AIState {
  /** 当前模型 */
  currentModel: string;
  /** 模型别名 */
  modelAlias: string | null;
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 是否支持1M上下文 */
  supports1MContext: boolean;
  /** 模型显示名称 */
  modelDisplayName: string;
  /** 模型价格信息 */
  modelPricing: string;
  /** 模型族 */
  modelFamily: string;
  /** 可用模型列表 */
  availableModels: string[];
  /** 模型别名列表 */
  modelAliases: string[];
}

/**
 * AI状态同步服务
 */
export class AIStateSyncService {
  private store = getGlobalStore();
  private modelManager = getAIModelManager();
  private modelStringService = getModelStringService();

  /**
   * 更新AI状态
   */
  updateAIState(model: string): void {
    const resolvedModel = this.modelManager.parseUserSpecifiedModel(model);
    const contextWindow = this.modelManager.getContextWindow(resolvedModel);
    const supports1M = this.modelManager.supports1MContext(resolvedModel);
    const displayName = this.modelManager.getModelDisplayName(resolvedModel);
    const pricing = this.modelManager.getModelPricingString(resolvedModel);
    const family = this.modelManager.getModelFamily(resolvedModel);
    const availableModels = this.modelManager.getAvailableModels();
    const modelAliases = this.modelManager.getModelAliases();

    this.store.setState(prev => ({
      ...prev,
      model: resolvedModel,
      modelAlias: model !== resolvedModel ? model : null,
      // 其他AI相关状态
    }));
  }

  /**
   * 获取当前AI状态
   */
  getAIState(): AIState {
    const state = this.store.getState();
    const currentModel = state.model || this.modelStringService.getDefaultMainLoopModel();
    const resolvedModel = this.modelManager.parseUserSpecifiedModel(currentModel);
    
    return {
      currentModel: resolvedModel,
      modelAlias: state.modelAlias,
      contextWindow: this.modelManager.getContextWindow(resolvedModel),
      supports1MContext: this.modelManager.supports1MContext(resolvedModel),
      modelDisplayName: this.modelManager.getModelDisplayName(resolvedModel),
      modelPricing: this.modelManager.getModelPricingString(resolvedModel),
      modelFamily: this.modelManager.getModelFamily(resolvedModel),
      availableModels: this.modelManager.getAvailableModels(),
      modelAliases: this.modelManager.getModelAliases(),
    };
  }

  /**
   * 重置AI状态
   */
  resetAIState(): void {
    const defaultModel = this.modelStringService.getDefaultMainLoopModel();
    this.updateAIState(defaultModel);
  }

  /**
   * 设置当前模型
   */
  setCurrentModel(model: string): void {
    this.updateAIState(model);
  }

  /**
   * 获取当前模型
   */
  getCurrentModel(): string {
    const state = this.store.getState();
    return state.model || this.modelStringService.getDefaultMainLoopModel();
  }

  /**
   * 获取当前模型显示名称
   */
  getCurrentModelDisplayName(): string {
    const currentModel = this.getCurrentModel();
    return this.modelManager.getModelDisplayName(currentModel);
  }

  /**
   * 检查当前模型是否支持1M上下文
   */
  getCurrentModelSupports1M(): boolean {
    const currentModel = this.getCurrentModel();
    return this.modelManager.supports1MContext(currentModel);
  }

  /**
   * 获取当前模型上下文窗口大小
   */
  getCurrentModelContextWindow(): number {
    const currentModel = this.getCurrentModel();
    return this.modelManager.getContextWindow(currentModel);
  }

  /**
   * 获取可用模型列表
   */
  getAvailableModels(): string[] {
    return this.modelManager.getAvailableModels();
  }

  /**
   * 获取模型别名列表
   */
  getModelAliases(): string[] {
    return this.modelManager.getModelAliases();
  }
}

/**
 * 全局AI状态同步服务实例
 */
let globalAIStateSyncService: AIStateSyncService | null = null;

/**
 * 获取全局AI状态同步服务
 */
export function getAIStateSyncService(): AIStateSyncService {
  if (!globalAIStateSyncService) {
    globalAIStateSyncService = new AIStateSyncService();
  }
  return globalAIStateSyncService;
}

/**
 * 重置全局AI状态同步服务
 */
export function resetAIStateSyncService(): AIStateSyncService {
  globalAIStateSyncService = new AIStateSyncService();
  return globalAIStateSyncService;
}
