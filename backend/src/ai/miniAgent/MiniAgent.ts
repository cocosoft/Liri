// @ts-nocheck
/**
 * Mini Agent 核心类
 * 整合规则引擎、任务路由、命令执行、Ollama 调用
 */

import type { ChatMessage } from '../models/types.js';
import type { LLMClient } from '../clients/LLMClient.js';
import type {
  Intent,
  RouteDecision,
  MiniAgentConfig,
  MiniAgentResult,
  CommandMatch,
} from './types.js';
import { IRuleEngine, KeywordRuleEngine } from './KeywordRuleEngine.js';
import { TaskRouterImpl } from './TaskRouter.js';
import { OllamaProvider, createDefaultOllamaConfig } from './OllamaProvider.js';
import { LocalCommandExecutor } from './CommandExecutor.js';
import { SkillProvider } from './SkillProvider.js';
import { MCPProvider } from './MCPProvider.js';

export class MiniAgent {
  private ruleEngine: IRuleEngine;
  private taskRouter: TaskRouterImpl;
  private ollamaProvider: OllamaProvider;
  private commandExecutor: LocalCommandExecutor;
  private skillProvider: SkillProvider | null = null;
  private mcpProvider: MCPProvider | null = null;
  private llmClient: LLMClient | null = null;
  private config: MiniAgentConfig;

  constructor(config: MiniAgentConfig) {
    this.config = config;
    this.ruleEngine = new KeywordRuleEngine();
    this.taskRouter = new TaskRouterImpl(config.routing.strategy, config.routing.fallbackToCloud);
    this.ollamaProvider = new OllamaProvider(config.ollama || createDefaultOllamaConfig());
    this.commandExecutor = new LocalCommandExecutor();
  }

  setSkillProvider(provider: SkillProvider): void {
    this.skillProvider = provider;
  }

  setMCPProvider(provider: MCPProvider): void {
    this.mcpProvider = provider;
  }

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  async process(input: string, messages?: ChatMessage[]): Promise<MiniAgentResult> {
    const intent = this.ruleEngine.classify(input);
    const routeDecision = this.taskRouter.route(intent, { inputLength: input.length });

    switch (routeDecision.target) {
      case 'rule_engine':
        return this.handleRuleEngine(input, intent, routeDecision);
      case 'ollama':
        return this.handleOllama(input, intent, routeDecision, messages);
      case 'cloud':
        return this.handleCloud(input, intent, routeDecision, messages);
      default:
        return this.handleCloud(input, intent, routeDecision, messages);
    }
  }

  private async handleRuleEngine(
    input: string,
    intent: Intent,
    routeDecision: RouteDecision
  ): Promise<MiniAgentResult> {
    const handler = routeDecision.handler;

    if (handler === 'simple_qa') {
      return this.handleSimpleQA(input, intent);
    }

    if (handler === 'skill' && this.skillProvider) {
      return this.handleSkill(input, intent);
    }

    if (handler === 'mcp' && this.mcpProvider) {
      return this.handleMCP(input, intent);
    }

    const commandMatch = this.parseCommand(input, handler || 'execute');
    const commandResult = await this.commandExecutor.execute(commandMatch);

    return {
      response: commandResult,
      intent,
      routeDecision,
      source: 'rule_engine',
    };
  }

  private async handleMCP(input: string, intent: Intent): Promise<MiniAgentResult> {
    if (!this.mcpProvider) {
      return {
        response: 'MCP provider not available',
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'mcp',
          reason: 'MCP provider not initialized',
        },
        source: 'rule_engine',
      };
    }

    const toolName = this.mcpProvider.matchTool(input);
    if (!toolName) {
      return {
        response: 'No matching MCP tool found',
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'mcp',
          reason: 'No MCP tool match',
        },
        source: 'rule_engine',
      };
    }

    try {
      const result = await this.mcpProvider.callTool(toolName, {});

      return {
        response: result.success ? (result.output || 'MCP tool executed') : result.error || 'MCP tool failed',
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'mcp',
          reason: `MCP tool: ${toolName}`,
        },
        source: 'rule_engine',
      };
    } catch (error) {
      return {
        response: `MCP error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'mcp',
          reason: 'MCP execution failed',
        },
        source: 'rule_engine',
      };
    }
  }

  private async handleSkill(input: string, intent: Intent): Promise<MiniAgentResult> {
    if (!this.skillProvider) {
      return {
        response: 'Skill provider not available',
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'skill',
          reason: 'Skill provider not initialized',
        },
        source: 'rule_engine',
      };
    }

    const skillMatch = this.skillProvider.matchSkill(input);
    if (!skillMatch) {
      return {
        response: 'No matching skill found',
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'skill',
          reason: 'No skill match',
        },
        source: 'rule_engine',
      };
    }

    try {
      const result = await this.skillProvider.executeSkill(skillMatch.skillName, {
        input,
        messages: [],
      });

      return {
        response: result.success ? (result.output || 'Skill executed') : result.error || 'Skill failed',
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'skill',
          reason: `Skill: ${skillMatch.skillName}`,
        },
        source: 'rule_engine',
      };
    } catch (error) {
      return {
        response: `Skill error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        intent,
        routeDecision: {
          target: 'rule_engine',
          handler: 'skill',
          reason: 'Skill execution failed',
        },
        source: 'rule_engine',
      };
    }
  }

  private handleSimpleQA(input: string, intent: Intent): MiniAgentResult {
    const lowerInput = input.toLowerCase();

    let response = 'I can help with that.';

    if (lowerInput.includes('时间') || lowerInput.includes('time')) {
      const now = new Date();
      response = `Current time: ${now.toLocaleTimeString()}`;
    } else if (lowerInput.includes('日期') || lowerInput.includes('date')) {
      const now = new Date();
      response = `Current date: ${now.toLocaleDateString()}`;
    } else if (lowerInput.includes('天气') || lowerInput.includes('weather')) {
      response = 'I cannot check weather directly. Please provide your location.';
    }

    return {
      response,
      intent,
      routeDecision: {
        target: 'rule_engine',
        handler: 'simple_qa',
        reason: '简单问答由规则引擎处理',
      },
      source: 'rule_engine',
    };
  }

  private parseCommand(input: string, action: string): CommandMatch {
    const words = input.trim().split(/\s+/);
    const actionWord = words[0];
    const path = words.slice(1).join(' ').replace(/['"]/g, '');

    return {
      action: action as any,
      args: { path, original: input },
    };
  }

  private async handleOllama(
    input: string,
    intent: Intent,
    routeDecision: RouteDecision,
    messages?: ChatMessage[]
  ): Promise<MiniAgentResult> {
    const isAvailable = await this.ollamaProvider.isAvailable();

    if (!isAvailable) {
      if (routeDecision.fallback) {
        return this.handleCloud(input, intent, routeDecision.fallback, messages);
      }
      return this.handleCloud(input, intent, routeDecision, messages);
    }

    try {
      if (messages && messages.length > 0) {
        const response = await this.ollamaProvider.chat(messages, {
          model: routeDecision.model,
        });

        return {
          response: response.message.content,
          intent,
          routeDecision,
          source: 'ollama',
        };
      } else {
        const response = await this.ollamaProvider.generate(input, {
          model: routeDecision.model,
        });

        return {
          response: response.response,
          intent,
          routeDecision,
          source: 'ollama',
        };
      }
    } catch (error) {
      if (routeDecision.fallback) {
        return this.handleCloud(input, intent, routeDecision.fallback, messages);
      }
      return this.handleCloud(input, intent, routeDecision, messages);
    }
  }

  private async handleCloud(
    input: string,
    intent: Intent,
    routeDecision: RouteDecision,
    messages?: ChatMessage[]
  ): Promise<MiniAgentResult> {
    if (!this.llmClient) {
      return {
        response: 'Error: No LLM client configured',
        intent,
        routeDecision,
        source: 'cloud',
      };
    }

    try {
      const chatMessages: ChatMessage[] = messages || [
        { role: 'user', content: input },
      ];

      const response = await this.llmClient.chat(chatMessages, {
        model: routeDecision.model || 'deepseek-chat',
      });

      return {
        response: response.content,
        intent,
        routeDecision,
        source: 'cloud',
        tokens: response.usage ? {
          input: response.usage.prompt_tokens,
          output: response.usage.completion_tokens,
          total: response.usage.total_tokens,
        } : undefined,
      };
    } catch (error) {
      return {
        response: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        intent,
        routeDecision,
        source: 'cloud',
      };
    }
  }

  classify(input: string): Intent {
    return this.ruleEngine.classify(input);
  }

  route(intent: Intent): RouteDecision {
    return this.taskRouter.route(intent);
  }

  async isOllamaAvailable(): Promise<boolean> {
    return this.ollamaProvider.isAvailable();
  }

  getRuleEngine(): IRuleEngine {
    return this.ruleEngine;
  }

  getTaskRouter(): TaskRouterImpl {
    return this.taskRouter;
  }

  getConfig(): MiniAgentConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<MiniAgentConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.routing) {
      this.taskRouter.setStrategy(config.routing.strategy);
      this.taskRouter.setFallbackEnabled(config.routing.fallbackToCloud);
    }

    if (config.ollama) {
      this.ollamaProvider.setEnabled(config.ollama.enabled);
    }
  }
}

export function createMiniAgent(config?: Partial<MiniAgentConfig>): MiniAgent {
  const defaultConfig: MiniAgentConfig = {
    ollama: createDefaultOllamaConfig(),
    routing: {
      strategy: 'cloud-first',
      fallbackToCloud: true,
    },
  };

  return new MiniAgent({ ...defaultConfig, ...config });
}

let globalMiniAgent: MiniAgent | null = null;

export function getGlobalMiniAgent(): MiniAgent {
  if (!globalMiniAgent) {
    globalMiniAgent = createMiniAgent();
  }
  return globalMiniAgent;
}

export function setGlobalMiniAgent(agent: MiniAgent): void {
  globalMiniAgent = agent;
}