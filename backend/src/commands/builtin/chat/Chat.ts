/**
 * Chat命令
 * 与LLM进行对话
 * 集成成本跟踪和多供应商模型支持
 */
import type { CommandContext } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { modelManager } from '@modules/ai/models/ModelManager.js';
import { providerRegistry } from '@modules/ai/providers/ProviderRegistry.js';
import { ToolAwareClient } from '@modules/ai/clients/ToolAwareClient.js';
import { costTracker } from '@modules/cost/CostTracker.js';
import { getConfig } from '@modules/config/index.js';
import { ToolRegistry } from '@modules/tools/index.js';
import { FileReadTool } from '@modules/tools/FileReadTool/FileReadTool.js';
import { FileWriteTool } from '@modules/tools/FileWriteTool/FileWriteTool.js';
import { FileEditTool } from '@modules/tools/FileEditTool/FileEditTool.js';
import { BashTool } from '@modules/tools/bash/BashTool.js';
import { createPowerShellTool } from '@modules/tools/PowerShellTool/PowerShellTool.js';
import { GlobTool } from '@modules/tools/search/GlobTool.js';
import { GrepTool } from '@modules/tools/search/GrepTool.js';
import { createWebSearchTool } from '@modules/tools/WebSearchTool/WebSearchTool.js';
import { createWebFetchTool } from '@modules/tools/WebFetchTool/WebFetchTool.js';
import { TimeTool } from '@modules/tools/TimeTool/TimeTool.js';
import { ToolExecutor } from '@modules/tools/ToolExecutor.js';

const logger = new Logger({ level: LogLevel.INFO });

interface ChatResult {
  type: 'text';
  value: string;
}

interface ChatOptions {
  stream?: boolean;
  sessionId?: string;
  model?: string;
  showCost?: boolean;
  provider?: string;
}

function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerTool(new FileReadTool());
  registry.registerTool(new FileWriteTool());
  registry.registerTool(new FileEditTool());
  registry.registerTool(new BashTool());

  const powerShellTool = createPowerShellTool();
  if (powerShellTool) {
    registry.registerTool(powerShellTool as any);
  }

  registry.registerTool(new GlobTool());
  registry.registerTool(new GrepTool());

  const webSearchTool = createWebSearchTool();
  if (webSearchTool) {
    registry.registerTool(webSearchTool as any);
  }

  const webFetchTool = createWebFetchTool();
  if (webFetchTool) {
    registry.registerTool(webFetchTool as any);
  }

  registry.registerTool(TimeTool.create());

  return registry;
}

function formatCost(amount: number): string {
  return '$' + amount.toFixed(4);
}

export class ChatCommand {
  private chatManager: any = null;
  private llmClient: any = null;
  private toolRegistry: ToolRegistry | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private currentSessionId: string | null = null;

  private initializeServices(options?: ChatOptions): void {
    // 根据选项选择客户端
    if (options?.provider) {
      try {
        this.llmClient = providerRegistry.getOrCreate(
          options.provider
        ) as unknown as ToolAwareClient;
      } catch (error) {
        logger.warning(
          `Failed to get client for provider ${options.provider}, using default`,
          { error }
        );
        this.llmClient =
          providerRegistry.getDefaultProvider() as unknown as ToolAwareClient;
      }
    } else if (!this.llmClient) {
      this.llmClient =
        providerRegistry.getDefaultProvider() as unknown as ToolAwareClient;
    }

    if (!this.toolRegistry || !this.toolExecutor) {
      this.toolRegistry = createToolRegistry();
      this.toolExecutor = new ToolExecutor();
      this.llmClient.setToolExecutor(this.toolExecutor);
      this.llmClient.setToolRegistry(this.toolRegistry);
    }
  }

  private parseArgs(args: string): { message: string; options: ChatOptions } {
    const trimmedArgs = args.trim();
    const options: ChatOptions = {
      stream: false,
      showCost: false,
    };

    let remainingArgs = trimmedArgs;

    if (remainingArgs.includes('--stream')) {
      options.stream = true;
      remainingArgs = remainingArgs.replace('--stream', '').trim();
    }

    if (remainingArgs.includes('--show-cost')) {
      options.showCost = true;
      remainingArgs = remainingArgs.replace('--show-cost', '').trim();
    }

    const modelMatch = remainingArgs.match(/--model=(\S+)/);
    if (modelMatch) {
      options.model = modelMatch[1];
      remainingArgs = remainingArgs.replace(modelMatch[0], '').trim();
    }

    const providerMatch = remainingArgs.match(/--provider=(\S+)/);
    if (providerMatch) {
      options.provider = providerMatch[1];
      remainingArgs = remainingArgs.replace(providerMatch[0], '').trim();
    }

    return {
      message: remainingArgs,
      options,
    };
  }

  async call(args: string, context: CommandContext): Promise<ChatResult> {
    const { message, options } = this.parseArgs(args);

    if (!message.trim()) {
      return this.showHelp();
    }

    try {
      this.initializeServices(options);

      if (!this.llmClient) {
        return {
          type: 'text',
          value: '错误: LLM客户端初始化失败，请检查API密钥配置',
        };
      }

      // 从配置获取默认模型
      const config = getConfig();
      const defaultModel = config.ai?.model || modelManager.getCurrentModel();
      const useModel = options.model || defaultModel;

      const chatMessages = [{ role: 'user' as const, content: message }];

      const startTime = Date.now();

      if (options.stream) {
        return await this.streamChat(chatMessages, useModel, options);
      } else {
        return await this.regularChat(chatMessages, useModel, options);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        type: 'text',
        value: `聊天错误: ${errorMsg}`,
      };
    }
  }

  private async regularChat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model: string,
    options: ChatOptions
  ): Promise<ChatResult> {
    const response = await this.llmClient.chat(messages, { model });

    // 从响应获取token使用情况
    const inputTokens =
      response.usage?.promptTokens || response.usage?.inputTokens || 0;
    const outputTokens =
      response.usage?.completionTokens || response.usage?.outputTokens || 0;
    const cacheReadTokens = response.usage?.cacheReadInputTokens || 0;
    const cacheCreationTokens = response.usage?.cacheCreationInputTokens || 0;

    // 添加成本记录
    const cost = costTracker.addCost(
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens
    );

    let resultValue =
      typeof response.content === 'string' ? response.content : '没有收到回复';

    if (options.showCost) {
      const costInfo = this.formatCostInfo(
        model,
        inputTokens,
        outputTokens,
        cost
      );
      resultValue += `\n\n${costInfo}`;
    }

    return {
      type: 'text',
      value: resultValue,
    };
  }

  private async streamChat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model: string,
    options: ChatOptions
  ): Promise<ChatResult> {
    let fullResponse = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const stream = this.llmClient.chatStream(messages, { model });

      for await (const chunk of stream) {
        fullResponse += chunk;
      }
    } catch (err) {}

    const cost = costTracker.addCost(model, inputTokens, outputTokens);

    let resultValue = fullResponse || '没有收到回复';

    if (options.showCost) {
      const costInfo = this.formatCostInfo(
        model,
        inputTokens,
        outputTokens,
        cost
      );
      resultValue += `\n\n${costInfo}`;
    }

    return {
      type: 'text',
      value: resultValue,
    };
  }

  private formatCostInfo(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cost: number
  ): string {
    const lines: string[] = [];
    lines.push('--- 成本统计 ---');
    lines.push(`模型: ${modelManager.getModelDisplayName(model) || model}`);
    lines.push(`输入token: ${inputTokens.toLocaleString()}`);
    lines.push(`输出token: ${outputTokens.toLocaleString()}`);
    lines.push(`本次花费: ${formatCost(cost)}`);
    lines.push(`会话总成本: ${formatCost(costTracker.getTotalCostUSD())}`);
    lines.push(
      `会话总输入: ${costTracker.getTotalInputTokens().toLocaleString()}`
    );
    lines.push(
      `会话总输出: ${costTracker.getTotalOutputTokens().toLocaleString()}`
    );
    return lines.join('\n');
  }

  private showHelp(): ChatResult {
    const config = getConfig();
    const currentProvider = config.ai?.provider || 'deepseek';
    const currentModel = config.ai?.model || modelManager.getCurrentModel();
    const availableModels = modelManager.getModelInfoList();

    let modelList = availableModels
      .map((m) => `  - ${m.id}: ${m.name} - ${m.description}`)
      .join('\n');

    // 获取配置的供应商状态
    const providers = [
      {
        name: 'DeepSeek',
        key: 'deepseek',
        configured:
          !!config.ai?.deepseek?.apiKey || !!process.env.DEEPSEEK_API_KEY,
      },
      {
        name: 'Anthropic',
        key: 'anthropic',
        configured:
          !!config.ai?.anthropic?.apiKey || !!process.env.ANTHROPIC_API_KEY,
      },
      {
        name: 'OpenAI',
        key: 'openai',
        configured: !!config.ai?.openai?.apiKey || !!process.env.OPENAI_API_KEY,
      },
      { name: 'Azure', key: 'azure', configured: !!config.ai?.azure?.apiKey },
      {
        name: 'Vertex',
        key: 'vertex',
        configured: !!config.ai?.vertex?.projectId,
      },
    ];

    const providerStatus = providers
      .map((p) => `  ${p.name}: ${p.configured ? '✓ 已配置' : '✗ 未配置'}`)
      .join('\n');

    return {
      type: 'text',
      value: `用法: /chat <消息内容> [选项]

与LLM进行对话。

选项:
  --stream          使用流式输出
  --model=<model>   使用指定模型
  --show-cost      显示成本统计
  --provider=<p>   使用指定供应商 (deepseek/anthropic/openai/azure/vertex)

当前供应商: ${currentProvider}
当前模型: ${modelManager.getModelDisplayName(currentModel) || currentModel}

供应商状态:
${providerStatus}

可用模型:
${modelList}

示例:
  /chat 你好
  /chat --show-cost 帮我写一段Python代码
  /chat --stream --model=deepseek-reasoner 请给我写一个算法
  /chat --provider=anthropic --model=claude-3-5-sonnet-20241022 你好

注意: 需要配置相应的API密钥才能使用此命令。
使用 /cost 查看总花费
使用 /model 切换模型`,
    };
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }
}

export default new ChatCommand();
