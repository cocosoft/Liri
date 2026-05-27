/**
 * PluginValidator - 插件验证器
 * 负责验证插件的完整性和安全性
 */

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { PluginManifest, LoadedPlugin, PluginError } from '../types';
import { PluginManifestSchema, PluginHooksSchema } from '../utils/schemas';

/**
 * 插件验证器类
 */
export class PluginValidator {
  private static instance: PluginValidator;

  private constructor() {}

  /**
   * 获取单例实例
   * @returns PluginValidator实例
   */
  public static getInstance(): PluginValidator {
    if (!PluginValidator.instance) {
      PluginValidator.instance = new PluginValidator();
    }
    return PluginValidator.instance;
  }

  /**
   * 验证插件清单
   * @param manifestPath 清单路径
   * @returns 验证结果
   */
  public validateManifest(manifestPath: string): {
    valid: boolean;
    error?: string;
  } {
    if (!existsSync(manifestPath)) {
      return { valid: false, error: 'Manifest file not found' };
    }

    try {
      const content = readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(content);
      const result = PluginManifestSchema.safeParse(parsed);

      if (result.success) {
        return { valid: true };
      } else {
        const errors = result.error.issues
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        return { valid: false, error: `Invalid manifest: ${errors}` };
      }
    } catch (error) {
      return {
        valid: false,
        error: `Failed to parse manifest: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * 验证插件钩子配置
   * @param hooksPath 钩子配置路径
   * @returns 验证结果
   */
  public validateHooksConfig(hooksPath: string): {
    valid: boolean;
    error?: string;
  } {
    if (!existsSync(hooksPath)) {
      return { valid: false, error: 'Hooks config file not found' };
    }

    try {
      const content = readFileSync(hooksPath, 'utf-8');
      const parsed = JSON.parse(content);
      const result = PluginHooksSchema.safeParse(parsed);

      if (result.success) {
        return { valid: true };
      } else {
        const errors = result.error.issues
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        return { valid: false, error: `Invalid hooks config: ${errors}` };
      }
    } catch (error) {
      return {
        valid: false,
        error: `Failed to parse hooks config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * 验证插件安全性
   * @param plugin 插件
   * @returns 验证结果
   */
  public validateSecurity(plugin: LoadedPlugin): {
    valid: boolean;
    error?: string;
  } {
    // 检查插件路径是否安全
    if (plugin.path.includes('..')) {
      return { valid: false, error: 'Invalid plugin path' };
    }

    // 检查插件是否有危险的命令
    if (plugin.manifest.commands) {
      for (const commandPath of plugin.manifest.commands) {
        if (commandPath.includes('..')) {
          return { valid: false, error: 'Invalid command path' };
        }
      }
    }

    // 检查插件是否有危险的代理
    if (plugin.manifest.agents) {
      for (const agentPath of plugin.manifest.agents) {
        if (agentPath.includes('..')) {
          return { valid: false, error: 'Invalid agent path' };
        }
      }
    }

    // 检查插件是否有危险的技能
    if (plugin.manifest.skills) {
      for (const skillPath of plugin.manifest.skills) {
        if (skillPath.includes('..')) {
          return { valid: false, error: 'Invalid skill path' };
        }
      }
    }

    return { valid: true };
  }

  /**
   * 验证插件完整性
   * @param plugin 插件
   * @returns 验证结果
   */
  public validateIntegrity(plugin: LoadedPlugin): {
    valid: boolean;
    error?: string;
  } {
    // 检查插件目录是否存在
    if (!existsSync(plugin.path)) {
      return { valid: false, error: 'Plugin directory not found' };
    }

    // 检查插件清单是否存在
    const manifestPath = join(plugin.path, '.claude-plugin', 'plugin.json');
    const legacyManifestPath = join(plugin.path, 'plugin.json');
    if (!existsSync(manifestPath) && !existsSync(legacyManifestPath)) {
      return { valid: false, error: 'Plugin manifest not found' };
    }

    // 验证命令文件
    if (plugin.manifest.commands) {
      for (const commandPath of plugin.manifest.commands) {
        const fullPath = join(plugin.path, commandPath);
        if (!existsSync(fullPath)) {
          return {
            valid: false,
            error: `Command file not found: ${commandPath}`,
          };
        }
      }
    }

    // 验证代理文件
    if (plugin.manifest.agents) {
      for (const agentPath of plugin.manifest.agents) {
        const fullPath = join(plugin.path, agentPath);
        if (!existsSync(fullPath)) {
          return { valid: false, error: `Agent file not found: ${agentPath}` };
        }
      }
    }

    // 验证技能文件
    if (plugin.manifest.skills) {
      for (const skillPath of plugin.manifest.skills) {
        const fullPath = join(plugin.path, skillPath);
        if (!existsSync(fullPath)) {
          return { valid: false, error: `Skill file not found: ${skillPath}` };
        }
      }
    }

    // 验证钩子配置文件
    if (plugin.manifest.hooks) {
      const hooksPath = join(plugin.path, plugin.manifest.hooks);
      if (!existsSync(hooksPath)) {
        return {
          valid: false,
          error: `Hooks config file not found: ${plugin.manifest.hooks}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * 验证插件依赖
   * @param plugin 插件
   * @param installedPlugins 已安装的插件
   * @returns 验证结果
   */
  public validateDependencies(
    plugin: LoadedPlugin,
    installedPlugins: LoadedPlugin[]
  ): { valid: boolean; error?: string } {
    // 这里应该实现依赖验证逻辑
    // 简化实现，实际项目中可能需要从插件清单中提取依赖并验证
    return { valid: true };
  }

  /**
   * 全面验证插件
   * @param plugin 插件
   * @param installedPlugins 已安装的插件
   * @returns 验证结果
   */
  public validatePlugin(
    plugin: LoadedPlugin,
    installedPlugins: LoadedPlugin[] = []
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证完整性
    const integrityResult = this.validateIntegrity(plugin);
    if (!integrityResult.valid && integrityResult.error) {
      errors.push(integrityResult.error);
    }

    // 验证安全性
    const securityResult = this.validateSecurity(plugin);
    if (!securityResult.valid && securityResult.error) {
      errors.push(securityResult.error);
    }

    // 验证依赖
    const dependencyResult = this.validateDependencies(
      plugin,
      installedPlugins
    );
    if (!dependencyResult.valid && dependencyResult.error) {
      errors.push(dependencyResult.error);
    }

    // 验证钩子配置
    if (plugin.manifest.hooks) {
      const hooksPath = join(plugin.path, plugin.manifest.hooks);
      const hooksResult = this.validateHooksConfig(hooksPath);
      if (!hooksResult.valid && hooksResult.error) {
        errors.push(hooksResult.error);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 创建插件错误
   * @param type 错误类型
   * @param plugin 插件名称
   * @param error 错误信息
   * @returns 插件错误
   */
  public createPluginError(
    type: 'generic-error',
    plugin: string,
    error: string
  ): PluginError {
    return {
      type,
      source: 'plugin-validator',
      plugin,
      error,
    };
  }
}
