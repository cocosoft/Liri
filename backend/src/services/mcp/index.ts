//
/**
 * MCP系统主入口
 * 整合所有MCP系统模块
 */

import { logger } from '@modules/utils/log';
import { enhancedMcpConfigManager } from './EnhancedMCPConfigManager';
import { mcpConnectionManager } from './MCPConnectionManager';
import { mcpToolBridge } from './MCPToolBridge';
import { claudeAIIntegration } from './ClaudeAIIntegration';
import { getCommandManager } from './commandManager';
import { resourceManager } from './resourceManager';
import { mcpCacheManager } from './MCPCacheManager';
import { prefetchOfficialMcpUrls, getOfficialServers, getOfficialServersByCategory, getOfficialServer, getCategories } from './MCPOfficialRegistry';
import { normalizeNameForMCP, normalizeToolName, isValidMcpName } from './normalization';
import { needsElicitation, getElicitationPrompts, validateElicitationAnswers, applyElicitationAnswers, registerElicitationPrompts } from './elicitationHandler';
import { setChannelPermissionConfig, getChannelPermissionConfig, checkResourcePermission, checkToolPermission, isResourceAccessAllowed, isToolAccessAllowed } from './channelPermissions';
import type { ScopedMcpServerConfig } from './types';

/**
 * MCP系统
 */
export class MCPSystem {
  private initialized = false;

  /**
   * 初始化MCP系统
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('MCP system already initialized');
      return;
    }

    try {
      logger.info('Initializing MCP system');

      // 加载配置
      const configs = await enhancedMcpConfigManager.loadConfigs();
      logger.info(`Loaded ${Object.keys(configs).length} MCP server configs`);

      // 初始化连接管理器
      await mcpConnectionManager.initialize(configs);

      // 初始化MCP工具桥接器（将MCP工具注册到ToolManager）
      await mcpToolBridge.initialize();

      // 初始化Claude AI集成
      await claudeAIIntegration.initialize();

      // 预取官方MCP注册表
      prefetchOfficialMcpUrls().catch(err =>
        logger.warn(`Failed to prefetch MCP registry: ${err instanceof Error ? err.message : String(err)}`)
      );

      // 监听服务器连接状态变化
      this.setupServerStateListeners();

      this.initialized = true;
      logger.info('MCP system initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize MCP system:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 设置服务器状态监听器
   */
  private setupServerStateListeners(): void {
    // 这里可以添加服务器状态变化的监听器
    // 例如，当服务器连接状态变化时，通知Claude AI集成
  }

  /**
   * 获取所有服务器
   */
  getServers() {
    return mcpConnectionManager.getServers();
  }

  /**
   * 获取单个服务器
   */
  getServer(name: string) {
    return mcpConnectionManager.getServer(name);
  }

  /**
   * 重连服务器
   */
  async reconnectServer(name: string) {
    return await mcpConnectionManager.reconnectServer(name);
  }

  /**
   * 切换服务器启用状态
   */
  async toggleServer(name: string) {
    return await mcpConnectionManager.toggleServer(name);
  }

  /**
   * 执行命令
   */
  async executeCommand(name: string, args: any) {
    return await getCommandManager().executeCommand(name, args);
  }

  /**
   * 获取所有命令
   */
  getCommands() {
    return getCommandManager().getCommands();
  }

  /**
   * 获取所有资源
   */
  getResources() {
    return resourceManager.getResources();
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return mcpCacheManager.getCacheStats();
  }

  /**
   * 刷新所有MCP工具到ToolManager
   */
  async refreshAllTools(): Promise<number> {
    return await mcpToolBridge.refreshAllTools();
  }

  /**
   * 获取已注册的MCP工具数量
   */
  getRegisteredMcpToolCount(): number {
    return mcpToolBridge.getRegisteredCount();
  }

  /**
   * 获取Claude AI服务器状态
   */
  getClaudeAIServerStatus() {
    return claudeAIIntegration.getClaudeAIServerStatus();
  }

  /**
   * 执行Claude AI命令
   */
  async executeClaudeAICommand(serverName: string, commandName: string, args: any) {
    return await claudeAIIntegration.executeClaudeAICommand(serverName, commandName, args);
  }

  /**
   * 重新加载配置
   */
  async reloadConfigs() {
    return await enhancedMcpConfigManager.reloadConfigs();
  }

  /**
   * 添加服务器配置
   */
  addServerConfig(name: string, config: ScopedMcpServerConfig) {
    enhancedMcpConfigManager.addConfig(name, config);
  }

  /**
   * 删除服务器配置
   */
  removeServerConfig(name: string) {
    enhancedMcpConfigManager.removeConfig(name);
  }

  /**
   * 获取官方MCP服务器列表
   */
  getOfficialServers() {
    return getOfficialServers();
  }

  /**
   * 按分类获取官方MCP服务器
   */
  getOfficialServersByCategory(category: string) {
    return getOfficialServersByCategory(category);
  }

  /**
   * 获取单个官方MCP服务器
   */
  getOfficialServer(name: string) {
    return getOfficialServer(name);
  }

  /**
   * 获取官方MCP服务器分类列表
   */
  getCategories() {
    return getCategories();
  }

  /**
   * 规范化MCP名称
   */
  normalizeName(name: string): string {
    return normalizeNameForMCP(name);
  }

  /**
   * 规范化工具名称
   */
  normalizeTool(serverName: string, toolName: string): string {
    return normalizeToolName(serverName, toolName);
  }

  /**
   * 验证MCP名称是否有效
   */
  isValidName(name: string): boolean {
    return isValidMcpName(name);
  }

  /**
   * 检查服务器是否需要引导配置
   */
  needsElicitation(serverName: string, config: ScopedMcpServerConfig): boolean {
    return needsElicitation(serverName, config);
  }

  /**
   * 获取引导提示
   */
  getElicitationPrompts(serverName: string) {
    return getElicitationPrompts(serverName);
  }

  /**
   * 验证引导答案
   */
  validateElicitation(serverName: string, answers: Record<string, string>) {
    return validateElicitationAnswers(serverName, answers);
  }

  /**
   * 应用引导答案到配置
   */
  applyElicitation(config: ScopedMcpServerConfig, answers: Record<string, string>) {
    return applyElicitationAnswers(config, answers);
  }

  /**
   * 注册引导提示
   */
  registerElicitationPrompts(serverName: string, prompts: any[]) {
    registerElicitationPrompts(serverName, prompts);
  }

  /**
   * 设置通道权限配置
   */
  setChannelPermission(config: {
    serverName: string;
    defaultBehavior: 'always_allow' | 'always_deny' | 'ask_each_time';
    resourcePermissions?: Array<{ resourceUri: string; behavior: 'always_allow' | 'always_deny' | 'ask_each_time' }>;
    toolPermissions?: Array<{ toolName: string; behavior: 'always_allow' | 'always_deny' | 'ask_each_time' }>;
  }) {
    setChannelPermissionConfig({
      serverName: config.serverName,
      defaultBehavior: config.defaultBehavior,
      resourcePermissions: config.resourcePermissions || [],
      toolPermissions: config.toolPermissions || [],
    });
  }

  /**
   * 检查资源访问权限
   */
  checkResourceAccess(serverName: string, resourceUri: string): boolean {
    return isResourceAccessAllowed(serverName, resourceUri);
  }

  /**
   * 检查工具访问权限
   */
  checkToolAccess(serverName: string, toolName: string): boolean {
    return isToolAccessAllowed(serverName, toolName);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up MCP system');

      // 清理Claude AI集成
      claudeAIIntegration.cleanup();

      // 清理MCP工具桥接器
      await mcpToolBridge.cleanup();

      // 清理连接管理器
      await mcpConnectionManager.closeAll();

      // 清理命令和资源
      getCommandManager().clear();
      resourceManager.clear();

      // 清理缓存
      mcpCacheManager.clearAllCache();

      // 清理配置管理器
      enhancedMcpConfigManager.cleanup();

      this.initialized = false;
      logger.info('MCP system cleaned up successfully');
    } catch (error) {
      logger.error('Failed to cleanup MCP system:', error instanceof Error ? error : new Error(String(error)));
    }
  }
}

// 导出单例
export const mcpSystem = new MCPSystem();

// 导出新模块
export { MCPOfficialRegistry } from './MCPOfficialRegistry';
export { normalizeNameForMCP, normalizeToolName, normalizeCommandName, normalizeResourceUri, denormalizeMcpName, isValidMcpName } from './normalization';
export { elicitationHandler, getElicitationPrompts, needsElicitation, validateElicitationAnswers, applyElicitationAnswers, registerElicitationPrompts } from './elicitationHandler';
export { channelPermissions, setChannelPermissionConfig, getChannelPermissionConfig, checkResourcePermission, checkToolPermission, isResourceAccessAllowed, isToolAccessAllowed } from './channelPermissions';
export { mcpToolBridge, MCPToolBridge } from './MCPToolBridge';
export { McpToolWrapper } from './McpToolWrapper';