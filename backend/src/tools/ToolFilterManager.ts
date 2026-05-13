/**
 * 工具过滤器管理器
 *
 * 实现三层过滤机制：
 * 1. Feature Flag 过滤 - 根据功能开关过滤工具
 * 2. Deny 规则过滤 - 根据拒绝规则过滤工具
 * 3. MCP 合并 - 合并 MCP 工具
 */

import type { FeatureFlag } from '@modules/core/featureFlags';
import { Tool, ToolInfo } from './types/Tool';
import { ToolRegistry } from './ToolRegistry';

/**
 * 过滤结果
 */
export interface FilterResult {
  /** 过滤后的工具 */
  tools: Tool[];
  /** 被过滤的工具及原因 */
  filteredTools: Array<{
    tool: Tool;
    reason: string;
    filterType: 'feature_flag' | 'deny_rule' | 'mcp_merge' | 'always_load';
  }>;
}

/**
 * 功能开关配置
 */
export interface FeatureFlagConfig {
  /** 功能开关名称 */
  name: FeatureFlag;
  /** 是否启用 */
  enabled: boolean;
  /** 关联的工具名称 */
  toolNames?: string[];
  /** 关联的工具模式（glob） */
  toolPatterns?: string[];
}

/**
 * 拒绝规则配置
 */
export interface DenyRuleConfig {
  /** 规则名称 */
  name: string;
  /** 工具名称模式（支持glob） */
  pattern: string;
  /** 原因 */
  reason?: string;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * MCP 工具源
 */
export interface MCPToolSource {
  /** MCP 服务器名称 */
  serverName: string;
  /** 工具列表 */
  tools: Tool[];
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 工具过滤器管理器类
 */
export class ToolFilterManager {
  /** 工具注册表 */
  private registry: ToolRegistry;
  /** 功能开关配置 */
  private featureFlags: Map<string, FeatureFlagConfig> = new Map();
  /** 拒绝规则配置 */
  private denyRules: DenyRuleConfig[] = [];
  /** MCP 工具源 */
  private mcpToolSources: MCPToolSource[] = [];
  /** MCP 合并启用状态 */
  private mcpMergeEnabled: boolean = true;
  /** 缓存的工具列表 */
  private cachedTools: Tool[] | null = null;
  /** 缓存是否有效 */
  private cacheValid: boolean = false;

  /**
   * 构造函数
   * @param registry 工具注册表实例
   */
  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * 添加功能开关
   * @param config 功能开关配置
   */
  addFeatureFlag(config: FeatureFlagConfig): void {
    this.featureFlags.set(config.name, config);
    this.invalidateCache();
  }

  /**
   * 移除功能开关
   * @param name 功能开关名称
   */
  removeFeatureFlag(name: string): void {
    this.featureFlags.delete(name);
    this.invalidateCache();
  }

  /**
   * 启用功能开关
   * @param name 功能开关名称
   */
  enableFeatureFlag(name: string): void {
    const config = this.featureFlags.get(name);
    if (config) {
      config.enabled = true;
      this.invalidateCache();
    }
  }

  /**
   * 禁用功能开关
   * @param name 功能开关名称
   */
  disableFeatureFlag(name: string): void {
    const config = this.featureFlags.get(name);
    if (config) {
      config.enabled = false;
      this.invalidateCache();
    }
  }

  /**
   * 添加拒绝规则
   * @param config 拒绝规则配置
   */
  addDenyRule(config: DenyRuleConfig): void {
    this.denyRules.push(config);
    this.invalidateCache();
  }

  /**
   * 移除拒绝规则
   * @param name 规则名称
   */
  removeDenyRule(name: string): void {
    this.denyRules = this.denyRules.filter((rule) => rule.name !== name);
    this.invalidateCache();
  }

  /**
   * 清空拒绝规则
   */
  clearDenyRules(): void {
    this.denyRules = [];
    this.invalidateCache();
  }

  /**
   * 添加 MCP 工具源
   * @param source MCP 工具源
   */
  addMCPToolSource(source: MCPToolSource): void {
    this.mcpToolSources.push(source);
    this.invalidateCache();
  }

  /**
   * 移除 MCP 工具源
   * @param serverName MCP 服务器名称
   */
  removeMCPToolSource(serverName: string): void {
    this.mcpToolSources = this.mcpToolSources.filter(
      (src) => src.serverName !== serverName
    );
    this.invalidateCache();
  }

  /**
   * 启用 MCP 合并
   */
  enableMCPMerge(): void {
    this.mcpMergeEnabled = true;
    this.invalidateCache();
  }

  /**
   * 禁用 MCP 合并
   */
  disableMCPMerge(): void {
    this.mcpMergeEnabled = false;
    this.invalidateCache();
  }

  /**
   * 使缓存失效
   */
  invalidateCache(): void {
    this.cacheValid = false;
    this.cachedTools = null;
  }

  /**
   * 获取过滤后的工具列表
   * @param useCache 是否使用缓存
   * @returns 过滤结果
   */
  getFilteredTools(useCache: boolean = true): FilterResult {
    if (useCache && this.cacheValid && this.cachedTools !== null) {
      return {
        tools: this.cachedTools,
        filteredTools: [],
      };
    }

    const result: FilterResult = {
      tools: [],
      filteredTools: [],
    };

    const allTools = this.getAllTools();
    const alwaysLoadTools: Tool[] = [];
    const deferredTools: Tool[] = [];

    for (const tool of allTools) {
      let filtered = false;
      const info = tool.getInfo();

      // 检查是否始终加载
      if (info.alwaysLoad || (tool as any).alwaysLoad) {
        alwaysLoadTools.push(tool);
        continue;
      }

      // 第一层：Feature Flag 过滤
      if (this.isFilteredByFeatureFlag(tool)) {
        result.filteredTools.push({
          tool,
          reason: 'Disabled by feature flag',
          filterType: 'feature_flag',
        });
        filtered = true;
      }

      // 第二层：Deny 规则过滤
      if (!filtered && this.isFilteredByDenyRule(tool)) {
        result.filteredTools.push({
          tool,
          reason: this.getDenyRuleReason(tool),
          filterType: 'deny_rule',
        });
        filtered = true;
      }

      // 如果工具被延迟加载（shouldDefer），归类到延迟工具
      if (!filtered && (info.deferred || (tool as any).shouldDefer)) {
        deferredTools.push(tool);
      }

      if (!filtered) {
        result.tools.push(tool);
      }
    }

    // 第三层：MCP 合并
    if (this.mcpMergeEnabled) {
      const mcpTools = this.getMCPTools();
      result.tools.push(...mcpTools);
    }

    // 始终加载的工具总是包含在内
    result.tools.push(...alwaysLoadTools);

    this.cachedTools = result.tools;
    this.cacheValid = true;

    return result;
  }

  /**
   * 获取所有工具（包括延迟加载的）
   * @returns 所有工具列表
   */
  getAllTools(): Tool[] {
    const baseTools = Array.from(this.registry.getTools().values());
    return baseTools;
  }

  /**
   * 获取 MCP 工具
   * @returns MCP 工具列表
   */
  private getMCPTools(): Tool[] {
    const mcpTools: Tool[] = [];

    for (const source of this.mcpToolSources) {
      if (source.enabled !== false) {
        mcpTools.push(...source.tools);
      }
    }

    return mcpTools;
  }

  /**
   * 检查工具是否被功能开关过滤
   * @param tool 工具实例
   * @returns 是否被过滤
   */
  private isFilteredByFeatureFlag(tool: Tool): boolean {
    for (const config of this.featureFlags.values()) {
      if (!config.enabled) {
        continue;
      }

      const info = tool.getInfo();

      if (config.toolNames?.includes(info.name)) {
        return false;
      }

      if (config.toolPatterns) {
        for (const pattern of config.toolPatterns) {
          if (this.matchPattern(info.name, pattern)) {
            return false;
          }
        }
      }
    }

    for (const config of this.featureFlags.values()) {
      if (!config.enabled) {
        const info = tool.getInfo();
        if (config.toolNames?.includes(info.name)) {
          return true;
        }

        if (config.toolPatterns) {
          for (const pattern of config.toolPatterns) {
            if (this.matchPattern(info.name, pattern)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查工具是否被拒绝规则过滤
   * @param tool 工具实例
   * @returns 是否被过滤
   */
  private isFilteredByDenyRule(tool: Tool): boolean {
    const info = tool.getInfo();

    for (const rule of this.denyRules) {
      if (rule.enabled === false) {
        continue;
      }

      if (this.matchPattern(info.name, rule.pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取工具被拒绝的原因
   * @param tool 工具实例
   * @returns 拒绝原因
   */
  private getDenyRuleReason(tool: Tool): string {
    const info = tool.getInfo();

    for (const rule of this.denyRules) {
      if (this.matchPattern(info.name, rule.pattern)) {
        return rule.reason || `Denied by rule: ${rule.name}`;
      }
    }

    return 'Denied by rule';
  }

  /**
   * 匹配模式（支持 glob）
   * @param name 名称
   * @param pattern 模式
   * @returns 是否匹配
   */
  private matchPattern(name: string, pattern: string): boolean {
    const regexPattern = this.globToRegex(pattern);
    return regexPattern.test(name);
  }

  /**
   * 将 glob 模式转换为正则表达式
   * @param glob glob 模式
   * @returns 正则表达式
   */
  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * 获取延迟加载的工具
   * @returns 延迟加载的工具列表
   */
  getDeferredTools(): Tool[] {
    const allTools = this.getAllTools();
    const deferredTools: Tool[] = [];

    for (const tool of allTools) {
      const info = tool.getInfo();
      if (info.deferred || (tool as any).shouldDefer) {
        if (
          !this.isFilteredByFeatureFlag(tool) &&
          !this.isFilteredByDenyRule(tool)
        ) {
          deferredTools.push(tool);
        }
      }
    }

    return deferredTools;
  }

  /**
   * 获取始终加载的工具
   * @returns 始终加载的工具列表
   */
  getAlwaysLoadTools(): Tool[] {
    const allTools = this.getAllTools();
    const alwaysLoadTools: Tool[] = [];

    for (const tool of allTools) {
      const info = tool.getInfo();
      if (info.alwaysLoad || (tool as any).alwaysLoad) {
        alwaysLoadTools.push(tool);
      }
    }

    return alwaysLoadTools;
  }

  /**
   * 搜索延迟工具（用于 ToolSearch）
   * @param query 搜索查询
   * @returns 匹配的工具列表
   */
  searchDeferredTools(query: string): Tool[] {
    const deferredTools = this.getDeferredTools();
    const queryLower = query.toLowerCase();
    const results: Tool[] = [];

    for (const tool of deferredTools) {
      const info = tool.getInfo();

      if (info.name.toLowerCase().includes(queryLower)) {
        results.push(tool);
        continue;
      }

      if (info.description.toLowerCase().includes(queryLower)) {
        results.push(tool);
        continue;
      }

      if (info.searchTips) {
        for (const tip of info.searchTips) {
          if (tip.toLowerCase().includes(queryLower)) {
            results.push(tool);
            break;
          }
        }
      }

      if ((tool as any).searchHint) {
        const hint = (tool as any).searchHint as string;
        if (hint.toLowerCase().includes(queryLower)) {
          results.push(tool);
          continue;
        }
      }
    }

    return results;
  }

  /**
   * 获取过滤统计信息
   * @returns 统计信息
   */
  getFilterStats(): {
    totalTools: number;
    filteredByFeatureFlag: number;
    filteredByDenyRule: number;
    deferredTools: number;
    alwaysLoadTools: number;
    mcpTools: number;
  } {
    const result = this.getFilteredTools();
    const allTools = this.getAllTools();
    const mcpTools = this.getMCPTools();

    return {
      totalTools: allTools.length + mcpTools.length,
      filteredByFeatureFlag: result.filteredTools.filter(
        (f) => f.filterType === 'feature_flag'
      ).length,
      filteredByDenyRule: result.filteredTools.filter(
        (f) => f.filterType === 'deny_rule'
      ).length,
      deferredTools: this.getDeferredTools().length,
      alwaysLoadTools: this.getAlwaysLoadTools().length,
      mcpTools: mcpTools.length,
    };
  }
}

/**
 * 创建工具过滤器管理器实例
 * @param registry 工具注册表实例
 * @returns 工具过滤器管理器实例
 */
export function createToolFilterManager(
  registry: ToolRegistry
): ToolFilterManager {
  return new ToolFilterManager(registry);
}
