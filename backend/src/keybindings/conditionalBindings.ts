//
/**
 * 条件绑定模块
 * 支持基于条件的动态按键绑定
 */

import type { Keybinding, Keybindings } from './validation';

export type ConditionType = 'filetype' | 'mode' | 'selection' | 'text' | 'config' | 'custom';

export interface Condition {
  type: ConditionType;
  value: string | string[];
  operator?: 'equals' | 'not_equals' | 'contains' | 'matches' | 'starts_with' | 'ends_with';
}

export interface ConditionalKeybinding extends Keybinding {
  conditions?: Condition[];
}

export class ConditionalBindingManager {
  private bindings: ConditionalKeybinding[] = [];
  private context: Record<string, unknown> = {};

  /**
   * 添加条件绑定
   */
  addBinding(binding: ConditionalKeybinding): void {
    const existingIndex = this.bindings.findIndex((b: ConditionalKeybinding) => b.id === binding.id);
    if (existingIndex >= 0) {
      this.bindings[existingIndex] = binding;
    } else {
      this.bindings.push(binding);
    }
  }

  /**
   * 移除绑定
   */
  removeBinding(id: string): boolean {
    const initialLength = this.bindings.length;
    this.bindings = this.bindings.filter((b: ConditionalKeybinding) => b.id !== id);
    return this.bindings.length !== initialLength;
  }

  /**
   * 获取所有绑定
   */
  getBindings(): ConditionalKeybinding[] {
    return [...this.bindings];
  }

  /**
   * 设置上下文
   */
  setContext(key: string, value: unknown): void {
    this.context[key] = value;
  }

  /**
   * 获取上下文
   */
  getContext(key: string): unknown {
    return this.context[key];
  }

  /**
   * 获取所有上下文
   */
  getAllContext(): Record<string, unknown> {
    return { ...this.context };
  }

  /**
   * 检查条件是否满足
   */
  checkCondition(condition: Condition): boolean {
    const contextValue = this.context[condition.type];
    
    const operator = condition.operator || 'equals';
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];

    switch (operator) {
      case 'equals':
        return values.some((v) => String(contextValue) === String(v));
      case 'not_equals':
        return !values.some((v) => String(contextValue) === String(v));
      case 'contains':
        return values.some((v) => String(contextValue).includes(String(v)));
      case 'matches':
        return values.some((v) => new RegExp(String(v)).test(String(contextValue)));
      case 'starts_with':
        return values.some((v) => String(contextValue).startsWith(String(v)));
      case 'ends_with':
        return values.some((v) => String(contextValue).endsWith(String(v)));
      default:
        return false;
    }
  }

  /**
   * 检查所有条件是否满足
   */
  checkConditions(conditions: Condition[]): boolean {
    if (!conditions || conditions.length === 0) {
      return true;
    }
    
    return conditions.every((c) => this.checkCondition(c));
  }

  /**
   * 获取满足条件的绑定
   */
  getActiveBindings(): Keybindings {
    return this.bindings.filter((b: ConditionalKeybinding) => this.checkConditions(b.conditions || []));
  }

  /**
   * 根据按键查找满足条件的绑定
   */
  findBinding(key: string, modifier?: string[]): ConditionalKeybinding | undefined {
    const activeBindings = this.getActiveBindings();
    
    return (activeBindings as ConditionalKeybinding[]).find((b: ConditionalKeybinding) => {
      const keyMatch = b.key === key;
      const modifierMatch = 
        (!modifier && !b.modifier) || 
        (modifier && b.modifier && 
          modifier.length === b.modifier.length && 
          modifier.every((m: string) => b.modifier?.includes(m)));
      
      return keyMatch && modifierMatch;
    });
  }

  /**
   * 设置文件类型上下文
   */
  setFiletype(filetype: string): void {
    this.context['filetype'] = filetype;
  }
}
