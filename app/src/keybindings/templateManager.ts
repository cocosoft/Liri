//
/**
 * 模板管理器模块
 * 管理按键绑定模板的加载、切换和自定义
 */

import type { Keybindings, KeybindingTemplate, Keybinding } from './validation';
import { validateTemplate } from './validation';
import { templates, getTemplate, getTemplateObject } from './templates';

import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'keybindings:templateManager',
  level: LogLevel.INFO,
});

export interface TemplateManagerOptions {
  defaultMode?: 'vi' | 'emacs' | 'default';
  autoLoad?: boolean;
}

export class TemplateManager {
  private currentMode: 'vi' | 'emacs' | 'default';
  private customBindings: Keybindings = [];
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
  getCurrentBindings(): Keybindings {
    const template = getTemplate(this.currentMode);
    if (!template) return [];

    const enabledTemplate = template.filter(
      (b: Keybinding) => !this.disabledBindings.includes(b.id)
    );

    const merged = [...enabledTemplate];
    const seenIds = new Set(template.map((b: Keybinding) => b.id));

    this.customBindings.forEach((custom: Keybinding) => {
      const existingIndex = merged.findIndex(
        (b: Keybinding) => b.id === custom.id
      );
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
  getTemplateList(): KeybindingTemplate[] {
    return Object.keys(templates).map((name) => {
      const template = getTemplateObject(name);
      return template!;
    });
  }

  /**
   * 添加自定义绑定
   */
  addCustomBinding(binding: Keybinding): boolean {
    try {
      validateTemplate({
        bindings: [binding],
        id: 'custom',
        name: 'custom',
        mode: this.currentMode,
      });

      const existingIndex = this.customBindings.findIndex(
        (b: Keybinding) => b.id === binding.id
      );
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
    this.customBindings = this.customBindings.filter((b) => b.id !== id);
    const removed = initialLength !== this.customBindings.length;

    if (removed) {
      this.saveToStorage();
    }

    return removed;
  }

  /**
   * 获取所有自定义绑定
   */
  getCustomBindings(): Keybindings {
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
   * 从存储加载
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('keybinding-config');
      if (stored) {
        const config = JSON.parse(stored);
        this.currentMode = config.currentMode || 'default';
        this.customBindings = config.customBindings || [];
        this.disabledBindings = config.disabledBindings || [];
      }
    } catch (err) {
      // 忽略加载错误

      handleError(err, {
        module: 'keybindings:templateManager',
        action: 'loadCustomBindings',
      });
    }
  }

  /**
   * 保存到存储
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(
        'keybinding-config',
        JSON.stringify({
          currentMode: this.currentMode,
          customBindings: this.customBindings,
          disabledBindings: this.disabledBindings,
        })
      );
    } catch (err) {
      // 忽略保存错误

      handleError(err, {
        module: 'keybindings:templateManager',
        action: 'saveCustomBindings',
      });
    }
  }
}
