/**
 * MCP系统类型定义（标准层）
 * 包含标准MCP类型和增强层所需的公共类型
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  Resource,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// MCP协议版本
export const MCP_PROTOCOL_VERSION = '2024-11-05';

// 配置作用域
export const ConfigScopeSchema = z.enum([
  'local',
  'user',
  'project',
  'dynamic',
  'enterprise',
  'claudeai',
  'managed',
]);
export type ConfigScope = z.infer<typeof ConfigScopeSchema>;

// 传输层类型
export const TransportSchema = z.enum([
  'stdio',
  'sse',
  'sse-ide',
  'http',
  'ws',
  'sdk',
]);
export type Transport = z.infer<typeof TransportSchema>;

// MCP服务器类型
export type MCPServerType =
  | 'stdio'
  | 'sse'
  | 'http'
  | 'ws'
  | 'sse-ide'
  | 'ws-ide'
  | 'sdk'
  | 'claudeai-proxy';

// MCP服务器状态枚举
export enum MCPServerStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

// MCP客户端状态
export type MCPClientState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'ready'
  | 'error'
  | 'disconnecting';

// MCP事件类型
export type MCPEventType =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'tool_call'
  | 'resource_read'
  | 'prompt_get'
  | 'state_change';

// MCP连接配置
export interface MCPConnectionConfig {
  timeout?: number;
  maxRetries?: number;
  retryInterval?: number;
  heartbeatInterval?: number;
  autoReconnect?: boolean;
  debug?: boolean;
}

// MCP连接统计
export interface MCPConnectionStats {
  connectedAt: Date;
  toolCalls: number;
  resourceReads: number;
  promptGets: number;
  errors: number;
  lastActivity: Date;
  averageResponseTime: number;
}

// MCP工具定义
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  type?: string;
  version?: string;
}

// MCP资源定义
export interface MCPResourceDefinition {
  id: string;
  name: string;
  description?: string;
  type: string;
  uri: string;
  metadata?: Record<string, unknown>;
}

// MCP提示定义
export interface MCPPromptDefinition {
  id: string;
  name: string;
  description?: string;
  content: string;
  arguments?: Record<string, unknown>;
}

// MCP请求
export interface MCPRequest {
  id: string;
  type: 'call' | 'list_tools' | 'list_resources' | 'list_prompts' | 'ping';
  tool_name?: string;
  tool_arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  uri?: string;
  prompt_id?: string;
  prompt_arguments?: Record<string, unknown>;
}

// MCP响应
export interface MCPResponse {
  id: string;
  request_id: string;
  type: 'result' | 'error' | 'progress' | 'pong';
  result?: unknown;
  tools?: MCPToolDefinition[];
  error?: {
    code: string;
    message: string;
    data?: unknown;
  };
  progress?: {
    progress: number;
    total: number;
    message?: string;
  };
}

// MCP客户端信息
export interface MCPClientInfo {
  name: string;
  version: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

// MCP服务器信息
export interface MCPServerInfo {
  name: string;
  version: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

// MCP事件
export interface MCPEvent {
  type: MCPEventType;
  data?: unknown;
  timestamp: Date;
  serverName: string;
}

// MCP传输层接口
export interface MCPTransport {
  connect(): Promise<void>;
  send(request: MCPRequest): Promise<MCPResponse>;
  receive(): AsyncIterable<MCPResponse>;
  close(): Promise<void>;
  readonly state: MCPClientState;
  readonly name?: string;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

// MCP服务器连接信息
export interface MCPServerConnectionInfo {
  name: string;
  config: McpServerConfig | MCPServerConfig;
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

// Stdio服务器配置
export const McpStdioServerConfigSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1, 'Command cannot be empty'),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfigSchema>;

// OAuth配置
const McpOAuthConfigSchema = z.object({
  clientId: z.string().optional(),
  callbackPort: z.number().int().positive().optional(),
  authServerMetadataUrl: z
    .string()
    .url()
    .startsWith('https://', {
      message: 'authServerMetadataUrl must use https://',
    })
    .optional(),
  xaa: z.boolean().optional(),
});

// SSE服务器配置
export const McpSSEServerConfigSchema = z.object({
  type: z.literal('sse'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  headersHelper: z.string().optional(),
  oauth: McpOAuthConfigSchema.optional(),
});

export type McpSSEServerConfig = z.infer<typeof McpSSEServerConfigSchema>;

// HTTP服务器配置
export const McpHTTPServerConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  headersHelper: z.string().optional(),
  oauth: McpOAuthConfigSchema.optional(),
});

export type McpHTTPServerConfig = z.infer<typeof McpHTTPServerConfigSchema>;

// WebSocket服务器配置
export const McpWebSocketServerConfigSchema = z.object({
  type: z.literal('ws'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  headersHelper: z.string().optional(),
});

export type McpWebSocketServerConfig = z.infer<
  typeof McpWebSocketServerConfigSchema
>;

// SDK服务器配置
export const McpSdkServerConfigSchema = z.object({
  type: z.literal('sdk'),
  name: z.string(),
});

export type McpSdkServerConfig = z.infer<typeof McpSdkServerConfigSchema>;

// Claude AI代理服务器配置
export const McpClaudeAIProxyServerConfigSchema = z.object({
  type: z.literal('claudeai-proxy'),
  url: z.string(),
  id: z.string(),
});

export type McpClaudeAIProxyServerConfig = z.infer<
  typeof McpClaudeAIProxyServerConfigSchema
>;

// 服务器配置联合类型
export const McpServerConfigSchema = z.union([
  McpStdioServerConfigSchema,
  McpSSEServerConfigSchema,
  McpHTTPServerConfigSchema,
  McpWebSocketServerConfigSchema,
  McpSdkServerConfigSchema,
  McpClaudeAIProxyServerConfigSchema,
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// 带作用域的服务器配置
export type ScopedMcpServerConfig = McpServerConfig & {
  scope: ConfigScope;
  pluginSource?: string;
};

// MCP JSON配置
export const McpJsonConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema),
});

export type McpJsonConfig = z.infer<typeof McpJsonConfigSchema>;

// 服务器连接类型
export type ConnectedMCPServer = {
  client: Client;
  name: string;
  type: 'connected';
  capabilities: ServerCapabilities;
  serverInfo?: {
    name: string;
    version: string;
  };
  instructions?: string;
  config: ScopedMcpServerConfig;
  cleanup: () => Promise<void>;
};

export type FailedMCPServer = {
  name: string;
  type: 'failed';
  config: ScopedMcpServerConfig;
  error?: string;
};

export type NeedsAuthMCPServer = {
  name: string;
  type: 'needs-auth';
  config: ScopedMcpServerConfig;
};

export type PendingMCPServer = {
  name: string;
  type: 'pending';
  config: ScopedMcpServerConfig;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
};

export type DisabledMCPServer = {
  name: string;
  type: 'disabled';
  config: ScopedMcpServerConfig;
};

export type MCPServerConnection =
  | ConnectedMCPServer
  | FailedMCPServer
  | NeedsAuthMCPServer
  | PendingMCPServer
  | DisabledMCPServer;

// 资源类型
export type ServerResource = Resource & { server: string };

// MCP CLI状态类型
export interface SerializedTool {
  name: string;
  description: string;
  inputJSONSchema?: {
    [x: string]: unknown;
    type: 'object';
    properties?: {
      [x: string]: unknown;
    };
  };
  isMcp?: boolean;
  originalToolName?: string;
}

export interface SerializedClient {
  name: string;
  type: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  capabilities?: ServerCapabilities;
}

export interface MCPCliState {
  clients: SerializedClient[];
  configs: Record<string, ScopedMcpServerConfig>;
  tools: SerializedTool[];
  resources: Record<string, ServerResource[]>;
  normalizedNames?: Record<string, string>;
}

// ==================== 增强层公共类型（原 mcp/types/） ====================

/**
 * MCP服务器配置（增强层通用接口）
 */
export interface MCPServerConfig {
  type?:
    | 'stdio'
    | 'sse'
    | 'http'
    | 'ws'
    | 'sse-ide'
    | 'ws-ide'
    | 'sdk'
    | 'claudeai-proxy';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  oauth?: McpOAuthConfig;
  scope?: ConfigScope;
  pluginSource?: string;
  enabled?: boolean;
  description?: string;
  version?: string;
}

/**
 * 带作用域的MCP服务器配置（增强层通用接口）
 */
export interface ScopedMcpServerConfigExt extends MCPServerConfig {
  scope: ConfigScope;
  pluginSource?: string;
}

/**
 * OAuth配置
 */
export interface McpOAuthConfig {
  clientId?: string;
  callbackPort?: number;
  authServerMetadataUrl?: string;
  xaa?: boolean;
}
