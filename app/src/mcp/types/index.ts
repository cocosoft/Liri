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
 * MCP系统类型定义（增强层）
 * 标准类型引用自 services/mcp/types/，增强层特有类型定义在本文件
 */

import {
  MCPToolDefinition as _MCPToolDefinition,
  MCPServerConfig as _MCPServerConfig,
} from './MCPTypes.js';

import { ServerResource as _ServerResource } from '../../services/mcp/types/index.js';

export { MCP_PROTOCOL_VERSION, MCPServerStatus } from './MCPTypes.js';

export type {
  ConfigScope,
  MCPServerType,
  MCPServerConfig,
  ScopedMcpServerConfigExt as ScopedMcpServerConfig,
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
  mcpServers?: string | _MCPToolDefinition[] | Record<string, _MCPServerConfig>;
  /** 用户配置 */
  userConfig?: Record<string, unknown>;
  /** 通道配置 */
  channels?: {
    /** 服务器名称 */
    server: string;
    /** 显示名称 */
    displayName?: string;
    /** 用户配置schema */
    userConfig?: Record<string, unknown>;
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
