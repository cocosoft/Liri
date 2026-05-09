/**
 * MCP系统类型定义（增强层）
 * 标准类型引用自 services/mcp/types/，增强层特有类型定义在本文件
 */

import {
  MCPToolDefinition as _MCPToolDefinition,
  MCPServerConfig as _MCPServerConfig,
} from './MCPTypes.js';

import { ServerResource as _ServerResource } from '../../services/mcp/types/index.js';

export {
  MCP_PROTOCOL_VERSION,
  ConfigScope,
  MCPServerType,
  MCPServerConfig,
  ScopedMcpServerConfigExt as ScopedMcpServerConfig,
  MCPServerStatus,
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
} from './MCPTypes.js';

export type {
  ScopedMcpServerConfigExt,
  MCPClient as MCPClientType,
  MCPTransport as MCPTransportType,
  UserConfigValues,
  UserConfigSchema,
} from './MCPTypes.js';

export type { _ServerResource as ServerResource };

/**
 * MCP插件配置
 */
export interface MCPPluginConfig {
  /** MCP服务器配置 */
  mcpServers?:
    | string
    | _MCPToolDefinition[]
    | Record<string, _MCPServerConfig>;
  /** 用户配置 */
  userConfig?: Record<string, any>;
  /** 通道配置 */
  channels?: {
    /** 服务器名称 */
    server: string;
    /** 显示名称 */
    displayName?: string;
    /** 用户配置schema */
    userConfig?: Record<string, any>;
  }[];
}

/**
 * MCPB加载结果
 */
export interface McpbLoadResult {
  /** 提取路径 */
  extractedPath: string;
  /** 清单 */
  manifest: {
    /** 名称 */
    name: string;
    /** 版本 */
    version: string;
    /** 描述 */
    description?: string;
    /** 作者 */
    author?: string;
  };
  /** MCP配置 */
  mcpConfig: _MCPServerConfig;
}

/**
 * MCPB需要配置的结果
 */
export interface McpbNeedsConfigResult {
  /** 状态 */
  status: 'needs-config';
  /** 清单 */
  manifest: {
    /** 名称 */
    name: string;
    /** 版本 */
    version: string;
    /** 描述 */
    description?: string;
    /** 作者 */
    author?: string;
  };
}
