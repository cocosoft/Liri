/**
 * MCP系统核心类型定义
 * 增强层类型，标准类型引用自 services/mcp/types/
 */

import type {
  MCPServerConfig as _MCPServerConfig,
  ScopedMcpServerConfigExt as _ScopedMcpServerConfigExt,
  MCPToolDefinition as _MCPToolDefinition,
  MCPResourceDefinition as _MCPResourceDefinition,
  MCPPromptDefinition as _MCPPromptDefinition,
  MCPRequest as _MCPRequest,
  MCPResponse as _MCPResponse,
  MCPClientState as _MCPClientState,
  MCPClientInfo as _MCPClientInfo,
  MCPServerInfo as _MCPServerInfo,
  MCPConnectionConfig as _MCPConnectionConfig,
  MCPConnectionStats as _MCPConnectionStats,
  MCPEventType as _MCPEventType,
  MCPEvent as _MCPEvent,
  MCPTransport as _MCPTransport,
  MCPServerConnectionInfo as _MCPServerConnectionInfo,
} from '../../services/mcp/types/index.js';

export {
  MCP_PROTOCOL_VERSION,
  MCPServerStatus,
} from '../../services/mcp/types/index.js';

export type { _MCPServerConfig as MCPServerConfig };
export type { _ScopedMcpServerConfigExt as ScopedMcpServerConfig };
export type { _ScopedMcpServerConfigExt as ScopedMcpServerConfigExt };
export type { _MCPToolDefinition as MCPToolDefinition };
export type { _MCPResourceDefinition as MCPResourceDefinition };
export type { _MCPPromptDefinition as MCPPromptDefinition };
export type { _MCPRequest as MCPRequest };
export type { _MCPResponse as MCPResponse };
export type { _MCPClientState as MCPClientState };
export type { _MCPClientInfo as MCPClientInfo };
export type { _MCPServerInfo as MCPServerInfo };
export type { _MCPConnectionConfig as MCPConnectionConfig };
export type { _MCPConnectionStats as MCPConnectionStats };
export type { _MCPEventType as MCPEventType };
export type { _MCPEvent as MCPEvent };
export type { _MCPTransport as MCPTransport };
export type { _MCPServerConnectionInfo as MCPServerConnectionInfo };

export type {
  ConfigScope,
  MCPServerType,
} from '../../services/mcp/types/index.js';

/**
 * MCP客户端接口
 */
export interface MCPClient {
  /** 连接服务器 */
  connect(): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 调用工具 */
  callTool(name: string, toolArgs?: Record<string, unknown>): Promise<unknown>;

  /** 列出工具 */
  listTools(): Promise<_MCPToolDefinition[]>;

  /** 列出资源 */
  listResources(): Promise<_MCPResourceDefinition[]>;

  /** 列出提示 */
  listPrompts(): Promise<_MCPPromptDefinition[]>;

  /** 获取服务器信息 */
  getServerInfo(): Promise<_MCPServerInfo>;

  /** 连接状态 */
  readonly state: _MCPClientState;

  /** 连接统计 */
  readonly stats: _MCPConnectionStats;

  /** 事件监听器 */
  on(event: _MCPEventType, listener: (event: _MCPEvent) => void): void;

  /** 移除事件监听器 */
  off(event: _MCPEventType, listener: (event: _MCPEvent) => void): void;
}

/**
 * MCP用户配置值（插件通道配置值）
 */
export type UserConfigValues = Record<string, string>;

/**
 * MCP用户配置模式（插件通道配置架构）
 */
export interface UserConfigSchema extends Record<string, unknown> {}
