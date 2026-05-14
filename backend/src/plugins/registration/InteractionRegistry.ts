/**
 * InteractionRegistry 插件交互注册系统
 * 对标 OpenClaw 的 interactive-registry，管理插件的交互式对话绑定
 */

/**
 * 交互类型
 */
export type InteractionType =
  | 'prompt'
  | 'confirm'
  | 'select'
  | 'input'
  | 'file'
  | 'suggestion';

/**
 * 交互处理器
 */
export interface InteractionHandler {
  type: InteractionType;
  pluginName: string;
  trigger: string | RegExp;
  description: string;
  priority: number;
  handle(
    input: string,
    context: Record<string, unknown>
  ): Promise<InteractionResponse>;
}

/**
 * 交互响应
 */
export interface InteractionResponse {
  handled: boolean;
  response?: string;
  data?: unknown;
  suggestions?: string[];
}

/**
 * 交互注册条目
 */
export interface InteractionEntry {
  handler: InteractionHandler;
  registeredAt: number;
  enabled: boolean;
  useCount: number;
}

/**
 * 交互注册表
 */
export class InteractionRegistry {
  private handlers: InteractionEntry[] = [];

  /**
   * 注册交互处理器
   */
  register(handler: InteractionHandler): boolean {
    const exists = this.handlers.some(
      (h) =>
        h.handler.pluginName === handler.pluginName &&
        h.handler.trigger === handler.trigger
    );

    if (exists) {
      return false;
    }

    this.handlers.push({
      handler,
      registeredAt: Date.now(),
      enabled: true,
      useCount: 0,
    });

    this.handlers.sort((a, b) => b.handler.priority - a.handler.priority);

    return true;
  }

  /**
   * 注销交互处理器
   */
  unregister(pluginName: string, trigger: string | RegExp): boolean {
    const index = this.handlers.findIndex(
      (h) =>
        h.handler.pluginName === pluginName && h.handler.trigger === trigger
    );

    if (index === -1) {
      return false;
    }

    this.handlers.splice(index, 1);
    return true;
  }

  /**
   * 按插件名注销所有处理器
   */
  unregisterByPlugin(pluginName: string): number {
    const before = this.handlers.length;
    this.handlers = this.handlers.filter(
      (h) => h.handler.pluginName !== pluginName
    );
    return before - this.handlers.length;
  }

  /**
   * 查找匹配的交互处理器
   */
  find(input: string, type?: InteractionType): InteractionHandler[] {
    const matches: InteractionHandler[] = [];

    for (const entry of this.handlers) {
      if (!entry.enabled) {
        continue;
      }

      if (type && entry.handler.type !== type) {
        continue;
      }

      if (typeof entry.handler.trigger === 'string') {
        if (input.includes(entry.handler.trigger)) {
          matches.push(entry.handler);
        }
      } else if (entry.handler.trigger instanceof RegExp) {
        if (entry.handler.trigger.test(input)) {
          matches.push(entry.handler);
        }
      }
    }

    return matches;
  }

  /**
   * 执行交互处理
   */
  async process(
    input: string,
    context: Record<string, unknown> = {}
  ): Promise<InteractionResponse> {
    const candidates = this.find(input);

    for (const handler of candidates) {
      const result = await handler.handle(input, context);

      if (result.handled) {
        const entry = this.handlers.find(
          (h) =>
            h.handler.pluginName === handler.pluginName &&
            h.handler.trigger === handler.trigger
        );

        if (entry) {
          entry.useCount++;
        }

        return result;
      }
    }

    return { handled: false };
  }

  /**
   * 获取所有处理器
   */
  getAll(): InteractionEntry[] {
    return [...this.handlers];
  }

  /**
   * 按插件名获取处理器
   */
  getByPlugin(pluginName: string): InteractionEntry[] {
    return this.handlers.filter((h) => h.handler.pluginName === pluginName);
  }

  /**
   * 启用/禁用处理器
   */
  setEnabled(
    pluginName: string,
    trigger: string | RegExp,
    enabled: boolean
  ): boolean {
    const index = this.handlers.findIndex(
      (h) =>
        h.handler.pluginName === pluginName && h.handler.trigger === trigger
    );

    if (index === -1) {
      return false;
    }

    this.handlers[index].enabled = enabled;
    return true;
  }

  /**
   * 获取交互统计
   */
  getStats(): {
    total: number;
    enabled: number;
    byPlugin: Record<string, number>;
  } {
    let enabled = 0;
    const byPlugin: Record<string, number> = {};

    for (const entry of this.handlers) {
      if (entry.enabled) {
        enabled++;
      }
      byPlugin[entry.handler.pluginName] =
        (byPlugin[entry.handler.pluginName] || 0) + 1;
    }

    return {
      total: this.handlers.length,
      enabled,
      byPlugin,
    };
  }
}

export const interactionRegistry = new InteractionRegistry();
