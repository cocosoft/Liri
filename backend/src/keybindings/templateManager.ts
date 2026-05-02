/**
 * 模板管理器模块
 * 管理按键绑定模板的加载、切换和自定义
 */

import { KeybindingsSchema, KeybindingTemplateSchema, validateTemplate } from './validation';
import { templates, getTemplate, getTemplateObject } from './templates';

export interface TemplateManagerOptions {
  defaultMode?: 'vi' | 'emacs' | 'default';
  autoLoad?: boolean;
}

export class TemplateManager {
  private currentMode: 'vi' | 'emacs' | 'default';
  private customBindings: KeybindingsSchema = [];
  private disabledBindings: string[] = [];

  constructor(options?: TemplateManagerOptions) {
    this.currentMode = options?.defaultMode || 'default';
    
    if (options?.autoLoad) {
      this.loadFromStorage();
    }
  }

  /**
   * 获取当前模式
   */
  getCurrentMode(): 'vi' | 'emacs' | 'default' {
    return this.currentMode;
  }

  /**
   * 设置当前模式
   */
  setCurrentMode(mode: 'vi' | 'emacs' | 'default'): void {
    this.currentMode = mode;
    this.saveToStorage();
  }

  /**
   * 获取当前模式的按键绑定
   */
  getCurrentBindings(): KeybindingsSchema {
    const template = getTemplate(this.currentMode);
    if (!template) return [];

    // 过滤掉禁用的绑定
    const enabledTemplate = template.filter(b => !this.disabledBindings.includes(b.id));
    
    // 合并自定义绑定（覆盖模板）
    const merged = [...enabledTemplate];
    const seenIds = new Set(template.map(b => b.id));

    this.customBindings.forEach(custom => {
      const existingIndex = merged.findIndex(b => b.id === custom.id);
      if (existingIndex >= 0) {
        merged[existingIndex] = custom;
      } else if (!seenIds.has(custom.id)) {
        merged.push(custom);
      }
    });

    return merged;
  }

  /**
   * 获取模板列表
   */
  getTemplateList(): KeybindingTemplateSchema[] {
    return Object.keys(templates).map(name => {
      const template = getTemplateObject(name);
      return template!;
    });
  }

  /**
   * 添加自定义绑定
   */
  addCustomBinding(binding: KeybindingsSchema[0]): boolean {
    try {
      validateTemplate({ bindings: [binding], id: 'custom', name: 'custom', mode: this.currentMode });
      
      const existingIndex = this.customBindings.findIndex(b => b.id === binding.id);
      if (existingIndex >= 0) {
        this.customBindings[existingIndex] = binding;
      } else {
        this.customBindings.push(binding);
      }
      
      this.saveToStorage();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 移除自定义绑定
   */
  removeCustomBinding(id: string): boolean {
    const initialLength = this.customBindings.length;
    this.customBindings = this.customBindings.filter(b => b.id !== id);
    const removed = initialLength !== this.customBindings.length;
    
    if (removed) {
      this.saveToStorage();
    }
    
    return removed;
  }

  /**
   * 获取所有自定义绑定
   */
  getCustomBindings(): KeybindingsSchema {
    return [...this.customBindings];
  }

  /**
   * 禁用绑定
   */
  disableBinding(id: string): void {
    if (!this.disabledBindings.includes(id)) {
      this.disabledBindings.push(id);
      this.saveToStorage();
    }
  }

  /**
   * 启用绑定
   */
  enableBinding(id: string): void {
    this.disabledBindings = this.disabledBindings.filter(b => b !== id);
    this.saveToStorage();
  }

  /**
   * 检查绑定是否禁用
   */
  isBindingDisabled(id: string): boolean {
    return this.disabledBindings.includes(id);
  }

  /**
   * 获取所有禁用的绑定
   */
  getDisabledBindings(): string[] {
    return [...this.disabledBindings];
  }

  /**
   * 重置为默认模板
   */
  resetToDefault(): void {
    this.customBindings = [];
    this.disabledBindings = [];
    this.saveToStorage();
  }

  /**
   * 切换模式
   */
  toggleMode(): void {
    const modes: ('vi' | 'emacs' | 'default')[] = ['default', 'vi', 'emacs'];
    const currentIndex = modes.indexOf(this.currentMode);
    this.currentMode = modes[(currentIndex + 1) % modes.length];
    this.saveToStorage();
  }

  /**
   * 保存到本地存储
   */
  private saveToStorage(): void {
    try {
      const data = JSON.stringify({
        currentMode: this.currentMode,
        customBindings: this.customBindings,
        disabledBindings: this.disabledBindings,
      });
      localStorage.setItem('pyapp-keybindings', data);
    } catch {
      // 忽略存储错误
    }
  }

  /**
   * 从本地存储加载
   */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem('pyapp-keybindings');
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.currentMode) {
          this.currentMode = parsed.currentMode;
        }
        if (parsed.customBindings) {
          this.customBindings = parsed.customBindings;
        }
        if (parsed.disabledBindings) {
          this.disabledBindings = parsed.disabledBindings;
        }
      }
    } catch {
      // 忽略加载错误
    }
  }

  /**
   * 导出配置
   */
  exportConfig(): string {
    return JSON.stringify({
      currentMode: this.currentMode,
      customBindings: this.customBindings,
      disabledBindings: this.disabledBindings,
    }, null, 2);
  }

  /**
   * 导入配置
   */
  importConfig(config: string): boolean {
    try {
      const parsed = JSON.parse(config);
      
      if (parsed.currentMode && ['vi', 'emacs', 'default'].includes(parsed.currentMode)) {
        this.currentMode = parsed.currentMode;
      }
      if (Array.isArray(parsed.customBindings)) {
        this.customBindings = parsed.customBindings;
      }
      if (Array.isArray(parsed.disabledBindings)) {
        this.disabledBindings = parsed.disabledBindings;
      }
      
      this.saveToStorage();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 创建模板管理器实例
 */
export function createTemplateManager(options?: TemplateManagerOptions): TemplateManager {
  return new TemplateManager(options);
}

/**
 * 全局模板管理器实例
 */
export const templateManager = createTemplateManager({ autoLoad: true });
