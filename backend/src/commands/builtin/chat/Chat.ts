import { Command, CommandResult, CommandContext } from '../../types/index.js';
import { ChatManagerImpl } from '../../../chat/ChatManager.js';
import { DeepSeekClient } from '../../../ai/clients/DeepSeekClient.js';
import { ToolRegistry } from '../../../tools/index.js';
import { FileReadTool } from '../../../tools/FileReadTool/FileReadTool.js';
import { FileWriteTool } from '../../../tools/FileWriteTool/FileWriteTool.js';
import { FileEditTool } from '../../../tools/FileEditTool/FileEditTool.js';
import { BashTool } from '../../../tools/bash/BashTool.js';
import {
  PowerShellTool,
  createPowerShellTool,
} from '../../../tools/PowerShellTool/PowerShellTool.js';
import { GlobTool } from '../../../tools/search/GlobTool.js';
import { GrepTool } from '../../../tools/search/GrepTool.js';
import { createWebSearchTool } from '../../../tools/WebSearchTool/WebSearchTool.js';
import { createWebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js';
import { TimeTool } from '../../../tools/TimeTool/TimeTool.js';
import { ToolExecutor } from '../../../tools/ToolExecutor.js';
import {
  ToolUseContext,
  getEmptyToolUseContext,
} from '../../../tools/types/ToolUseContext.js';

/**
 * 创建工具注册表并注册所有工具
 */
function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.registerTool(FileReadTool.create());
  registry.registerTool(FileWriteTool.create());
  registry.registerTool(FileEditTool);

  // 创建 BashTool 实例
  const bashTool = new BashTool();
  registry.registerTool(bashTool);

  // 创建 PowerShellTool 实例
  const powerShellTool = createPowerShellTool();
  registry.registerTool(powerShellTool);

  // 注册 GlobTool
  const globTool = new GlobTool();
  registry.registerTool(globTool);

  // 注册 GrepTool
  const grepTool = new GrepTool();
  registry.registerTool(grepTool);

  // 创建 WebSearchTool 实例
  const webSearchTool = createWebSearchTool();
  registry.registerTool(webSearchTool);

  // 创建 WebFetchTool 实例
  const webFetchTool = createWebFetchTool();
  registry.registerTool(webFetchTool);

  // 创建 TimeTool 实例
  const timeTool = TimeTool.create();
  registry.registerTool(timeTool);

  return registry;
}

/**
 * 创建默认的工具执行上下文
 */
function createDefaultContext(): ToolUseContext {
  const ctx = getEmptyToolUseContext() as ToolUseContext;
  ctx.options = {
    ...ctx.options,
    commands: [],
    debug: false,
    mainLoopModel: '',
    tools: [],
    verbose: false,
    thinkingConfig: {},
    mcpClients: [],
    mcpResources: {},
    isNonInteractiveSession: false,
    agentDefinitions: {},
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  };
  return ctx;
}

/**
 * 聊天命令模块
 */
export const call = async (
  args: string,
  context: CommandContext
): Promise<CommandResult> => {
  if (!args) {
    return { type: 'text', value: '请输入要发送给LLM的消息' };
  }

  try {
    const chatManager = new ChatManagerImpl();
    const llmClient = new DeepSeekClient({
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
    });
    const toolRegistry = createToolRegistry();
    const toolExecutor = new ToolExecutor();

    // 设置工具执行器到 LLM 客户端
    llmClient.setToolExecutor(toolExecutor);
    llmClient.setToolRegistry(toolRegistry);

    chatManager.setLLMClient(llmClient);
    chatManager.setToolRegistry(toolRegistry);
    chatManager.setToolExecutor(toolExecutor);

    const session = chatManager.createSession({ title: 'Chat Session' });

    const message = await chatManager.sendMessage(args, {
      sessionId: session.id,
    });

    return {
      type: 'text',
      value:
        typeof message.content === 'string' ? message.content : '没有收到回复',
    };
  } catch (error) {
    return {
      type: 'text',
      value: `聊天错误: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * 聊天命令
 * 用于与LLM进行对话
 */
export const command: Command = {
  name: 'chat',
  description: '与LLM进行对话',
  aliases: ['c', 'talk'],
  type: 'local',
  load: () =>
    Promise.resolve({
      execute: async (args: string) => {
        return await call(args, {});
      },
    }),
};
