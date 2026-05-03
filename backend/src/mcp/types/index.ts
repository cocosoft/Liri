/**
 * MCP系统类型定义
 */

/**
 * MCP服务器配置
 */
export interface MCPServerConfig {
  /** 服务器类型 */
  type?:
    | 'stdio'
    | 'sse'
    | 'http'
    | 'ws'
    | 'sse-ide'
    | 'ws-ide'
    | 'sdk'
    | 'claudeai-proxy';
  /** 命令路径（stdio类型） */
  command?: string;
  /** 命令参数（stdio类型） */
  args?: string[];
  /** 环境变量（stdio类型） */
  env?: Record<string, string>;
  /** URL（sse、http、ws类型） */
  url?: string;
  /** 头部信息（sse、http、ws类型） */
  headers?: Record<string, string>;
  /** 作用域 */
  scope?: 'dynamic' | 'static';
  /** 插件来源 */
  pluginSource?: string;
}

/**
 * 带作用域的MCP服务器配置
 */
export interface ScopedMcpServerConfig extends MCPServerConfig {
  /** 作用域 */
  scope: 'dynamic' | 'static';
  /** 插件来源 */
  pluginSource: string;
}

/**
 * MCP工具定义
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
 * MCP请求
 */
export interface MCPRequest {
  /** 请求ID */
  id: string;
  /** 请求类型 */
  type: 'call' | 'list_tools' | 'ping';
  /** 工具名称（call类型） */
  tool_name?: string;
  /** 工具参数（call类型） */
  args?: Record<string, any>;
  /** 会话ID */
  session_id?: string;
}

/**
 * MCP响应
 */
export interface MCPResponse {
  /** 响应ID（与请求ID对应） */
  id: string;
  /** 响应类型 */
  type: 'result' | 'error' | 'pong';
  /** 结果数据（result类型） */
  result?: any;
  /** 错误信息（error类型） */
  error?: {
    /** 错误代码 */
    code: string;
    /** 错误消息 */
    message: string;
  };
  /** 工具列表（list_tools响应） */
  tools?: MCPToolDefinition[];
}

/**
 * MCP传输层接口
 */
export interface MCPTransport {
  /** 发送请求 */
  send(request: MCPRequest): Promise<MCPResponse>;
  /** 连接 */
  connect(): Promise<void>;
  /** 断开连接 */
  disconnect(): void;
  /** 检查连接状态 */
  isConnected(): boolean;
}

/**
 * MCP服务器连接状态
 */
export enum MCPServerStatus {
  /** 未连接 */
  DISCONNECTED = 'disconnected',
  /** 连接中 */
  CONNECTING = 'connecting',
  /** 已连接 */
  CONNECTED = 'connected',
  /** 错误 */
  ERROR = 'error',
}

/**
 * MCP服务器连接信息
 */
export interface MCPServerConnectionInfo {
  /** 服务器名称 */
  name: string;
  /** 服务器配置 */
  config: MCPServerConfig;
  /** 服务器状态 */
  status: MCPServerStatus;
  /** 可用工具 */
  tools: MCPToolDefinition[];
  /** 错误信息 */
  error?: string;
}

/**
 * MCP插件配置
 */
export interface MCPPluginConfig {
  /** MCP服务器配置 */
  mcpServers?: string | MCPToolDefinition[] | Record<string, MCPServerConfig>;
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
  mcpConfig: MCPServerConfig;
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
  /** 用户配置schema */
  userConfigSchema: Record<string, any>;
}

/**
 * MCPB加载结果类型
 */
export type McpbLoadResultType = McpbLoadResult | McpbNeedsConfigResult;

/**
 * 用户配置值
 */
export type UserConfigValues = Record<string, string | number | boolean | null>;

/**
 * 用户配置schema
 */
export type UserConfigSchema = Record<
  string,
  {
    /** 类型 */
    type: 'string' | 'number' | 'boolean' | 'password';
    /** 描述 */
    description?: string;
    /** 是否必填 */
    required?: boolean;
    /** 默认值 */
    default?: string | number | boolean;
    /** 选项 */
    options?: string[];
  }
>;

export interface ServerResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}
