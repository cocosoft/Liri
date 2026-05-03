// @ts-nocheck
/**
 * MCP 服务器入口点
 * 实现 Model Context Protocol 服务器功能
 */

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { findToolByName } from '../tools/types/Tool';
import { getEmptyToolPermissionContext } from '../tools/types/PermissionContext';
import { ToolUseContext } from '../tools/types/ToolUseContext';
import { createToolManager } from '../tools/ToolManager';
import { createAbortController } from '../utils/abortController';
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache';
import { logger } from '../utils/log';
import { createAssistantMessage } from '../utils/messages';
import { getMainLoopModel } from '../utils/model/model';
import { hasPermissionsToUseTool } from '../permissions/permissions';
import { jsonStringify } from '../utils/slowOperations';
import { getErrorParts } from '../utils/toolErrors';
import { zodToJsonSchema } from '../utils/zodToJsonSchema';
import { getDefaultAppState } from '../state/AppStateStore';
import review from '../commands/builtin/review';
import type { Command } from '../commands/types/index';
import { profileCheckpoint } from '../utils/startupProfiler';

// 定义MCP命令列表
const MCP_COMMANDS: Command[] = [review];

/**
 * 启动MCP服务器
 * @param cwd 工作目录
 * @param debug 是否开启调试模式
 * @param verbose 是否开启详细输出
 */
export async function startMCPServer(
  cwd: string,
  debug: boolean = false,
  verbose: boolean = false
): Promise<void> {
  profileCheckpoint('mcp_start_server_start');

  // 使用大小受限的LRU缓存来防止内存无限增长
  // 100个文件和25MB限制应该足够MCP服务器操作
  const READ_FILE_STATE_CACHE_SIZE = 100;
  const readFileStateCache = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE
  );

  // 设置工作目录
  process.chdir(cwd);

  // 创建工具管理器（只创建一次，避免重复初始化）
  const toolManager = createToolManager();

  // 创建MCP服务器实例
  const server = new McpServer(
    {
      name: 'PY_APP/mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 设置ListTools请求处理器
  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => {
      try {
        profileCheckpoint('mcp_list_tools_start');
        const toolPermissionContext = getEmptyToolPermissionContext();
        const tools = toolManager.getAllTools();

        return {
          tools: await Promise.all(
            tools.map(async (tool) => {
              let outputSchema: any;
              if (tool.outputSchema) {
                const convertedSchema = zodToJsonSchema(
                  tool.outputSchema as any
                );
                // MCP SDK要求outputSchema在根级别有type: "object"
                // 跳过根级别有anyOf/oneOf的模式（来自z.union, z.discriminatedUnion等）
                if (
                  typeof convertedSchema === 'object' &&
                  convertedSchema !== null &&
                  'type' in convertedSchema &&
                  convertedSchema.type === 'object'
                ) {
                  outputSchema = convertedSchema;
                }
              }
              return {
                name: tool.name,
                description:
                  (await tool.getDescription?.(
                    (tool.inputSchema as any) || {},
                    {
                      isNonInteractiveSession: true,
                      toolPermissionContext,
                    }
                  )) || tool.description,
                inputSchema: zodToJsonSchema(tool.inputSchema as any) as any,
                outputSchema,
              };
            })
          ),
        };
      } catch (error) {
        logger.error('Error in ListTools handler:', error);
        return {
          tools: [],
        };
      } finally {
        profileCheckpoint('mcp_list_tools_end');
      }
    }
  );

  // 设置CallTool请求处理器
  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
      profileCheckpoint('mcp_call_tool_start');
      const toolPermissionContext = getEmptyToolPermissionContext();
      const tools = toolManager.getAllTools();
      const tool = findToolByName(tools, name);

      if (!tool) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Tool ${name} not found`,
            },
          ],
        };
      }

      // 假设MCP服务器不会从工具调用参数中单独读取消息
      const toolUseContext: ToolUseContext = {
        abortController: createAbortController(),
        options: {
          commands: MCP_COMMANDS,
          tools,
          mainLoopModel: getMainLoopModel(),
          thinkingConfig: { type: 'disabled' },
          mcpClients: [],
          mcpResources: {},
          isNonInteractiveSession: true,
          debug,
          verbose,
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
        if (!tool?.isEnabled()) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Tool ${name} is not enabled`,
              },
            ],
          };
        }

        // 验证输入类型
        const validationResult = tool?.validateInput?.(args);
        if (validationResult && !validationResult.result) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Tool ${name} input is invalid: ${validationResult.message}`,
              },
            ],
          };
        }

        // 调用工具
        const finalResult = await tool?.call?.(args, toolUseContext);

        return {
          content: [
            {
              type: 'text',
              text:
                typeof finalResult === 'string'
                  ? finalResult
                  : jsonStringify(finalResult?.data),
            },
          ],
        };
      } catch (error) {
        logger.error(`Error executing tool ${name}:`, error);

        const parts =
          error instanceof Error ? getErrorParts(error) : [String(error)];
        const errorText = parts.filter(Boolean).join('\n').trim() || 'Error';

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: errorText,
            },
          ],
        };
      } finally {
        profileCheckpoint('mcp_call_tool_end');
      }
    }
  );

  /**
   * 运行MCP服务器
   */
  async function runServer() {
    profileCheckpoint('mcp_run_server_start');
    const transport = new StdioServerTransport();

    // 处理服务器关闭
    let exiting = false;
    const shutdownAndExit = async (): Promise<void> => {
      if (exiting) return;
      exiting = true;
      logger.info('MCP server shutting down...');
      // 这里可以添加清理代码，比如关闭分析服务等
      process.exit(0);
    };

    // 监听标准输入关闭事件
    process.stdin.on('end', () => void shutdownAndExit());
    process.stdin.on('error', () => void shutdownAndExit());

    // 监听进程信号
    process.on('SIGINT', () => void shutdownAndExit());
    process.on('SIGTERM', () => void shutdownAndExit());

    logger.info('Starting MCP server...');
    if (debug) {
      logger.debug('MCP server starting with debug mode');
    }

    try {
      await server.connect(transport);
      logger.info('MCP server started successfully');
      profileCheckpoint('mcp_run_server_end');
    } catch (error) {
      logger.error('Failed to start MCP server:', error);
      process.exit(1);
    }
  }

  const result = await runServer();
  profileCheckpoint('mcp_start_server_end');
  return result;
}
