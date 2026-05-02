/**
 * 快捷键管理模块
 * 管理键位绑定和映射
 */

import { z } from 'zod';
import { ACTIONS, getActionById, type Action, type ActionType } from './actions';

export interface Keybinding {
  key: string;
  actionId: string;
  context?: string[];
  description?: string;
}

export interface KeybindingConfig {
  bindings: Keybinding[];
  enabled: boolean;
  mode: 'vim' | 'emacs' | 'custom';
}

export const KeybindingSchema = z.object({
  key: z.string(),
  actionId: z.string(),
  context: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export const KeybindingConfigSchema = z.object({
  bindings: z.array(KeybindingSchema),
  enabled: z.boolean(),
  mode: z.enum(['vim', 'emacs', 'custom']),
});

export class KeybindingManager {
  private config: KeybindingConfig;
  private keyMap: Map<string, Keybinding[]>;

  constructor(config?: Partial<KeybindingConfig>) {
    this.config = {
      bindings: [],
      enabled: true,
      mode: 'vim',
      ...config,
    };
    this.keyMap = new Map();
    this.initializeDefaultBindings();
  }

  /**
   * 初始化默认键位绑定
   */
  private initializeDefaultBindings(): void {
    ACTIONS.forEach(action => {
      action.defaultKeybindings.forEach(key => {
        this.addBinding({
          key,
          actionId: action.id,
          context: action.context,
          description: action.description,
        });
      });
    });
  }

  /**
   * 添加键位绑定
   */
  addBinding(binding: Keybinding): void {
    const existing = this.keyMap.get(binding.key) || [];
    existing.push(binding);
    this.keyMap.set(binding.key, existing);
    this.config.bindings.push(binding);
  }

  /**
   * 移除键位绑定
   */
  removeBinding(key: string, actionId?: string): void {
    const bindings = this.keyMap.get(key) || [];
    
    if (actionId) {
      this.keyMap.set(key, bindings.filter(b => b.actionId !== actionId));
      this.config.bindings = this.config.bindings.filter(
        b => !(b.key === key && b.actionId === actionId)
      );
    } else {
      this.keyMap.delete(key);
      this.config.bindings = this.config.bindings.filter(b => b.key !== key);
    }
  }

  /**
   * 获取键位绑定
   */
  getBinding(key: string, context?: string): Keybinding | undefined {
    const bindings = this.keyMap.get(key) || [];
    
    if (!context) {
      return bindings[0];
    }

    return bindings.find(b => {
      if (!b.context) return true;
      return b.context.includes(context);
    });
  }

  /**
   * 获取所有键位绑定
   */
  getAllBindings(): Keybinding[] {
    return this.config.bindings;
  }

  /**
   * 获取动作的所有绑定
   */
  getBindingsForAction(actionId: string): Keybinding[] {
    return this.config.bindings.filter(b => b.actionId === actionId);
  }

  /**
   * 获取上下文相关的绑定
   */
  getBindingsForContext(context: string): Keybinding[] {
    return this.config.bindings.filter(b => {
      if (!b.context) return true;
      return b.context.includes(context);
    });
  }

  /**
   * 处理按键事件
   */
  handleKey(key: string, context: string = 'global'): Action | undefined {
    if (!this.config.enabled) return undefined;

    const binding = this.getBinding(key, context);
    if (!binding) return undefined;

    return getActionById(binding.actionId);
  }

  /**
   * 获取配置
   */
  getConfig(): KeybindingConfig {
    return this.config;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<KeybindingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 验证配置
   */
  validateConfig(config: KeybindingConfig): boolean {
    const result = KeybindingConfigSchema.safeParse(config);
    return result.success;
  }

  /**
   * 导出配置
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * 导入配置
   */
  importConfig(configJson: string): boolean {
    try {
      const config = JSON.parse(configJson);
      const result = KeybindingConfigSchema.safeParse(config);
      
      if (!result.success) {
        return false;
      }

      this.config = result.data;
      this.keyMap.clear();
      
      this.config.bindings.forEach(binding => {
        const existing = this.keyMap.get(binding.key) || [];
        existing.push(binding);
        this.keyMap.set(binding.key, existing);
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取模式
   */
  getMode(): 'vim' | 'emacs' | 'custom' {
    return this.config.mode;
  }

  /**
   * 设置模式
   */
  setMode(mode: 'vim' | 'emacs' | 'custom'): void {
    this.config.mode = mode;
  }

  /**
   * 启用/禁用快捷键
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

/**
 * 创建快捷键管理器实例
 */
export function createKeybindingManager(config?: Partial<KeybindingConfig>): KeybindingManager {
  return new KeybindingManager(config);
}

/**
 * 解析按键字符串
 */
export function parseKeyString(keyStr: string): string[] {
  return keyStr.split(' ');
}

/**
 * 格式化按键字符串
 */
export function formatKeyString(keys: string[]): string {
  return keys.join(' ');
}