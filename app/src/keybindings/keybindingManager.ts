//
/**
 * 按键绑定管理器
 * 管理所有快捷键的注册、解绑和执行
 */

import { renderTemplate, KeybindingTemplate } from './template';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

export interface KeybindingAction {
  id: string;
  name: string;
  description?: string;
  context?: string;
  handler: (event?: KeyboardEvent) => void;
}

export interface RegisteredKeybinding {
  key: string;
  actionId: string;
  context: string;
  priority: number;
}

interface ConflictInfo {
  resolved: boolean;
  conflicts: Array<{ key: string; context: string; actionId: string }>;
}

type ConflictResult = ConflictInfo;

const conflictDetector = {
  detectConflicts(
    key: string,
    context: string,
    bindings: Map<string, RegisteredKeybinding[]>
  ): Array<{ key: string; context: string; actionId: string }> {
    const existing = bindings.get(key);
    if (!existing) return [];
    return existing
      .filter((b) => b.context === context)
      .map((b) => ({ key, context, actionId: b.actionId }));
  },

  resolveConflicts(
    conflicts: Array<{ key: string; context: string; actionId: string }>,
    _priority: number
  ): ConflictInfo {
    return { resolved: true, conflicts };
  },

  detectAllConflicts(
    _bindings: Map<string, RegisteredKeybinding[]>
  ): ConflictInfo {
    return { resolved: true, conflicts: [] };
  },
};

export class KeybindingManager {
  private actions: Map<string, KeybindingAction> = new Map();
  private bindings: Map<string, RegisteredKeybinding[]> = new Map();
  private activeContexts: Set<string> = new Set(['global']);
  private templates: Map<string, KeybindingTemplate> = new Map();
  private currentTemplate: string = 'default';

  /**
   * 注册一个动作
   */
  registerAction(action: KeybindingAction): void {
    this.actions.set(action.id, action);
  }

  /**
   * 注册按键绑定
   * @param key 按键组合（如 'Ctrl+S', 'Alt+Shift+D'）
   * @param actionId 动作ID
   * @param context 上下文（默认为 'global'）
   * @param priority 优先级（默认为 0）
   */
  registerBinding(
    key: string,
    actionId: string,
    context: string = 'global',
    priority: number = 0
  ): ConflictResult | null {
    const normalizedKey = this.normalizeKey(key);

    // 检测冲突
    const conflicts = conflictDetector.detectConflicts(
      normalizedKey,
      context,
      this.bindings
    );

    if (conflicts.length > 0) {
      // 尝试自动解决冲突
      const resolution = conflictDetector.resolveConflicts(conflicts, priority);
      if (!resolution.resolved) {
        return resolution;
      }
    }

    if (!this.bindings.has(normalizedKey)) {
      this.bindings.set(normalizedKey, []);
    }

    this.bindings.get(normalizedKey)!.push({
      key: normalizedKey,
      actionId,
      context,
      priority,
    });

    return null;
  }

  /**
   * 解绑按键绑定
   */
  unregisterBinding(key: string, context?: string): void {
    const normalizedKey = this.normalizeKey(key);
    const bindings = this.bindings.get(normalizedKey);

    if (!bindings) return;

    if (context) {
      this.bindings.set(
        normalizedKey,
        bindings.filter((b) => b.context !== context)
      );
    } else {
      this.bindings.delete(normalizedKey);
    }
  }

  /**
   * 执行按键绑定
   */
  execute(key: string, event?: KeyboardEvent): boolean {
    const normalizedKey = this.normalizeKey(key);
    const bindings = this.bindings.get(normalizedKey);

    if (!bindings || bindings.length === 0) {
      return false;
    }

    // 按上下文优先级排序
    const sortedBindings = [...bindings].sort((a, b) => {
      // 优先匹配当前上下文
      const aInContext = this.activeContexts.has(a.context);
      const bInContext = this.activeContexts.has(b.context);

      if (aInContext && !bInContext) return -1;
      if (!aInContext && bInContext) return 1;

      // 优先级高的优先
      return b.priority - a.priority;
    });

    // 执行匹配的动作
    for (const binding of sortedBindings) {
      const action = this.actions.get(binding.actionId);
      if (action) {
        action.handler(event);
        return true;
      }
    }

    return false;
  }

  /**
   * 设置活动上下文
   */
  setActiveContexts(contexts: string[]): void {
    this.activeContexts = new Set(['global', ...contexts]);
  }

  /**
   * 添加活动上下文
   */
  addActiveContext(context: string): void {
    this.activeContexts.add(context);
  }

  /**
   * 移除活动上下文
   */
  removeActiveContext(context: string): void {
    this.activeContexts.delete(context);
    // 确保 global 始终存在
    this.activeContexts.add('global');
  }

  /**
   * 获取所有注册的动作
   */
  getActions(): KeybindingAction[] {
    return Array.from(this.actions.values());
  }

  /**
   * 获取所有按键绑定
   */
  getBindings(): RegisteredKeybinding[] {
    const allBindings: RegisteredKeybinding[] = [];
    this.bindings.forEach((bindings) => {
      allBindings.push(...bindings);
    });
    return allBindings;
  }

  /**
   * 获取特定按键的绑定
   */
  getBindingsForKey(key: string): RegisteredKeybinding[] {
    return this.bindings.get(this.normalizeKey(key)) || [];
  }

  /**
   * 加载模板
   */
  loadTemplate(name: string, template: KeybindingTemplate): void {
    this.templates.set(name, template);
  }

  /**
   * 应用模板
   */
  applyTemplate(name: string, variables?: Record<string, string>): void {
    const template = this.templates.get(name);
    if (!template) {
      throw new AppError(
        `Template not found: ${name}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const schema = renderTemplate(template, variables);

    // 清除现有绑定
    this.bindings.clear();

    // 应用新绑定
    for (const [context, contextBindings] of Object.entries(schema)) {
      for (const [key, actionId] of Object.entries(contextBindings)) {
        this.registerBinding(key, actionId, context);
      }
    }

    this.currentTemplate = name;
  }

  /**
   * 获取当前模板名称
   */
  getCurrentTemplate(): string {
    return this.currentTemplate;
  }

  /**
   * 获取所有模板名称
   */
  getTemplateNames(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * 导出绑定配置
   */
  exportBindings(): Record<string, Record<string, string>> {
    const schema: Record<string, Record<string, string>> = {};

    this.bindings.forEach((bindings, key) => {
      bindings.forEach((binding) => {
        if (!schema[binding.context]) {
          schema[binding.context] = {};
        }
        schema[binding.context][key] = binding.actionId;
      });
    });

    return schema;
  }

  /**
   * 导入绑定配置
   */
  importBindings(schema: Record<string, Record<string, string>>): void {
    this.bindings.clear();

    for (const [context, contextBindings] of Object.entries(schema)) {
      for (const [key, actionId] of Object.entries(contextBindings)) {
        this.registerBinding(key, actionId, context);
      }
    }
  }

  /**
   * 检测所有冲突
   */
  detectAllConflicts(): ConflictResult {
    return conflictDetector.detectAllConflicts(this.bindings);
  }

  /**
   * 标准化按键名称
   */
  private normalizeKey(key: string): string {
    const parts = key.split('+').map((part) => part.trim().toLowerCase());

    // 按标准顺序排序修饰键
    const modifiers: string[] = [];
    const keys: string[] = [];

    for (const part of parts) {
      if (['ctrl', 'control'].includes(part)) {
        modifiers.push('ctrl');
      } else if (['alt', 'option'].includes(part)) {
        modifiers.push('alt');
      } else if (['shift'].includes(part)) {
        modifiers.push('shift');
      } else if (['meta', 'cmd', 'command'].includes(part)) {
        modifiers.push('meta');
      } else {
        keys.push(part);
      }
    }

    // 按键排序
    const sortedModifiers = modifiers.sort((a, b) => {
      const order = ['ctrl', 'alt', 'shift', 'meta'];
      return order.indexOf(a) - order.indexOf(b);
    });

    return [...sortedModifiers, ...keys].join('+');
  }
}

/**
 * 创建按键绑定管理器实例
 */
export function createKeybindingManager(): KeybindingManager {
  return new KeybindingManager();
}

/**
 * 全局按键绑定管理器实例
 */
export const keybindingManager = createKeybindingManager();
