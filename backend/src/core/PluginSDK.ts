/**
 * 插件开发SDK
 * 为第三方插件开发者提供开发工具和接口
 */

import { logger } from '../utils/log.js';
import { PluginEcosystem, PluginInfo, SkillInfo } from './PluginEcosystem.js';
import { ModuleDependencyManager, ModuleDefinition } from './ModuleDependencyManager.js';

/**
 * 插件上下文
 * 提供给插件的API接口
 */
export interface PluginContext {
  // 插件信息
  pluginId: string;
  pluginName: string;
  version: string;

  // 日志接口
  log: {
    debug: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
  };

  // 配置接口
  config: {
    get: <T>(key: string, defaultValue?: T) => T;
    set: <T>(key: string, value: T) => void;
    save: () => Promise<void>;
  };

  // 事件接口
  events: {
    on: (event: string, callback: (...args: any[]) => void) => void;
    off: (event: string, callback: (...args: any[]) => void) => void;
    emit: (event: string, ...args: any[]) => void;
  };

  // 工具接口
  utils: {
    showNotification: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    showProgress: (label: string, current: number, total: number) => void;
  };
}

/**
 * 插件接口
 */
export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;

  // 生命周期方法
  initialize?: (context: PluginContext) => Promise<void> | void;
  activate?: (context: PluginContext) => Promise<void> | void;
  deactivate?: (context: PluginContext) => Promise<void> | void;
  destroy?: (context: PluginContext) => Promise<void> | void;

  // 技能列表
  skills?: SkillDefinition[];
}

/**
 * 技能定义
 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  parameters?: SkillParameter[];
  execute: (context: SkillContext, args: Record<string, any>) => Promise<any>;
}

/**
 * 技能参数
 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  defaultValue?: any;
}

/**
 * 技能上下文
 */
export interface SkillContext {
  pluginId: string;
  skillId: string;
  log: {
    debug: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
  };
}

/**
 * 插件配置
 */
export interface PluginSDKConfig {
  ecosystem: PluginEcosystem;
  moduleManager: ModuleDependencyManager;
  configPath?: string;
}

/**
 * 插件开发SDK
 */
export class PluginSDK {
  private ecosystem: PluginEcosystem;
  private moduleManager: ModuleDependencyManager;
  private plugins: Map<string, Plugin> = new Map();
  private contexts: Map<string, PluginContext> = new Map();
  private configPath: string;

  constructor(config: PluginSDKConfig) {
    this.ecosystem = config.ecosystem;
    this.moduleManager = config.moduleManager;
    this.configPath = config.configPath || './plugin-configs';
  }

  /**
   * 注册插件
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Plugin ${plugin.id} is already registered, re-registering`);
      await this.unregisterPlugin(plugin.id);
    }

    // 创建插件上下文
    const context = this.createPluginContext(plugin);
    this.contexts.set(plugin.id, context);

    // 注册到生态系统
    const pluginInfo: PluginInfo = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      tags: plugin.tags,
      category: plugin.category,
    };

    this.ecosystem.registerPlugin(pluginInfo);

    // 注册技能
    if (plugin.skills) {
      for (const skill of plugin.skills) {
        const skillInfo: SkillInfo = {
          id: skill.id,
          name: skill.name,
          version: plugin.version,
          description: skill.description,
          author: plugin.author,
          tags: plugin.tags,
          category: plugin.category,
          pluginId: plugin.id,
        };

        this.ecosystem.registerSkill(skillInfo);
      }
    }

    // 注册为模块
    const moduleDef: ModuleDefinition = {
      name: plugin.id,
      version: plugin.version,
      description: plugin.description,
      dependencies: [],
      init: async () => {
        if (plugin.initialize) {
          await plugin.initialize(context);
        }
      },
      destroy: async () => {
        if (plugin.destroy) {
          await plugin.destroy(context);
        }
      },
    };

    this.moduleManager.registerModule(moduleDef);

    // 存储插件
    this.plugins.set(plugin.id, plugin);

    logger.info(`Registered plugin via SDK: ${plugin.name} v${plugin.version}`);
  }

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    const context = this.contexts.get(pluginId);

    if (!plugin || !context) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    if (plugin.activate) {
      await plugin.activate(context);
    }

    this.ecosystem.enablePlugin(pluginId);

    logger.info(`Activated plugin: ${pluginId}`);
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    const context = this.contexts.get(pluginId);

    if (!plugin || !context) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    if (plugin.deactivate) {
      await plugin.deactivate(context);
    }

    this.ecosystem.disablePlugin(pluginId);

    logger.info(`Deactivated plugin: ${pluginId}`);
  }

  /**
   * 执行技能
   */
  async executeSkill(
    pluginId: string,
    skillId: string,
    args: Record<string, any>
  ): Promise<any> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const skill = plugin.skills?.find(s => s.id === skillId);

    if (!skill) {
      throw new Error(`Skill ${skillId} not found in plugin ${pluginId}`);
    }

    const skillContext: SkillContext = {
      pluginId,
      skillId,
      log: {
        debug: (message: string, ...args: any[]) =>
          logger.debug(`[${pluginId}:${skillId}] ${message}`, ...args),
        info: (message: string, ...args: any[]) =>
          logger.info(`[${pluginId}:${skillId}] ${message}`, ...args),
        warn: (message: string, ...args: any[]) =>
          logger.warn(`[${pluginId}:${skillId}] ${message}`, ...args),
        error: (message: string, ...args: any[]) =>
          logger.error(`[${pluginId}:${skillId}] ${message}`, ...args),
      },
    };

    return skill.execute(skillContext, args);
  }

  /**
   * 注销插件
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    if (plugin.deactivate) {
      const context = this.contexts.get(pluginId);
      if (context) {
        await plugin.deactivate(context);
      }
    }

    this.ecosystem.unregisterPlugin(pluginId);
    this.moduleManager.unregisterModule(pluginId);
    this.contexts.delete(pluginId);
    this.plugins.delete(pluginId);

    logger.info(`Unregistered plugin: ${pluginId}`);
  }

  /**
   * 获取插件列表
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 创建插件上下文
   */
  private createPluginContext(plugin: Plugin): PluginContext {
    const pluginConfig = this.loadPluginConfig(plugin.id);

    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      version: plugin.version,

      log: {
        debug: (message: string, ...args: any[]) =>
          logger.debug(`[${plugin.id}] ${message}`, ...args),
        info: (message: string, ...args: any[]) =>
          logger.info(`[${plugin.id}] ${message}`, ...args),
        warn: (message: string, ...args: any[]) =>
          logger.warn(`[${plugin.id}] ${message}`, ...args),
        error: (message: string, ...args: any[]) =>
          logger.error(`[${plugin.id}] ${message}`, ...args),
      },

      config: {
        get: <T>(key: string, defaultValue?: T): T => {
          return pluginConfig[key] !== undefined ? pluginConfig[key] : defaultValue;
        },
        set: <T>(key: string, value: T): void => {
          pluginConfig[key] = value;
        },
        save: async (): Promise<void> => {
          await this.savePluginConfig(plugin.id, pluginConfig);
        },
      },

      events: {
        on: (event: string, callback: (...args: any[]) => void): void => {
          // 实现事件监听
          logger.debug(`[${plugin.id}] Registered event listener for: ${event}`);
        },
        off: (event: string, callback: (...args: any[]) => void): void => {
          // 实现事件取消监听
          logger.debug(`[${plugin.id}] Removed event listener for: ${event}`);
        },
        emit: (event: string, ...args: any[]): void => {
          // 实现事件触发
          logger.debug(`[${plugin.id}] Emitted event: ${event}`);
        },
      },

      utils: {
        showNotification: (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
          logger.info(`[${plugin.id}] Notification (${type}): ${message}`);
        },
        showProgress: (label: string, current: number, total: number): void => {
          logger.info(`[${plugin.id}] Progress: ${label} ${current}/${total}`);
        },
      },
    };
  }

  /**
   * 加载插件配置
   */
  private loadPluginConfig(pluginId: string): Record<string, any> {
    try {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(this.configPath, `${pluginId}.json`);

      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.debug(`Failed to load config for plugin ${pluginId}:`, error);
    }

    return {};
  }

  /**
   * 保存插件配置
   */
  private async savePluginConfig(
    pluginId: string,
    config: Record<string, any>
  ): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');

      if (!fs.existsSync(this.configPath)) {
        fs.mkdirSync(this.configPath, { recursive: true });
      }

      const configPath = path.join(this.configPath, `${pluginId}.json`);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      logger.error(`Failed to save config for plugin ${pluginId}:`, error);
    }
  }

  /**
   * 创建示例插件
   */
  static createExamplePlugin(): Plugin {
    return {
      id: 'example-plugin',
      name: '示例插件',
      version: '1.0.0',
      description: '这是一个示例插件，展示了如何使用PluginSDK',
      author: 'PY_APP',
      tags: ['example', 'demo'],
      category: '示例',

      initialize: async (context: PluginContext) => {
        context.log.info('示例插件已初始化');
      },

      activate: async (context: PluginContext) => {
        context.log.info('示例插件已激活');
        context.utils.showNotification('示例插件已激活', 'success');
      },

      deactivate: async (context: PluginContext) => {
        context.log.info('示例插件已停用');
      },

      skills: [
        {
          id: 'example-skill',
          name: '示例技能',
          description: '这是一个示例技能',
          parameters: [
            {
              name: 'message',
              type: 'string',
              description: '要显示的消息',
              required: true,
            },
          ],
          execute: async (context: SkillContext, args: Record<string, any>) => {
            context.log.info(`执行示例技能: ${args.message}`);
            return { success: true, message: args.message };
          },
        },
      ],
    };
  }

  /**
   * 验证插件定义
   */
  static validatePlugin(plugin: Plugin): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plugin.id) {
      errors.push('插件ID不能为空');
    }

    if (!plugin.name) {
      errors.push('插件名称不能为空');
    }

    if (!plugin.version) {
      errors.push('插件版本不能为空');
    }

    if (!plugin.description) {
      errors.push('插件描述不能为空');
    }

    if (!plugin.author) {
      errors.push('插件作者不能为空');
    }

    if (!plugin.category) {
      errors.push('插件类别不能为空');
    }

    // 验证技能定义
    if (plugin.skills) {
      for (const skill of plugin.skills) {
        if (!skill.id) {
          errors.push(`技能ID不能为空`);
        }

        if (!skill.name) {
          errors.push(`技能名称不能为空`);
        }

        if (!skill.execute) {
          errors.push(`技能 ${skill.id || 'unknown'} 必须包含execute方法`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * 创建插件SDK
 */
export function createPluginSDK(config: PluginSDKConfig): PluginSDK {
  return new PluginSDK(config);
}
