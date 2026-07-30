/**
 * 插件开发SDK
 *
 * @deprecated 由 pluginSystem 统一替代。保留用于 --use-legacy-module-system 回退路径。
 * 为第三方插件开发者提供开发工具和接口
 *
 * 注意：内部已不再依赖 PluginEcosystem，直接使用 PluginSystem。
 * PluginEcosystem 将在后续版本中移除。
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { Logger } from '@modules/monitoring';
import { pluginSystem } from '@modules/plugins/index.js';
import type { PluginState } from '@modules/plugins/types/PluginTypes';
import type { SkillInfo } from '@modules/plugins/types/index.js';
import {
  ModuleDependencyManager,
  ModuleDefinition,
} from './ModuleDependencyManager.js';

import type {
  PluginContext,
  Plugin,
  SkillDefinition,
  SkillParameter,
  SkillContext,
} from '@modules/plugin-sdk';

const logger = new Logger({ module: 'PluginSDK' });

export type {
  PluginContext,
  Plugin,
  SkillDefinition,
  SkillParameter,
  SkillContext,
};

/**
 * 插件SDK配置
 */
export interface PluginSDKConfig {
  /**
   * 模块依赖管理器（可选）
   * 旧版模块系统提供 ModuleDependencyManager 实例；
   * 统一后的模块系统使用 ModuleRegistry，此字段可为 undefined
   */
  moduleManager?: ModuleDependencyManager;
  configPath?: string;
  /**
   * 是否使用旧版插件系统回退模式
   * 启用后保持本地 Map 管理，不委托给 PluginSystem。
   * 默认从环境变量 LIRI_USE_LEGACY_PLUGIN_SYSTEM 读取。
   */
  useLegacyPluginSystem?: boolean;
}

/**
 * 插件开发SDK
 */
export class PluginSDK {
  private moduleManager?: ModuleDependencyManager;
  private plugins: Map<string, Plugin> = new Map();
  private contexts: Map<string, PluginContext> = new Map();
  private skills: Map<string, SkillInfo> = new Map();
  private configPath: string;
  private useLegacy: boolean;

  constructor(config: PluginSDKConfig) {
    this.moduleManager = config.moduleManager;
    this.configPath = config.configPath || './plugin-configs';
    this.useLegacy = config.useLegacyPluginSystem ?? true;
  }

  /**
   * 注册插件
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    // 非回退路径：直接委托给 PluginSystem
    if (!this.useLegacy) {
      await pluginSystem.registerPluginFromSDK(plugin);
      logger.info(
        `Registered plugin via SDK (delegated): ${plugin.name} v${plugin.version}`
      );
      return;
    }

    if (this.plugins.has(plugin.id)) {
      logger.warn(`Plugin ${plugin.id} is already registered, re-registering`);
      await this.unregisterPlugin(plugin.id);
    }

    // 创建插件上下文
    const context = this.createPluginContext(plugin);
    this.contexts.set(plugin.id, context);

    // 注册到 PluginSystem 的注册表
    try {
      pluginSystem.getRegistry().registerPlugin({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        path: '',
        state: 'LOADED' as PluginState,
        enabled: true,
        dependencies: [],
        dependents: [],
        registeredAt: new Date(),
      });
    } catch (error) {
      // 如果插件已存在，记录警告但继续
      logger.warn(
        `Plugin ${plugin.id} may already be registered in PluginSystem`,
        {
          error: String(error),
        }
      );
    }

    // 存储技能信息（旧版路径，本地管理）
    if (plugin.skills) {
      for (const skill of plugin.skills) {
        this.skills.set(skill.id, {
          id: skill.id,
          name: skill.name,
          version: plugin.version,
          description: skill.description,
          author: plugin.author,
          tags: plugin.tags,
          category: plugin.category,
          pluginId: plugin.id,
        });
      }
    }

    // 注册为模块（旧版路径）
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

    // 非旧版模式下 ModuleDependencyManager 不存在，注册由 ModuleRegistry 统一处理
    if (this.moduleManager) {
      this.moduleManager.registerModule(moduleDef);
    }

    // 存储插件
    this.plugins.set(plugin.id, plugin);

    logger.info(`Registered plugin via SDK: ${plugin.name} v${plugin.version}`);
  }

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<void> {
    // 非回退路径：直连 PluginSystem 注册表
    if (!this.useLegacy) {
      pluginSystem.getRegistry().enablePlugin(pluginId);
      logger.info(`Activated plugin (delegated): ${pluginId}`);
      return;
    }

    const plugin = this.plugins.get(pluginId);
    const context = this.contexts.get(pluginId);

    if (!plugin || !context) {
      throw new AppError(
        `Plugin ${pluginId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (plugin.activate) {
      await plugin.activate(context);
    }

    // 通过 PluginSystem 注册表启用
    pluginSystem.getRegistry().enablePlugin(pluginId);

    logger.info(`Activated plugin: ${pluginId}`);
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    // 非回退路径：直连 PluginSystem 注册表
    if (!this.useLegacy) {
      pluginSystem.getRegistry().disablePlugin(pluginId);
      logger.info(`Deactivated plugin (delegated): ${pluginId}`);
      return;
    }

    const plugin = this.plugins.get(pluginId);
    const context = this.contexts.get(pluginId);

    if (!plugin || !context) {
      throw new AppError(
        `Plugin ${pluginId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (plugin.deactivate) {
      await plugin.deactivate(context);
    }

    // 通过 PluginSystem 注册表禁用
    pluginSystem.getRegistry().disablePlugin(pluginId);

    logger.info(`Deactivated plugin: ${pluginId}`);
  }

  /**
   * 执行技能
   */
  async executeSkill(
    pluginId: string,
    skillId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // 非回退路径：委托给 PluginSystem
    if (!this.useLegacy) {
      return pluginSystem.executeSkill(pluginId, skillId, args);
    }

    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      throw new AppError(
        `Plugin ${pluginId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    const skill = plugin.skills?.find((s) => s.id === skillId);

    if (!skill) {
      throw new AppError(
        `Skill ${skillId} not found in plugin ${pluginId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    const skillContext: SkillContext = {
      pluginId,
      skillId,
      log: {
        debug: (message: string, ...args: unknown[]) =>
          logger.debug(
            `[${pluginId}:${skillId}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        info: (message: string, ...args: unknown[]) =>
          logger.info(
            `[${pluginId}:${skillId}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        warn: (message: string, ...args: unknown[]) =>
          logger.warn(
            `[${pluginId}:${skillId}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        error: (message: string, ...args: unknown[]) => {
          const fullMsg = `[${pluginId}:${skillId}] ${message}${args[0] ? ' ' + String(args[0]) : ''}`;
          logger.error(fullMsg, args[1] as Record<string, unknown> | undefined);
        },
      },
    };

    return skill.execute(skillContext, args);
  }

  /**
   * 注销插件
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    // 非回退路径：委托给 PluginSystem
    if (!this.useLegacy) {
      await pluginSystem.unregisterPluginFromSDK(pluginId);
      logger.info(`Unregistered plugin (delegated): ${pluginId}`);
      return;
    }

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

    // 从 PluginSystem 注册表中移除
    try {
      pluginSystem.getRegistry().unregisterPlugin(pluginId);
    } catch (err) {
      // 如果注册表中不存在，忽略
    }

    // 清理本地存储的技能
    for (const [id, skill] of this.skills) {
      if (skill.pluginId === pluginId) this.skills.delete(id);
    }

    if (this.moduleManager) {
      this.moduleManager.unregisterModule(pluginId);
    }
    this.contexts.delete(pluginId);
    this.plugins.delete(pluginId);

    logger.info(`Unregistered plugin: ${pluginId}`);
  }

  /**
   * 获取插件列表
   * @deprecated 非回退模式下使用 PluginSystem 管理插件
   */
  getPlugins(): Plugin[] {
    if (!this.useLegacy) {
      logger.warn('getPlugins() 在非回退模式下返回空列表，请使用 PluginSystem');
      return [];
    }
    return Array.from(this.plugins.values());
  }

  /**
   * 获取插件
   * @deprecated 非回退模式下请使用 PluginSystem
   */
  getPlugin(pluginId: string): Plugin | undefined {
    if (!this.useLegacy) {
      logger.warn(
        `getPlugin() 在非回退模式下返回 undefined，请使用 PluginSystem`
      );
      return undefined;
    }
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有 SDK 注册的技能
   * 非回退模式下委托给 PluginSystem
   */
  getAllSkills(): SkillInfo[] {
    if (!this.useLegacy) {
      return pluginSystem.getAllSkills();
    }
    return Array.from(this.skills.values());
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
        debug: (message: string, ...args: unknown[]) =>
          logger.debug(
            `[${plugin.id}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        info: (message: string, ...args: unknown[]) =>
          logger.info(
            `[${plugin.id}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        warn: (message: string, ...args: unknown[]) =>
          logger.warn(
            `[${plugin.id}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        error: (message: string, ...args: unknown[]) => {
          const fullMsg = `[${plugin.id}] ${message}${args[0] ? ' ' + String(args[0]) : ''}`;
          logger.error(fullMsg, args[1] as Record<string, unknown> | undefined);
        },
      },

      config: {
        get: <T>(key: string, defaultValue?: T): T => {
          return (
            pluginConfig[key] !== undefined ? pluginConfig[key] : defaultValue
          ) as T;
        },
        set: <T>(key: string, value: T): void => {
          pluginConfig[key] = value;
        },
        save: async (): Promise<void> => {
          await this.savePluginConfig(plugin.id, pluginConfig);
        },
      },

      events: {
        on: (event: string, callback: (...args: unknown[]) => void): void => {
          logger.debug(
            `[${plugin.id}] Registered event listener for: ${event}`
          );
        },
        off: (event: string, callback: (...args: unknown[]) => void): void => {
          logger.debug(`[${plugin.id}] Removed event listener for: ${event}`);
        },
        emit: (event: string, ...args: unknown[]): void => {
          logger.debug(`[${plugin.id}] Emitted event: ${event}`);
        },
      },

      utils: {
        showNotification: (
          message: string,
          type: 'info' | 'success' | 'warning' | 'error' = 'info'
        ): void => {
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
  private loadPluginConfig(pluginId: string): Record<string, unknown> {
    try {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(this.configPath, `${pluginId}.json`);

      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.debug(`Failed to load config for plugin ${pluginId}:`, {
        error: String(error),
      });
    }

    return {};
  }

  /**
   * 保存插件配置
   */
  private async savePluginConfig(
    pluginId: string,
    config: Record<string, unknown>
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
      await handleError(error, {
        module: 'core:plugin',
        action: 'save_config',
      });
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
      author: 'Liri',
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
          execute: async (
            context: SkillContext,
            args: Record<string, unknown>
          ) => {
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
