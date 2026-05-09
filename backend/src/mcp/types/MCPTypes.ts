/**
 * MCP系统核心类型定义
 * 增强层类型，标准类型引用自 services/mcp/types/
 */

import {
  MCPServerConfig as _MCPServerConfig,
  ScopedMcpServerConfigExt as _ScopedMcpServerConfigExt,
} from '../../services/mcp/types/index.js';

export { _MCPServerConfig as MCPServerConfig };

export { _ScopedMcpServerConfigExt as ScopedMcpServerConfig };

export type { _ScopedMcpServerConfigExt as ScopedMcpServerConfigExt };

/**
 * MCP协议版本（基于CC源码）
 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * 配置作用域（基于CC源码）
 */
export type ConfigScope =
  | 'local'
  | 'user'
  | 'project'
  | 'dynamic'
  | 'enterprise'
  | 'claudeai';

/**
 * MCP服务器类型（基于CC源码）
 */
export type MCPServerType =
  | 'stdio'
  | 'sse'
  | 'http'
  | 'ws'
  | 'sse-ide'
  | 'ws-ide'
  | 'sdk'
  | 'claudeai-proxy';

/**
 * MCP工具定义（基于CC源码）
 */
export interface MCPToolDefinition {
  /** 工具名称 */
  name: string;

  /** 工具描述 */
  description: string;

  /** 输入参数schema */
  inputSchema: Record<string, any>;

  /** 输出参数schema */
  outputSchema?: Record<string, any>;

  /** 工具类型 */
  type?: string;

  /** 工具版本 */
  version?: string;
}

/**
 * MCP资源定义（基于CC源码）
 */
export interface MCPResourceDefinition {
  /** 资源ID */
  id: string;

  /** 资源名称 */
  name: string;

  /** 资源描述 */
  description?: string;

  /** 资源类型 */
  type: string;

  /** 资源URI */
  uri: string;

  /** 资源元数据 */
  metadata?: Record<string, any>;
}

/**
 * MCP提示定义（基于CC源码）
 */
export interface MCPPromptDefinition {
  /** 提示ID */
  id: string;

  /** 提示名称 */
  name: string;

  /** 提示描述 */
  description?: string;

  /** 提示内容 */
  content: string;

  /** 提示参数 */
  arguments?: Record<string, any>;
}

/**
 * MCP请求（基于CC源码）
 */
export interface MCPRequest {
  /** 请求ID */
  id: string;

  /** 请求类型 */
  type: 'call' | 'list_tools' | 'list_resources' | 'list_prompts' | 'ping';

  /** 工具名称（call类型） */
  tool_name?: string;

  /** 工具参数（call类型） */
  tool_arguments?: Record<string, any>;

  /** 工具参数简写（call类型） */
  args?: Record<string, any>;

  /** 资源URI（read_resource类型） */
  uri?: string;

  /** 提示ID（get_prompt类型） */
  prompt_id?: string;

  /** 提示参数（get_prompt类型） */
  prompt_arguments?: Record<string, any>;
}

/**
 * MCP响应（基于CC源码）
 */
export interface MCPResponse {
  /** 响应ID */
  id: string;

  /** 请求ID */
  request_id: string;

  /** 响应类型 */
  type: 'result' | 'error' | 'progress' | 'pong';

  /** 响应结果（result类型） */
  result?: any;

  /** 工具列表（list_tools响应） */
  tools?: MCPToolDefinition[];

  /** 错误信息（error类型） */
  error?: {
    code: string;
    message: string;
    data?: any;
  };

  /** 进度信息（progress类型） */
  progress?: {
    progress: number;
    total: number;
    message?: string;
  };
}

/**
 * MCP客户端状态（基于CC源码）
 */
export type MCPClientState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'ready'
  | 'error'
  | 'disconnecting';

/**
 * MCP客户端信息（基于CC源码）
 */
export interface MCPClientInfo {
  /** 客户端名称 */
  name: string;

  /** 客户端版本 */
  version: string;

  /** 客户端能力 */
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

/**
 * MCP服务器信息（基于CC源码）
 */
export interface MCPServerInfo {
  /** 服务器名称 */
  name: string;

  /** 服务器版本 */
  version: string;

  /** 服务器能力 */
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

/**
 * MCP连接配置（基于CC源码）
 */
export interface MCPConnectionConfig {
  /** 连接超时时间（毫秒） */
  timeout?: number;

  /** 最大重试次数 */
  maxRetries?: number;

  /** 重试间隔（毫秒） */
  retryInterval?: number;

  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number;

  /** 是否启用自动重连 */
  autoReconnect?: boolean;

  /** 是否启用调试模式 */
  debug?: boolean;
}

/**
 * MCP连接统计（基于CC源码）
 */
export interface MCPConnectionStats {
  /** 连接开始时间 */
  connectedAt: Date;

  /** 工具调用次数 */
  toolCalls: number;

  /** 资源读取次数 */
  resourceReads: number;

  /** 提示获取次数 */
  promptGets: number;

  /** 错误次数 */
  errors: number;

  /** 最后活动时间 */
  lastActivity: Date;

  /** 平均响应时间（毫秒） */
  averageResponseTime: number;
}

/**
 * MCP事件类型（基于CC源码）
 */
export type MCPEventType =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'tool_call'
  | 'resource_read'
  | 'prompt_get'
  | 'state_change';

/**
 * MCP事件（基于CC源码）
 */
export interface MCPEvent {
  /** 事件类型 */
  type: MCPEventType;

  /** 事件数据 */
  data?: any;

  /** 事件时间戳 */
  timestamp: Date;

  /** 服务器名称 */
  serverName: string;
}

/**
 * MCP传输层接口（基于CC源码）
 */
export interface MCPTransport {
  /** 连接服务器 */
  connect(): Promise<void>;

  /** 发送请求 */
  send(request: MCPRequest): Promise<MCPResponse>;

  /** 接收响应 */
  receive(): AsyncIterable<MCPResponse>;

  /** 关闭连接 */
  close(): Promise<void>;

  /** 连接状态 */
  readonly state: MCPClientState;

  /** 服务器名称 */
  readonly name?: string;

  /** 事件监听 */
  on(event: string, listener: (...args: any[]) => void): void;
}

/**
 * MCP服务器状态枚举
 */
export enum MCPServerStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

/**
 * MCP服务器连接信息
 */
export interface MCPServerConnectionInfo {
  name: string;
  config: _MCPServerConfig;
  status: MCPServerStatus;
  tools: MCPToolDefinition[];
  error?: string;
  stats?: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    lastRequestTime: number;
    responseTime: number;
  };
}

/**
 * MCP客户端接口（基于CC源码）
 */
export interface MCPClient {
  /** 连接服务器 */
  connect(): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 调用工具 */
  callTool(name: string, toolArgs?: Record<string, any>): Promise<any>;

  /** 列出工具 */
  listTools(): Promise<MCPToolDefinition[]>;

  /** 列出资源 */
  listResources(): Promise<MCPResourceDefinition[]>;

  /** 列出提示 */
  listPrompts(): Promise<MCPPromptDefinition[]>;

  /** 获取服务器信息 */
  getServerInfo(): Promise<MCPServerInfo>;

  /** 连接状态 */
  readonly state: MCPClientState;

  /** 连接统计 */
  readonly stats: MCPConnectionStats;

  /** 事件监听器 */
  on(event: MCPEventType, listener: (event: MCPEvent) => void): void;

  /** 移除事件监听器 */
  off(event: MCPEventType, listener: (event: MCPEvent) => void): void;
}

/**
 * MCP用户配置值（插件通道配置值）
 */
export type UserConfigValues = Record<string, string>;

/**
 * MCP用户配置模式（插件通道配置架构）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UserConfigSchema extends Record<string, unknown> {}
