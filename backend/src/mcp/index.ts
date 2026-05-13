/**
 * MCP 增强层统一入口
 * 引用标准层 (services/mcp/) 接口和类型，提供增强层功能
 * 标准层功能请从 @modules/services/mcp 导入
 */

// ── 认证 ──
export { MCPAuthManager, mcpAuthManager } from './auth/index.js';
export type {
  MCPOAuthConfig,
  MCPOAuthToken,
  MCPOAuthState,
  MCPOAuthDiscoveryState,
} from './auth/index.js';

// ── 类型 ──
export { MCP_PROTOCOL_VERSION, MCPServerStatus } from './types/index.js';
export type {
  ConfigScope,
  MCPServerType,
  MCPServerConfig,
  ScopedMcpServerConfig,
  MCPServerConnectionInfo,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
  MCPRequest,
  MCPResponse,
  MCPClientState,
  MCPClientInfo,
  MCPServerInfo,
  MCPConnectionConfig,
  MCPConnectionStats,
  MCPEventType,
  MCPEvent,
  MCPTransport,
  MCPClient,
  MCPPluginConfig,
  McpbLoadResult,
  McpbNeedsConfigResult,
  ServerResource,
  MCPClientType,
  MCPTransportType,
} from './types/index.js';

// ── 传输层 ──
export { MCPTransport as MCPTransportBase } from './transports/MCPTransport.js';
export { TransportFactory } from './transports/TransportFactory.js';
export { SSETransport } from './transports/SSETransport.js';
export { WebSocketTransport } from './transports/WebSocketTransport.js';
export { HTTPTransport } from './transports/HTTPTransport.js';
export { StdioTransport } from './transports/StdioTransport.js';
export {
  createLinkedTransportPair,
  InProcessTransportFactory,
} from './transports/InProcessTransport.js';

// ── 客户端 ──
export { MCPClientImpl } from './client/MCPClient.js';

// ── 协议 ──
export {
  MCPProtocolValidator,
  MCPProtocolError,
} from './protocol/MCPProtocol.js';

// ── 管理 ──
export { MCPManager } from './managers/MCPManager.js';
export {
  MCPServerManager,
  getMCPServerManager,
} from './managers/MCPServerManager.js';
export { MCPServerConnection } from './managers/MCPServerConnection.js';

// ── 工具管理 ──
export {
  MCPToolManager as MCPToolManagerImpl,
  globalMCPToolManager,
} from './management/MCPToolManager.js';
export type {
  ToolCallContext,
  ToolCallResult,
} from './management/MCPToolManager.js';

// ── 工具注册表 ──
export { MCPToolRegistry } from './MCPToolRegistry.js';
export type { MCPToolInfo } from './MCPToolRegistry.js';

// ── 工具 ──
export { MCPTool } from './MCPTool.js';
export type { MCPToolParams } from './MCPTool.js';

// ── 增强管理器 ──
export { EnhancedMCPManager } from './EnhancedMCPManager.js';
export type {
  MCPPerformanceMetrics,
  MCPServerHealthCheck,
  MCPConnectionAnalytics,
  MCPToolUsageAnalytics,
  MCPResourceAnalytics,
  MCPOptimizationRecommendation,
  MCPSystemReport,
  EnhancedMCPManagerConfig,
} from './EnhancedMCPManager.js';

// ── 智能分析器 ──
export { IntelligentMCPAnalyzer } from './IntelligentMCPAnalyzer.js';
export type { MCPAnalysisResult } from './IntelligentMCPAnalyzer.js';

// ── 工具函数 ──
export {
  readMcpConfig,
  writeMcpConfig,
  addMcpServer,
  removeMcpServer,
  updateMcpServer,
  getMcpServer,
  listMcpServers,
  validateMcpServerConfig,
  loadMcpConfigFromEnv,
  mergeMcpConfigs,
} from './utils/mcpConfig.js';

export {
  prefetchOfficialMcpUrls,
  isOfficialMcpUrl,
  getOfficialServers,
  getOfficialServersByCategory,
  getOfficialServer,
  getCategories,
} from './utils/MCPOfficialRegistry.js';

export {
  MCPResourceManager,
  mcpResourceManager,
} from './utils/MCPResourceManager.js';
export type {
  MCPResourceType,
  MCPResource,
  MCPTextResource,
  MCPImageResource,
  MCPBinaryResource,
  ResourceProcessingConfig,
} from './utils/MCPResourceManager.js';

export {
  ChannelPermissionRelay,
  getChannelPermissionRelay,
  clearChannelPermissionRelay,
} from './utils/ChannelPermissions.js';
export type {
  ChannelPermissionResponse,
  ChannelPermissionCallbacks,
} from './utils/ChannelPermissions.js';

export {
  normalizeNameForMCP,
  normalizeToolName,
  normalizeSimpleToolName,
  normalizeResourceUri,
  normalizeSimpleResourceUri,
  normalizeCommandName,
  needsNormalization,
  denormalizeMcpName,
  isValidMcpName,
} from './utils/MCPNormalization.js';

export {
  mcpElicitationQueue,
  MCPElicitationQueue,
  DefaultMCPElicitHandler,
  buildElicitResponse,
  getElicitInputType,
  validateElicitParams,
} from './utils/MCPElicitationHandler.js';
export type {
  ElicitationRequestEvent,
  ElicitResponseType,
  MCPElicitResponse,
  ElicitInputType,
  ElicitOption,
  ElicitationWaitingState,
  MCPElicitHandler,
  ElicitToolParams,
} from './utils/MCPElicitationHandler.js';

// ── CLI ──
export { createMcpCommand } from './cli/mcpCommand.js';
