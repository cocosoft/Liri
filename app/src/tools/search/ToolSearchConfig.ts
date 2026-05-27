/**
 * 工具搜索配置
 * 控制工具搜索的行为和参数
 * */

export interface ToolSearchConfig {
  /**
   * 自动启用工具搜索的百分比阈值
   */
  autoEnablePercentage: number;
  /**
   * 启用自动模式
   */
  enableAutoMode: boolean;
  /**
   * 启用延迟加载工具
   */
  enableDeferredTools: boolean;
  /**
   * 开始搜索前的最大工具数量
   */
  maxToolsBeforeSearch: number;
  /**
   * 搜索结果的最大工具数量
   */
  maxSearchResults: number;
  /**
   * 工具定义的最大token数
   */
  maxToolDefinitionTokens: number;
  /**
   * 搜索超时时间（毫秒）
   */
  searchTimeout: number;
  /**
   * 启用embedding搜索
   */
  enableEmbeddingSearch: boolean;
  /**
   * 启用语义匹配
   */
  enableSemanticMatching: boolean;
  /**
   * 匹配阈值
   */
  matchingThreshold: number;
}

export const DEFAULT_TOOL_SEARCH_CONFIG: ToolSearchConfig = {
  autoEnablePercentage: 0.8,
  enableAutoMode: true,
  enableDeferredTools: true,
  maxToolsBeforeSearch: 100,
  maxSearchResults: 20,
  maxToolDefinitionTokens: 5000,
  searchTimeout: 5000,
  enableEmbeddingSearch: false,
  enableSemanticMatching: true,
  matchingThreshold: 0.6,
};

export class ToolSearchConfigManager {
  private config: ToolSearchConfig;

  constructor(config?: Partial<ToolSearchConfig>) {
    this.config = {
      ...DEFAULT_TOOL_SEARCH_CONFIG,
      ...config,
    };
  }

  getConfig(): ToolSearchConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ToolSearchConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  shouldDeferTools(toolCount: number, contextPercentage: number): boolean {
    return (
      this.config.enableDeferredTools &&
      toolCount >= this.config.maxToolsBeforeSearch &&
      contextPercentage >= this.config.autoEnablePercentage
    );
  }

  shouldEnableSearch(toolCount: number): boolean {
    return toolCount >= this.config.maxToolsBeforeSearch;
  }

  getMaxSearchResults(): number {
    return this.config.maxSearchResults;
  }

  getSearchTimeout(): number {
    return this.config.searchTimeout;
  }

  isEmbeddingSearchEnabled(): boolean {
    return this.config.enableEmbeddingSearch;
  }

  isSemanticMatchingEnabled(): boolean {
    return this.config.enableSemanticMatching;
  }

  getMatchingThreshold(): number {
    return this.config.matchingThreshold;
  }
}

export function createToolSearchConfig(
  config?: Partial<ToolSearchConfig>
): ToolSearchConfigManager {
  return new ToolSearchConfigManager(config);
}
