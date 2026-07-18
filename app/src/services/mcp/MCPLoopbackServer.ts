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
 * 本地 HTTP 环回 MCP 服务器。
 * 为嵌入式运行时 / Gateway 提供轻量 MCP 工具访问，无需 stdio 通信。
 * 对标: openclaw gateway/mcp-http.ts
 *
 * 协议: JSON-RPC 2.0 over HTTP POST
 * 端点: POST /mcp  — 接收 initialize / tools/list / tools/call 请求
 */

import http from 'http';
import { Logger, LogLevel } from '@modules/monitoring';
import { findToolByName } from '../../tools/types/Tool.js';
import { getEmptyToolPermissionContext } from '../../tools/types/PermissionContext.js';
import { ToolUseContext } from '../../tools/types/ToolUseContext.js';
import { createToolManager } from '../../tools/ToolManager.js';
import { createAbortController } from '../../utils/abortController.js';
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js';
import { modelManager } from '@modules/ai';
import { jsonStringify } from '../../utils/slowOperations.js';
import { getErrorParts } from '../../utils/toolErrors.js';
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js';
import { getDefaultAppState } from '../../system/state/AppState.js';

// ════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════

const logger = new Logger({ module: 'mcp:loopback' });

/** JSON-RPC 2.0 请求 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 响应 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** MCP Server 能力声明 */
interface ServerCapabilities {
  tools?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
}

/** 服务端信息 */
interface Implementation {
  name: string;
  version: string;
}

/** 初始化结果 */
interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: Implementation;
}

// ════════════════════════════════════════════════════════════════
// MCPLoopbackServer
// ════════════════════════════════════════════════════════════════

export class MCPLoopbackServer {
  private server: http.Server | null = null;
  private port = 0;
  private started = false;
  private readonly capabilities: ServerCapabilities;

  constructor(private readonly options: MCPLoopbackOptions = {}) {
    this.capabilities = {
      tools: {},
      ...(options.enableResources ? { resources: {} } : {}),
      ...(options.enablePrompts ? { prompts: {} } : {}),
    };
  }

  /**
   * 启动 HTTP 服务器
   * @param preferredPort 首选端口（0 = 随机）
   */
  async start(preferredPort = 0): Promise<{ port: number }> {
    if (this.started) {
      return { port: this.port };
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        logger.error('Loopback server error', { error: String(err) });
        reject(err);
      });

      this.server.listen(preferredPort, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        this.started = true;
        logger.info(
          `MCP Loopback server started on http://127.0.0.1:${this.port}`
        );
        resolve({ port: this.port });
      });
    });
  }

  /**
   * 关闭服务器
   */
  async close(): Promise<void> {
    if (!this.server || !this.started) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.started = false;
        logger.info('MCP Loopback server stopped');
        resolve();
      });
    });
  }

  /**
   * 获取监听端口
   */
  getPort(): number {
    return this.port;
  }

  // ════════════════════════════════════════════════════════
  // 请求处理
  // ════════════════════════════════════════════════════════

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // 仅处理 POST /mcp
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // 读取请求体
    const body = await this.readBody(req);

    try {
      const request: JsonRpcRequest = JSON.parse(body);

      if (request.jsonrpc !== '2.0') {
        this.sendError(
          res,
          request.id ?? null,
          -32600,
          'Invalid Request: jsonrpc must be "2.0"'
        );
        return;
      }

      const result = await this.dispatch(request);
      this.sendResponse(res, { jsonrpc: '2.0', id: request.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(res, null, -32700, `Parse error: ${message}`);
    }
  }

  /**
   * 分发 JSON-RPC 方法
   */
  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request.params);

      case 'tools/list':
        return this.handleListTools();

      case 'tools/call':
        return this.handleCallTool(request.params);

      case 'notifications/initialized':
        return {};

      default:
        throw new Error(`Method not found: ${request.method}`);
    }
  }

  // ════════════════════════════════════════════════════════
  // initialize
  // ════════════════════════════════════════════════════════

  private handleInitialize(params?: Record<string, unknown>): InitializeResult {
    const clientInfo = params?.clientInfo as Implementation | undefined;
    logger.info('MCP Loopback client initialized', {
      clientName: clientInfo?.name,
      clientVersion: clientInfo?.version,
    });

    return {
      protocolVersion: '2025-03-26',
      capabilities: this.capabilities,
      serverInfo: {
        name: this.options.name || 'pyapp-loopback',
        version: this.options.version || '1.0.0',
      },
    };
  }

  // ════════════════════════════════════════════════════════
  // tools/list
  // ════════════════════════════════════════════════════════

  private async handleListTools(): Promise<{
    tools: Array<Record<string, unknown>>;
  }> {
    const toolPermissionContext = getEmptyToolPermissionContext();
    const toolManager = createToolManager();
    const tools = toolManager.getAllTools();

    const listed = await Promise.all(
      tools.map(async (tool) => {
        let outputSchema: unknown;
        if (tool.outputSchema) {
          const converted = zodToJsonSchema(tool.outputSchema as any);
          if (
            typeof converted === 'object' &&
            converted !== null &&
            'type' in converted &&
            (converted as Record<string, unknown>).type === 'object'
          ) {
            outputSchema = converted;
          }
        }

        return {
          name: tool.name,
          description:
            (await tool.getDescription?.(
              (tool.inputSchema as Record<string, unknown>) || {},
              { isNonInteractiveSession: true, toolPermissionContext }
            )) || tool.description,
          inputSchema: zodToJsonSchema(tool.inputSchema as any),
          outputSchema,
        };
      })
    );

    return { tools: listed };
  }

  // ════════════════════════════════════════════════════════
  // tools/call
  // ════════════════════════════════════════════════════════

  private async handleCallTool(params?: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) || {};

    if (!name) {
      return {
        content: [{ type: 'text', text: 'Missing tool name' }],
        isError: true,
      };
    }

    // 复用 entrypoints/mcp.ts 的工具执行管线
    const toolPermissionContext = getEmptyToolPermissionContext();
    const READ_FILE_STATE_CACHE_SIZE = 100;
    const readFileStateCache = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE
    );

    // 创建工具管理器
    const toolManager = createToolManager();
    const allTools = toolManager.getAllTools();
    const tool = findToolByName(allTools, name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool ${name} not found` }],
        isError: true,
      };
    }

    if (!tool.isEnabled()) {
      return {
        content: [{ type: 'text', text: `Tool ${name} is not enabled` }],
        isError: true,
      };
    }

    const validationResult = tool.validateInput?.(args);
    if (validationResult && !validationResult.result) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool ${name} input is invalid: ${validationResult.message}`,
          },
        ],
        isError: true,
      };
    }

    const toolUseContext: ToolUseContext = {
      abortController: createAbortController(),
      options: {
        commands: [],
        tools: allTools,
        mainLoopModel: modelManager?.getDefaultMainLoopModel?.() || '',
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        debug: this.options.debug || false,
        verbose: this.options.verbose || false,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      getAppState: () => getDefaultAppState(),
      setAppState: () => {},
      messages: [],
      readFileState: readFileStateCache,
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    };

    try {
      const finalResult = await tool?.call?.(args, toolUseContext);

      return {
        content: [
          {
            type: 'text',
            text:
              typeof finalResult === 'string'
                ? finalResult
                : jsonStringify((finalResult as { data?: unknown })?.data),
          },
        ],
      };
    } catch (error) {
      const parts =
        error instanceof Error ? getErrorParts(error) : [String(error)];
      const errorText = parts.filter(Boolean).join('\n').trim() || 'Error';

      return {
        content: [{ type: 'text', text: errorText }],
        isError: true,
      };
    }
  }

  // ════════════════════════════════════════════════════════
  // HTTP 工具
  // ════════════════════════════════════════════════════════

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private sendResponse(res: http.ServerResponse, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  private sendError(
    res: http.ServerResponse,
    id: number | string | null,
    code: number,
    message: string
  ): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: id ?? 0,
      error: { code, message },
    };
    const json = JSON.stringify(response);
    res.writeHead(code === -32700 ? 400 : 200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }
}

// ════════════════════════════════════════════════════════════════
// 配置
// ════════════════════════════════════════════════════════════════

export interface MCPLoopbackOptions {
  name?: string;
  version?: string;
  enableResources?: boolean;
  enablePrompts?: boolean;
  debug?: boolean;
  verbose?: boolean;
}

// ════════════════════════════════════════════════════════════════
// 单例
// ════════════════════════════════════════════════════════════════

let _instance: MCPLoopbackServer | null = null;

export function getMCPLoopbackServer(
  options?: MCPLoopbackOptions
): MCPLoopbackServer {
  if (!_instance) {
    _instance = new MCPLoopbackServer(options);
  }
  return _instance;
}
