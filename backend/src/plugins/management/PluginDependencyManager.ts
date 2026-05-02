/**
 * 插件依赖管理器（基于CC源码实现）
 * 负责插件的依赖解析、版本管理、冲突检测等
 */

import { EventEmitter } from 'events';
import { 
  PluginDependency, 
  PluginDependencyResolution,
  PluginMetadata
} from '../types/PluginTypes';

/**
 * 依赖解析结果（基于CC源码）
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
 * 版本冲突（基于CC源码）
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
 * 依赖图节点（基于CC源码）
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
 * 插件依赖管理器（基于CC源码）
 */
export class PluginDependencyManager extends EventEmitter {
  private dependencyGraph: Map<string, DependencyNode> = new Map();
  private availablePlugins: Map<string, PluginMetadata[]> = new Map();

  /**
   * 添加插件（基于CC源码）
   */
  addPlugin(metadata: PluginMetadata): void {
    const node: DependencyNode = {
      name: metadata.name,
      version: metadata.version,
      dependencies: metadata.dependencies || [],
      dependents: [],
      resolved: false
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
    
    console.log(`✅ Plugin added to dependency graph: ${metadata.name}@${metadata.version}`);
  }

  /**
   * 移除插件（基于CC源码）
   */
  removePlugin(pluginName: string, version?: string): boolean {
    if (version) {
      // 移除特定版本
      const versions = this.availablePlugins.get(pluginName);
      
      if (!versions) {
        return false;
      }
      
      const index = versions.findIndex(v => v.version === version);
      
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
    
    console.log(`✅ Plugin removed from dependency graph: ${pluginName}${version ? '@' + version : ''}`);
    
    return true;
  }

  /**
   * 解析依赖（基于CC源码）
   */
  resolveDependencies(pluginName: string, version?: string): DependencyResolution {
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
      success: result && missingDependencies.length === 0 && versionConflicts.length === 0 && circularDependencies.length === 0,
      dependencyChain,
      missingDependencies,
      versionConflicts,
      circularDependencies,
      error: !result ? `Dependency resolution failed: missing=${missingDependencies.length}, conflicts=${versionConflicts.length}, circular=${circularDependencies.length}` : undefined
    };
  }

  /**
   * 深度优先搜索解析依赖（基于CC源码）
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
      missingDependencies.push(version ? `${pluginName}@${version}` : pluginName);
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
      const dependencyMetadata = this.getBestMatch(dependency.name, dependency.version);
      
      if (dependencyMetadata && dependency.version) {
        if (!this.satisfiesVersion(dependencyMetadata.version, dependency.version)) {
          versionConflicts.push({
            pluginName: dependency.name,
            requiredVersion: dependency.version,
            actualVersion: dependencyMetadata.version,
            dependent: pluginName
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
   * 获取最佳匹配插件（基于CC源码）
   */
  private getBestMatch(pluginName: string, version?: string): PluginMetadata | undefined {
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
   * 检查版本是否满足要求（基于CC源码）
   */
  private satisfiesVersion(actualVersion: string, requiredVersion: string): boolean {
    // 简化版本检查，实际应该使用semver库
    if (requiredVersion === '*' || requiredVersion === 'latest') {
      return true;
    }
    
    if (requiredVersion.startsWith('^')) {
      const baseVersion = requiredVersion.slice(1);
      return this.compareVersions(actualVersion, baseVersion) >= 0;
    }
    
    if (requiredVersion.startsWith('~')) {
      const baseVersion = requiredVersion.slice(1);
      const [major1, minor1] = baseVersion.split('.').map(Number);
      const [major2, minor2] = actualVersion.split('.').map(Number);
      
      return major1 === major2 && minor1 === minor2;
    }
    
    return actualVersion === requiredVersion;
  }

  /**
   * 比较版本号（基于CC源码）
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
   * 拓扑排序（基于CC源码）
   */
  topologicalSort(): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    
    for (const pluginName of this.dependencyGraph.keys()) {
      if (!visited.has(pluginName)) {
        this.dfsTopologicalSort(pluginName, visited, new Set<string>(), result);
      }
    }
    
    return result.reverse();
  }

  /**
   * 深度优先搜索拓扑排序（基于CC源码）
   */
  private dfsTopologicalSort(
    pluginName: string,
    visited: Set<string>,
    visiting: Set<string>,
    result: string[]
  ): void {
    if (visited.has(pluginName)) {
      return;
    }
    
    if (visiting.has(pluginName)) {
      throw new Error(`Circular dependency detected: ${Array.from(visiting).concat(pluginName).join(' -> ')}`);
    }
    
    visiting.add(pluginName);
    
    // 处理依赖
    const node = this.dependencyGraph.get(pluginName);
    
    if (node) {
      for (const dependency of node.dependencies) {
        this.dfsTopologicalSort(dependency.name, visited, visiting, result);
      }
    }
    
    visiting.delete(pluginName);
    visited.add(pluginName);
    
    result.push(pluginName);
  }

  /**
   * 检查循环依赖（基于CC源码）
   */
  checkCircularDependencies(): string[][] {
    const visited = new Set<string>();
    const circularDependencies: string[][] = [];
    
    for (const pluginName of this.dependencyGraph.keys()) {
      if (!visited.has(pluginName)) {
        this.dfsCheckCircularDependencies(pluginName, visited, new Set<string>(), [], circularDependencies);
      }
    }
    
    return circularDependencies;
  }

  /**
   * 深度优先搜索检查循环依赖（基于CC源码）
   */
  private dfsCheckCircularDependencies(
    pluginName: string,
    visited: Set<string>,
    visiting: Set<string>,
    path: string[],
    circularDependencies: string[][]
  ): void {
    if (visited.has(pluginName)) {
      return;
    }
    
    if (visiting.has(pluginName)) {
      // 检测到循环依赖
      const cycleStartIndex = path.indexOf(pluginName);
      if (cycleStartIndex !== -1) {
        const cycle = path.slice(cycleStartIndex).concat(pluginName);
        circularDependencies.push(cycle);
      }
      return;
    }
    
    visiting.add(pluginName);
    path.push(pluginName);
    
    // 检查依赖
    const node = this.dependencyGraph.get(pluginName);
    
    if (node) {
      for (const dependency of node.dependencies) {
        this.dfsCheckCircularDependencies(dependency.name, visited, visiting, path, circularDependencies);
      }
    }
    
    visiting.delete(pluginName);
    path.pop();
    visited.add(pluginName);
  }

  /**
   * 获取依赖图（基于CC源码）
   */
  getDependencyGraph(): Map<string, DependencyNode> {
    return new Map(this.dependencyGraph);
  }

  /**
   * 获取可用插件（基于CC源码）
   */
  getAvailablePlugins(): Map<string, PluginMetadata[]> {
    return new Map(this.availablePlugins);
  }

  /**
   * 获取插件依赖（基于CC源码）
   */
  getPluginDependencies(pluginName: string): PluginDependency[] {
    const node = this.dependencyGraph.get(pluginName);
    
    if (!node) {
      return [];
    }
    
    return node.dependencies;
  }

  /**
   * 获取插件被依赖（基于CC源码）
   */
  getPluginDependents(pluginName: string): string[] {
    const node = this.dependencyGraph.get(pluginName);
    
    if (!node) {
      return [];
    }
    
    return node.dependents;
  }

  /**
   * 清理依赖管理器（基于CC源码）
   */
  clear(): void {
    this.dependencyGraph.clear();
    this.availablePlugins.clear();
    
    console.log('✅ Plugin dependency manager cleared');
  }
}

export default PluginDependencyManager;