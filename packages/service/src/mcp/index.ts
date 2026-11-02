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
 * 标准层功能请从 @openliri/service/services/mcp 导入
 */

// ── 认证 ──
export {
  MCPAuthManager,
  mcpAuthManager,
} from '@openliri/service/services/mcp/auth/index';
export type {
  MCPOAuthConfig,
  MCPOAuthToken,
  MCPOAuthState,
  MCPOAuthDiscoveryState,
} from '@openliri/service/services/mcp/auth/index';

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
export { MCPTransport as MCPTransportBase } from '@openliri/service/services/mcp/transports/MCPTransport';
export { TransportFactory } from '@openliri/service/services/mcp/TransportFactory';
export { SSETransport } from '@openliri/service/services/mcp/transports/SSETransport';
export { WebSocketTransport } from '@openliri/service/services/mcp/transports/WebSocketTransport';
export { HTTPTransport } from '@openliri/service/services/mcp/transports/HTTPTransport';
export { StdioTransport } from '@openliri/service/services/mcp/transports/StdioTransport';
export {
  createLinkedTransportPair,
  InProcessTransportFactory,
} from '@openliri/service/services/mcp/transports/InProcessTransport';

// ── 客户端（C3）──
// 2026-10-08（MCP 双轨收敛 C-3）：原 `export { MCPClientImpl }`（增强层自建客户端，
// `mcp/client/MCPClient.ts`）**零消费者**（仅本 barrel 转出）⇒ 连同文件删除。
// MCP 客户端唯一实现 = 标准层 SDK `Client`（`services/mcp/client.ts` + `MCPConnectionManager`）。

// ── 管理 ──
// 2026-10-08（MCP 双轨收敛 C-2）：原 `export { MCPManager }` / `MCPServerChange*` —— 增强层
// 自建管理类（528 行）为 C2（自研链）之上的重实现，全仓零外部消费者；其唯一消费者
// `MCPCommandLoader` 同批删除。MCP 管理面统一到标准层（下 `MCPServerManager`）。
export {
  MCPServerManager,
  getMCPServerManager,
} from '@openliri/service/services/mcp/MCPServerManager';
export { MCPConnection as MCPServerConnection } from '@openliri/service/services/mcp/MCPConnection';

// ── 工具注册表 ──
export { MCPToolRegistry } from '@openliri/service/services/mcp/MCPToolRegistry';
export type { MCPToolInfo } from '@openliri/service/services/mcp/MCPToolRegistry';

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
} from '@openliri/service/services/mcp/MCPOfficialRegistry';

export {
  MCPResourceManager,
  mcpResourceManager,
} from '@openliri/service/services/mcp/resourceManager';
export type {
  MCPResourceType,
  MCPResource,
  MCPTextResource,
  MCPImageResource,
  MCPBinaryResource,
  ResourceProcessingConfig,
} from '@openliri/service/services/mcp/resourceManager';

export {
  ChannelPermissionRelay,
  getChannelPermissionRelay,
  clearChannelPermissionRelay,
} from '@openliri/infra/security';
export type {
  ChannelPermissionResponse,
  ChannelPermissionCallbacks,
} from '@openliri/infra/security';

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
} from '@openliri/service/services/mcp/normalization';

export {
  mcpElicitationQueue,
  MCPElicitationQueue,
  DefaultMCPElicitHandler,
  buildElicitResponse,
  getElicitInputType,
  validateElicitParams,
} from '@openliri/service/services/mcp/elicitationHandler';
export type {
  ElicitationRequestEvent,
  ElicitResponseType,
  MCPElicitResponse,
  ElicitInputType,
  ElicitOption,
  ElicitationWaitingState,
  MCPElicitHandler,
  ElicitToolParams,
} from '@openliri/service/services/mcp/elicitationHandler';

// ── CLI ──
export { createMcpCommand } from './cli/mcpCommand.js';

// ── 插件 MCP 工具暴露 ──
export {
  createPluginMCPTools,
  getPluginSummary,
} from '@openliri/service/services/mcp/PluginMCPToolServer';
export type { PluginMCPToolOptions } from '@openliri/service/services/mcp/PluginMCPToolServer';
