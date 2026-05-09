/**
 * MCP系统类型定义
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  Resource,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

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
