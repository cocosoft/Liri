// @ts-nocheck
/**
 * 插件依赖管理器
 * 负责管理插件间的依赖关系，包括依赖解析、版本冲突检测等
 */

import { logger } from '../utils/log';
import type { LoadedPlugin, PluginManifest } from '../types/plugin';
import type { PluginSource } from './PluginLoader';
import { pluginLoader } from './PluginLoader';
import { satisfies, gte, lt } from './utils/semver';
import {
  qualifyDependency,
  resolveDependencyClosure,
  verifyAndDemote,
  topologicalSort,
  detectCycle,
} from './utils/dependencyResolver';

/**
 * 依赖项配置
 */
export interface Dependency {
  name: string;
  version?: string;
  source?: string;
  optional?: boolean;
}

/**
 * 依赖解析结果
 */
export interface DependencyResolutionResult {
  dependencies: LoadedPlugin[];
  errors: string[];
  warnings: string[];
}

/**
 * 插件依赖管理器
 */
export class PluginDependencyManager {
  private resolvedDependencies: Map<string, LoadedPlugin> = new Map();
  private dependencyGraph: Map<string, string[]> = new Map();

  /**
   * 解析插件的依赖
   * @param plugin 要解析依赖的插件
   * @returns 依赖解析结果
   */
  async resolveDependencies(
    plugin: LoadedPlugin
  ): Promise<DependencyResolutionResult> {
    const result: DependencyResolutionResult = {
      dependencies: [],
      errors: [],
      warnings: [],
    };

    try {
      await this.resolveDependencyTree(plugin, result);
    } catch (error) {
      result.errors.push(`Failed to resolve dependencies: ${error}`);
    }

    return result;
  }

  /**
   * 递归解析依赖树
   */
  private async resolveDependencyTree(
    plugin: LoadedPlugin,
    result: DependencyResolutionResult,
    visited: Set<string> = new Set()
  ): Promise<void> {
    const pluginKey = this.getPluginKey(plugin);

    // 检查循环依赖
    if (visited.has(pluginKey)) {
      result.errors.push(
        `Circular dependency detected: ${Array.from(visited).join(' -> ')} -> ${pluginKey}`
      );
      return;
    }

    visited.add(pluginKey);

    // 解析插件的依赖
    if (plugin.manifest.dependencies) {
      for (const [depName, depConfig] of Object.entries(
        plugin.manifest.dependencies
      )) {
        const dependency = this.normalizeDependency(depName, depConfig);
        await this.resolveSingleDependency(dependency, result, visited);
      }
    }

    visited.delete(pluginKey);
  }

  /**
   * 解析单个依赖
   */
  private async resolveSingleDependency(
    dependency: Dependency,
    result: DependencyResolutionResult,
    visited: Set<string>
  ): Promise<void> {
    const depKey = dependency.name;

    // 检查是否已经解析过
    if (this.resolvedDependencies.has(depKey)) {
      const existingDep = this.resolvedDependencies.get(depKey);
      // 检查版本兼容性
      if (dependency.version && existingDep) {
        if (
          !this.isVersionCompatible(
            existingDep.manifest.version || '1.0.0',
            dependency.version
          )
        ) {
          result.warnings.push(
            `Version conflict for ${depKey}: existing ${existingDep.manifest.version}, requested ${dependency.version}`
          );
        }
      }
      return;
    }

    try {
      // 构建依赖的源配置
      const source: PluginSource = {
        type: 'npm', // 默认使用npm
        url: dependency.name,
        version: dependency.version,
      };

      if (dependency.source) {
        // 解析自定义源
        if (
          dependency.source.startsWith('git@') ||
          dependency.source.endsWith('.git')
        ) {
          source.type = 'git';
          source.url = dependency.source;
        } else if (dependency.source.includes('github.com')) {
          source.type = 'github';
          source.url = dependency.source;
        } else if (dependency.source.startsWith('http')) {
          source.type = 'url';
          source.url = dependency.source;
        }
      }

      // 加载依赖插件
      const depPlugin = await pluginLoader.load(source);

      // 递归解析依赖的依赖
      await this.resolveDependencyTree(depPlugin, result, visited);

      // 添加到已解析依赖
      this.resolvedDependencies.set(depKey, depPlugin);
      result.dependencies.push(depPlugin);

      // 更新依赖图
      if (!this.dependencyGraph.has(depKey)) {
        this.dependencyGraph.set(depKey, []);
      }
    } catch (error) {
      if (dependency.optional) {
        result.warnings.push(
          `Optional dependency ${dependency.name} not found: ${error}`
        );
      } else {
        result.errors.push(
          `Required dependency ${dependency.name} not found: ${error}`
        );
      }
    }
  }

  /**
   * 标准化依赖配置
   */
  private normalizeDependency(
    name: string,
    config: string | Dependency
  ): Dependency {
    if (typeof config === 'string') {
      return {
        name,
        version: config,
      };
    }
    return {
      name,
      ...config,
    };
  }

  /**
   * 检查版本兼容性
   */
  private isVersionCompatible(
    actualVersion: string,
    requiredVersion: string
  ): boolean {
    if (requiredVersion === '*') {
      return true;
    }

    if (
      requiredVersion.startsWith('^') ||
      requiredVersion.startsWith('~') ||
      requiredVersion.includes('||') ||
      requiredVersion.includes(' - ') ||
      requiredVersion.includes('>=') ||
      requiredVersion.includes('<=')
    ) {
      return satisfies(actualVersion, requiredVersion);
    }

    return (
      actualVersion === requiredVersion || gte(actualVersion, requiredVersion)
    );
  }

  /**
   * 获取插件的唯一键
   */
  private getPluginKey(plugin: LoadedPlugin): string {
    return plugin.name || plugin.source;
  }

  /**
   * 获取已解析的依赖
   */
  getResolvedDependencies(): Map<string, LoadedPlugin> {
    return this.resolvedDependencies;
  }

  /**
   * 获取依赖图
   */
  getDependencyGraph(): Map<string, string[]> {
    return this.dependencyGraph;
  }

  /**
   * 清理依赖缓存
   */
  clear(): void {
    this.resolvedDependencies.clear();
    this.dependencyGraph.clear();
  }

  /**
   * 检查依赖冲突
   */
  checkDependencyConflicts(): string[] {
    const conflicts: string[] = [];

    for (const [depName, depPlugin] of this.resolvedDependencies) {
      for (const [otherName, otherPlugin] of this.resolvedDependencies) {
        if (depName === otherName) continue;

        if (depPlugin.manifest.dependencies?.includes(otherName)) {
          const cycle = detectCycle([depPlugin, otherPlugin]);
          if (cycle) {
            conflicts.push(
              `Circular dependency detected: ${cycle.join(' -> ')}`
            );
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * 使用拓扑排序对插件进行排序
   */
  sortPlugins(plugins: LoadedPlugin[]): LoadedPlugin[] {
    return topologicalSort(plugins);
  }

  /**
   * 检测插件列表中的循环依赖
   */
  detectDependencyCycle(plugins: LoadedPlugin[]): string[] | null {
    return detectCycle(plugins);
  }

  /**
   * 验证并降级有问题的插件
   */
  validateAndDemote(plugins: readonly LoadedPlugin[]): {
    demoted: Set<string>;
    errors: Array<{
      type: string;
      source: string;
      plugin: string;
      dependency: string;
      reason: string;
    }>;
  } {
    return verifyAndDemote(plugins);
  }

  /**
   * 生成依赖报告
   */
  generateDependencyReport(plugin: LoadedPlugin): string {
    const report: string[] = [];
    report.push(`Dependency report for ${plugin.name}:`);

    if (plugin.manifest.dependencies) {
      for (const [name, config] of Object.entries(
        plugin.manifest.dependencies
      )) {
        const dep = this.normalizeDependency(name, config);
        const resolved = this.resolvedDependencies.get(name);
        if (resolved) {
          report.push(
            `- ${name}@${dep.version || 'latest'} (resolved: ${resolved.manifest.version || 'unknown'})`
          );
        } else {
          report.push(`- ${name}@${dep.version || 'latest'} (not resolved)`);
        }
      }
    } else {
      report.push('No dependencies');
    }

    return report.join('\n');
  }
}

// 导出单例
export const pluginDependencyManager = new PluginDependencyManager();
