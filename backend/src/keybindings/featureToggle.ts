//
/**
 * 特性开关绑定
 * 动态启用或禁用特定的按键绑定
 */
import type { ParsedBinding, KeybindingContextName } from './types.js';
import React from 'react';

/**
 * 特性开关配置
 */
export interface FeatureToggleConfig {
  /** 特性名称 */
  name: string;
  /** 特性描述 */
  description: string;
  /** 是否默认启用 */
  enabledByDefault: boolean;
  /** 依赖的特性（需要先启用） */
  dependencies?: string[];
  /** 冲突的特性（不能同时启用） */
  conflicts?: string[];
  /** 特性绑定的动作列表 */
  actions: string[];
}

/**
 * 特性开关状态
 */
export interface FeatureToggleState {
  /** 特性名称 */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** 启用时间 */
  enabledAt?: Date;
  /** 禁用时间 */
  disabledAt?: Date;
  /** 启用次数 */
  enableCount: number;
  /** 最后使用时间 */
  lastUsedAt?: Date;
}

/**
 * 特性开关管理器
 */
export class FeatureToggleManager {
  private features: Map<string, FeatureToggleConfig> = new Map();
  private states: Map<string, FeatureToggleState> = new Map();
  private listeners: Set<(feature: string, enabled: boolean) => void> = new Set();

  /**
   * 注册特性
   */
  registerFeature(config: FeatureToggleConfig): void {
    this.features.set(config.name, config);
    
    // 初始化状态
    if (!this.states.has(config.name)) {
      this.states.set(config.name, {
        name: config.name,
        enabled: config.enabledByDefault,
        enableCount: config.enabledByDefault ? 1 : 0,
        enabledAt: config.enabledByDefault ? new Date() : undefined
      });
    }
  }

  /**
   * 启用特性
   */
  enableFeature(name: string): boolean {
    const config = this.features.get(name);
    if (!config) {
      console.warn(`特性未注册: ${name}`);
      return false;
    }

    const state = this.states.get(name)!;
    
    // 检查依赖
    if (config.dependencies) {
      for (const dep of config.dependencies) {
        const depState = this.states.get(dep);
        if (!depState || !depState.enabled) {
          console.warn(`特性 ${name} 依赖的特性 ${dep} 未启用`);
          return false;
        }
      }
    }

    // 检查冲突
    if (config.conflicts) {
      for (const conflict of config.conflicts) {
        const conflictState = this.states.get(conflict);
        if (conflictState && conflictState.enabled) {
          console.warn(`特性 ${name} 与特性 ${conflict} 冲突`);
          return false;
        }
      }
    }

    // 启用特性
    state.enabled = true;
    state.enabledAt = new Date();
    state.enableCount++;

    // 通知监听器
    this.notifyListeners(name, true);

    return true;
  }

  /**
   * 禁用特性
   */
  disableFeature(name: string): boolean {
    const config = this.features.get(name);
    if (!config) {
      console.warn(`特性未注册: ${name}`);
      return false;
    }

    const state = this.states.get(name)!;
    
    // 检查是否有特性依赖此特性
    for (const [otherName, otherConfig] of this.features) {
      if (otherConfig.dependencies?.includes(name)) {
        const otherState = this.states.get(otherName);
        if (otherState && otherState.enabled) {
          console.warn(`无法禁用特性 ${name}，因为特性 ${otherName} 依赖它`);
          return false;
        }
      }
    }

    // 禁用特性
    state.enabled = false;
    state.disabledAt = new Date();

    // 通知监听器
    this.notifyListeners(name, false);

    return true;
  }

  /**
   * 切换特性状态
   */
  toggleFeature(name: string): boolean {
    const state = this.states.get(name);
    if (!state) {
      console.warn(`特性未注册: ${name}`);
      return false;
    }

    return state.enabled ? this.disableFeature(name) : this.enableFeature(name);
  }

  /**
   * 检查特性是否启用
   */
  isFeatureEnabled(name: string): boolean {
    const state = this.states.get(name);
    return state ? state.enabled : false;
  }

  /**
   * 获取特性状态
   */
  getFeatureState(name: string): FeatureToggleState | undefined {
    return this.states.get(name);
  }

  /**
   * 获取所有特性状态
   */
  getAllFeatureStates(): FeatureToggleState[] {
    return Array.from(this.states.values());
  }

  /**
   * 记录特性使用
   */
  recordFeatureUsage(name: string): void {
    const state = this.states.get(name);
    if (state && state.enabled) {
      state.lastUsedAt = new Date();
    }
  }

  /**
   * 订阅特性变更
   */
  subscribe(listener: (feature: string, enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 通知监听器
   */
  private notifyListeners(feature: string, enabled: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(feature, enabled);
      } catch (error) {
        console.error('Error in feature toggle listener:', error);
      }
    }
  }

  /**
   * 根据特性过滤绑定
   */
  filterBindingsByFeatures(bindings: ParsedBinding[]): ParsedBinding[] {
    return bindings.filter(binding => {
      // 检查绑定是否属于某个特性
      for (const [featureName, config] of this.features) {
        if (config.actions.includes(binding.action)) {
          return this.isFeatureEnabled(featureName);
        }
      }
      
      // 不属于任何特性的绑定默认启用
      return true;
    });
  }

  /**
   * 获取启用的特性列表
   */
  getEnabledFeatures(): string[] {
    return Array.from(this.states.entries())
      .filter(([, state]) => state.enabled)
      .map(([name]) => name);
  }

  /**
   * 获取禁用的特性列表
   */
  getDisabledFeatures(): string[] {
    return Array.from(this.states.entries())
      .filter(([, state]) => !state.enabled)
      .map(([name]) => name);
  }

  /**
   * 重置特性状态
   */
  resetFeature(name: string): boolean {
    const config = this.features.get(name);
    if (!config) {
      return false;
    }

    this.states.set(name, {
      name: config.name,
      enabled: config.enabledByDefault,
      enableCount: config.enabledByDefault ? 1 : 0,
      enabledAt: config.enabledByDefault ? new Date() : undefined
    });

    this.notifyListeners(name, config.enabledByDefault);

    return true;
  }

  /**
   * 批量启用特性
   */
  enableFeatures(names: string[]): { success: string[]; failed: string[] } {
    const success: string[] = [];
    const failed: string[] = [];

    for (const name of names) {
      if (this.enableFeature(name)) {
        success.push(name);
      } else {
        failed.push(name);
      }
    }

    return { success, failed };
  }

  /**
   * 批量禁用特性
   */
  disableFeatures(names: string[]): { success: string[]; failed: string[] } {
    const success: string[] = [];
    const failed: string[] = [];

    for (const name of names) {
      if (this.disableFeature(name)) {
        success.push(name);
      } else {
        failed.push(name);
      }
    }

    return { success, failed };
  }
}

/**
 * 默认特性配置
 */
export const DEFAULT_FEATURE_CONFIGS: FeatureToggleConfig[] = [
  {
    name: 'advancedNavigation',
    description: '高级导航功能',
    enabledByDefault: true,
    actions: [
      'app:quickOpen',
      'app:globalSearch',
      'history:search',
      'app:switchWindow'
    ]
  },
  {
    name: 'productivity',
    description: '生产力工具',
    enabledByDefault: true,
    actions: [
      'app:save',
      'app:copyAll',
      'app:clearAll',
      'app:reload',
      'app:undo',
      'app:copy'
    ]
  },
  {
    name: 'developerTools',
    description: '开发者工具',
    enabledByDefault: false,
    actions: [
      'dev:debug',
      'dev:profile',
      'dev:inspect',
      'dev:console'
    ]
  },
  {
    name: 'accessibility',
    description: '辅助功能',
    enabledByDefault: true,
    actions: [
      'access:highContrast',
      'access:screenReader',
      'access:zoom',
      'access:voiceControl'
    ]
  },
  {
    name: 'experimental',
    description: '实验性功能',
    enabledByDefault: false,
    dependencies: ['developerTools'],
    actions: [
      'exp:aiAssist',
      'exp:autoComplete',
      'exp:smartSuggest'
    ]
  }
];

/**
 * 创建默认特性管理器
 */
export function createDefaultFeatureManager(): FeatureToggleManager {
  const manager = new FeatureToggleManager();
  
  for (const config of DEFAULT_FEATURE_CONFIGS) {
    manager.registerFeature(config);
  }
  
  return manager;
}

/**
 * 特性绑定包装器
 */
export function createFeatureAwareKeybindingProvider(
  baseBindings: ParsedBinding[],
  featureManager: FeatureToggleManager
): ParsedBinding[] {
  return featureManager.filterBindingsByFeatures(baseBindings);
}

/**
 * 特性状态钩子
 */
export function useFeatureToggle(featureManager: FeatureToggleManager, featureName: string) {
  const [enabled, setEnabled] = React.useState(() => 
    featureManager.isFeatureEnabled(featureName)
  );

  React.useEffect(() => {
    const unsubscribe = featureManager.subscribe((changedFeature, isEnabled) => {
      if (changedFeature === featureName) {
        setEnabled(isEnabled);
      }
    });

    return unsubscribe;
  }, [featureManager, featureName]);

  const enable = React.useCallback(() => {
    return featureManager.enableFeature(featureName);
  }, [featureManager, featureName]);

  const disable = React.useCallback(() => {
    return featureManager.disableFeature(featureName);
  }, [featureManager, featureName]);

  const toggle = React.useCallback(() => {
    return featureManager.toggleFeature(featureName);
  }, [featureManager, featureName]);

  return {
    enabled,
    enable,
    disable,
    toggle,
    state: featureManager.getFeatureState(featureName)
  };
}

/**
 * 特性切换命令
 */
export function createFeatureToggleCommands(featureManager: FeatureToggleManager) {
  return {
    /** 启用特性 */
    enable: (featureName: string) => featureManager.enableFeature(featureName),
    
    /** 禁用特性 */
    disable: (featureName: string) => featureManager.disableFeature(featureName),
    
    /** 切换特性 */
    toggle: (featureName: string) => featureManager.toggleFeature(featureName),
    
    /** 检查特性状态 */
    status: (featureName: string) => featureManager.isFeatureEnabled(featureName),
    
    /** 列出所有特性 */
    list: () => featureManager.getAllFeatureStates(),
    
    /** 重置特性 */
    reset: (featureName: string) => featureManager.resetFeature(featureName)
  };
}

/**
 * 特性统计
 */
export function getFeatureStatistics(featureManager: FeatureToggleManager) {
  const states = featureManager.getAllFeatureStates();
  
  return {
    totalFeatures: states.length,
    enabledFeatures: states.filter(s => s.enabled).length,
    disabledFeatures: states.filter(s => !s.enabled).length,
    totalEnableCount: states.reduce((sum, s) => sum + s.enableCount, 0),
    mostUsedFeature: states.reduce((most, current) => 
      current.enableCount > (most?.enableCount || 0) ? current : most
    , undefined as FeatureToggleState | undefined),
    recentlyUsedFeatures: states
      .filter(s => s.lastUsedAt)
      .sort((a, b) => new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime())
      .slice(0, 5)
  };
}