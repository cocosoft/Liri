// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * MCP 增强层统一入口
 * 引用标准层 (services/mcp/) 接口和类型，提供增强层功能
 * 标准层功能请从 @modules/services/mcp 导入
 */

// ── 认证 ──
export { MCPAuthManager, mcpAuthManager } from '../services/mcp/auth/index.js';
export type {
  MCPOAuthConfig,
  MCPOAuthToken,
  MCPOAuthState,
  MCPOAuthDiscoveryState,
} from '../services/mcp/auth/index.js';

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

// ── 传输层（直接引用 services/mcp/transports/）──
export { MCPTransport as MCPTransportBase } from '../services/mcp/transports/MCPTransport.js';
export { TransportFactory } from '../services/mcp/TransportFactory.js';
export { SSETransport } from '../services/mcp/transports/SSETransport.js';
export { WebSocketTransport } from '../services/mcp/transports/WebSocketTransport.js';
export { HTTPTransport } from '../services/mcp/transports/HTTPTransport.js';
export { StdioTransport } from '../services/mcp/transports/StdioTransport.js';
export {
  createLinkedTransportPair,
  InProcessTransportFactory,
} from '../services/mcp/transports/InProcessTransport.js';

// ── 客户端 ──
export { MCPClientImpl } from './client/MCPClient.js';

// ── 管理 ──
export { MCPManager } from './managers/MCPManager.js';
export type {
  MCPServerChangeType,
  MCPServerChangeEvent,
} from './managers/MCPManager.js';
export {
  MCPServerManager,
  getMCPServerManager,
} from '../services/mcp/MCPServerManager.js';
export { MCPConnection as MCPServerConnection } from '../services/mcp/MCPConnection.js';

// ── 工具注册表 ──
export { MCPToolRegistry } from '../services/mcp/MCPToolRegistry.js';
export type { MCPToolInfo } from '../services/mcp/MCPToolRegistry.js';

// ── 工具 ──
export { MCPTool } from './MCPTool.js';
export type { MCPToolParams } from './MCPTool.js';

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
} from '../services/mcp/MCPOfficialRegistry.js';

export {
  MCPResourceManager,
  mcpResourceManager,
} from '../services/mcp/resourceManager.js';
export type {
  MCPResourceType,
  MCPResource,
  MCPTextResource,
  MCPImageResource,
  MCPBinaryResource,
  ResourceProcessingConfig,
} from '../services/mcp/resourceManager.js';

export {
  ChannelPermissionRelay,
  getChannelPermissionRelay,
  clearChannelPermissionRelay,
} from '../services/mcp/channelPermissions.js';
export type {
  ChannelPermissionResponse,
  ChannelPermissionCallbacks,
} from '../services/mcp/channelPermissions.js';

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
} from '../services/mcp/normalization.js';

export {
  mcpElicitationQueue,
  MCPElicitationQueue,
  DefaultMCPElicitHandler,
  buildElicitResponse,
  getElicitInputType,
  validateElicitParams,
} from '../services/mcp/elicitationHandler.js';
export type {
  ElicitationRequestEvent,
  ElicitResponseType,
  MCPElicitResponse,
  ElicitInputType,
  ElicitOption,
  ElicitationWaitingState,
  MCPElicitHandler,
  ElicitToolParams,
} from '../services/mcp/elicitationHandler.js';

// ── CLI ──
export { createMcpCommand } from './cli/mcpCommand.js';

// ── MCP Server ──
export { startMCPServer } from '../entrypoints/mcp.js';

// ── 插件 MCP 工具暴露 ──
export {
  createPluginMCPTools,
  getPluginSummary,
} from '../services/mcp/PluginMCPToolServer.js';
export type { PluginMCPToolOptions } from '../services/mcp/PluginMCPToolServer.js';
