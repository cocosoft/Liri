/**
 * 负责插件的依赖解析、版本管理、冲突检测等
 */

import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';
import {
  PluginDependency,
  PluginDependencyResolution,
  PluginMetadata,
} from '../types/PluginTypes';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { satisfies } from '../utils/semver';
import { checkServiceCircularDependencies as checkServiceCircularDependenciesCore } from '../utils/dependencyResolver';

const logger = getLogger('plugins:management:pluginDependencyManager');

/**
 * 依赖解析结果
 */
export interface DependencyResolution {
  /** 是否成功 */
  success: boolean;

  /** 解析的依赖链 */
  dependencyChain: string[];

  /** 缺失的依赖 */
  missingDependencies: string[];

  /** 版本冲突 */
  versionConflicts: VersionConflict[];

  /** 循环依赖 */
  circularDependencies: string[][];

  /** 错误信息 */
  error?: string;
}

/**
 * 版本冲突
 */
export interface VersionConflict {
  /** 插件名称 */
  pluginName: string;

  /** 要求的版本 */
  requiredVersion: string;

  /** 实际版本 */
  actualVersion: string;

  /** 依赖来源 */
  dependent: string;
}

/**
 * 依赖图节点
 */
export interface DependencyNode {
  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version: string;

  /** 依赖列表 */
  dependencies: PluginDependency[];

  /** 被依赖列表 */
  dependents: string[];

  /** 是否已解析 */
  resolved: boolean;
}

/**
 * 插件依赖管理器
 */
export class PluginDependencyManager extends EventEmitter {
  private dependencyGraph: Map<string, DependencyNode> = new Map();
  private availablePlugins: Map<string, PluginMetadata[]> = new Map();

  /**
   * 添加插件
   */
  addPlugin(metadata: PluginMetadata): void {
    const node: DependencyNode = {
      name: metadata.name,
      version: metadata.version,
      dependencies: metadata.dependencies || [],
      dependents: [],
      resolved: false,
    };

    this.dependencyGraph.set(metadata.name, node);

    // 添加到可用插件列表
    if (!this.availablePlugins.has(metadata.name)) {
      this.availablePlugins.set(metadata.name, []);
    }

    const versions = this.availablePlugins.get(metadata.name)!;
    versions.push(metadata);

    // 按版本排序（降序）
    versions.sort((a, b) => this.compareVersions(b.version, a.version));

    logger.info(
      `✅ Plugin added to dependency graph: ${metadata.name}@${metadata.version}`
    );
  }

  /**
   * 移除插件
   */
  removePlugin(pluginName: string, version?: string): boolean {
    if (version) {
      // 移除特定版本
      const versions = this.availablePlugins.get(pluginName);

      if (!versions) {
        return false;
      }

      const index = versions.findIndex((v) => v.version === version);

      if (index === -1) {
        return false;
      }

      versions.splice(index, 1);

      // 如果没有版本了，移除整个插件
      if (versions.length === 0) {
        this.availablePlugins.delete(pluginName);
        this.dependencyGraph.delete(pluginName);
      }
    } else {
      // 移除整个插件
      this.availablePlugins.delete(pluginName);
      this.dependencyGraph.delete(pluginName);
    }

    logger.info(
      `✅ Plugin removed from dependency graph: ${pluginName}${version ? '@' + version : ''}`
    );

    return true;
  }

  /**
   * 解析依赖
   */
  resolveDependencies(
    pluginName: string,
    version?: string
  ): DependencyResolution {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const dependencyChain: string[] = [];
    const missingDependencies: string[] = [];
    const versionConflicts: VersionConflict[] = [];
    const circularDependencies: string[][] = [];

    const result = this.dfsResolveDependencies(
      pluginName,
      version,
      visited,
      visiting,
      dependencyChain,
      missingDependencies,
      versionConflicts,
      circularDependencies
    );

    return {
      success:
        result &&
        missingDependencies.length === 0 &&
        versionConflicts.length === 0 &&
        circularDependencies.length === 0,
      dependencyChain,
      missingDependencies,
      versionConflicts,
      circularDependencies,
      error: !result
        ? `Dependency resolution failed: missing=${missingDependencies.length}, conflicts=${versionConflicts.length}, circular=${circularDependencies.length}`
        : undefined,
    };
  }

  /**
   * 深度优先搜索解析依赖
   */
  private dfsResolveDependencies(
    pluginName: string,
    version: string | undefined,
    visited: Set<string>,
    visiting: Set<string>,
    dependencyChain: string[],
    missingDependencies: string[],
    versionConflicts: VersionConflict[],
    circularDependencies: string[][]
  ): boolean {
    if (visited.has(pluginName)) {
      return true; // 已经访问过
    }

    if (visiting.has(pluginName)) {
      // 检测到循环依赖
      const cycle = Array.from(visiting).concat(pluginName);
      circularDependencies.push(cycle);
      return false;
    }

    visiting.add(pluginName);

    // 获取插件元数据
    const metadata = this.getBestMatch(pluginName, version);

    if (!metadata) {
      missingDependencies.push(
        version ? `${pluginName}@${version}` : pluginName
      );
      visiting.delete(pluginName);
      return false;
    }

    // 解析依赖
    let allDependenciesResolved = true;

    for (const dependency of metadata.dependencies || []) {
      const resolved = this.dfsResolveDependencies(
        dependency.name,
        dependency.version,
        visited,
        visiting,
        dependencyChain,
        missingDependencies,
        versionConflicts,
        circularDependencies
      );

      if (!resolved) {
        allDependenciesResolved = false;
      }

      // 检查版本冲突
      const dependencyMetadata = this.getBestMatch(
        dependency.name,
        dependency.version
      );

      if (dependencyMetadata && dependency.version) {
        if (
          !this.satisfiesVersion(dependencyMetadata.version, dependency.version)
        ) {
          versionConflicts.push({
            pluginName: dependency.name,
            requiredVersion: dependency.version,
            actualVersion: dependencyMetadata.version,
            dependent: pluginName,
          });
          allDependenciesResolved = false;
        }
      }
    }

    visiting.delete(pluginName);
    visited.add(pluginName);

    if (allDependenciesResolved) {
      dependencyChain.push(version ? `${pluginName}@${version}` : pluginName);
    }

    return allDependenciesResolved;
  }

  /**
   * 获取最佳匹配插件
   */
  private getBestMatch(
    pluginName: string,
    version?: string
  ): PluginMetadata | undefined {
    const versions = this.availablePlugins.get(pluginName);

    if (!versions || versions.length === 0) {
      return undefined;
    }

    if (!version) {
      // 返回最新版本
      return versions[0];
    }

    // 查找满足版本要求的插件
    for (const metadata of versions) {
      if (this.satisfiesVersion(metadata.version, version)) {
        return metadata;
      }
    }

    return undefined;
  }

  /**
   * 检查版本是否满足要求
   * 复用 utils/semver.ts 的完整实现（^ 主版本约束、~ 主次版本约束、||、范围等）
   * 修复：原实现对 `^1.2.3` 仅判断 `>= 1.2.3`，允许 2.x 通过（语义过宽，CS05-ROOTFIX）
   */
  private satisfiesVersion(
    actualVersion: string,
    requiredVersion: string
  ): boolean {
    if (requiredVersion === '*' || requiredVersion === 'latest') {
      return true;
    }

    try {
      return satisfies(actualVersion, requiredVersion);
    } catch {
      return false;
    }
  }

  /**
   * 比较版本号
   */
  private compareVersions(version1: string, version2: string): number {
    const parts1 = version1.split('.').map(Number);
    const parts2 = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

  /**
   * 服务级环检测（从本类迁入内核，评审修订 v4）
   * 委托 dependencyResolver 内核：内部先 getServiceProviderPluginId 转插件级边
   * （排除 kernel.* 与自依赖）再 detectCycles，环输出恒为插件名序列（与迁移前等价）。
   * @param pluginInjectMap 插件 ID → inject 声明服务名列表
   * @returns 服务级依赖环列表（每个环为插件名序列），无环返回空数组
   */
  checkServiceCircularDependencies(
    pluginInjectMap: Map<string, string[]>
  ): string[][] {
    return checkServiceCircularDependenciesCore(pluginInjectMap);
  }

  /**
   * 获取可用插件
   */
  getAvailablePlugins(): Map<string, PluginMetadata[]> {
    return new Map(this.availablePlugins);
  }

  /**
   * 获取插件依赖
   */
  getPluginDependencies(pluginName: string): PluginDependency[] {
    const node = this.dependencyGraph.get(pluginName);

    if (!node) {
      return [];
    }

    return node.dependencies;
  }

  /**
   * 获取插件被依赖
   */
  getPluginDependents(pluginName: string): string[] {
    const node = this.dependencyGraph.get(pluginName);

    if (!node) {
      return [];
    }

    return node.dependents;
  }

  /**
   * 清理依赖管理器
   */
  clear(): void {
    this.dependencyGraph.clear();
    this.availablePlugins.clear();

    logger.info('✅ Plugin dependency manager cleared');
  }
}

export default PluginDependencyManager;
