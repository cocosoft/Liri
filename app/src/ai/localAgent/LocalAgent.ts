/**
 * Local Agent 核心类
 * 整合规则引擎、任务路由、命令执行、Ollama 调用
 */

import type { ChatMessage } from '../models/types.js';
import type { AIProvider, ProviderConfig } from '../providers/AIProvider.js';
import { OllamaProvider } from '@modules/ai/providers/OllamaProvider';
import type {
  Intent,
  RouteDecision,
  LocalAgentConfig,
  LocalAgentResult,
  CommandMatch,
  IRuleEngine,
} from './types.js';
import { KeywordRuleEngine } from './KeywordRuleEngine.js';
import { TaskRouterImpl } from './TaskRouter.js';
import { LocalCommandExecutor } from './CommandExecutor.js';
import { SkillProvider } from './SkillProvider.js';
import { MCPProvider } from './MCPProvider.js';
import { SimpleQAEngine } from './SimpleQAEngine.js';
import { ToolDispatcher } from './ToolDispatcher.js';
import { LocalAgentCache } from './LocalAgentCache.js';
import { DateTimeHandler } from './handlers/DateTimeHandler.js';
import { SystemInfoHandler } from './handlers/SystemInfoHandler.js';
import { GreetingHandler } from './handlers/GreetingHandler.js';

export class LocalAgent {
  private ruleEngine: IRuleEngine;
  private taskRouter: TaskRouterImpl;
  private ollamaProvider: OllamaProvider;
  private commandExecutor: LocalCommandExecutor;
  private skillProvider: SkillProvider | null = null;
  private mcpProvider: MCPProvider | null = null;
  private llmClient: AIProvider | null = null;
  private simpleQAEngine: SimpleQAEngine;
  private toolDispatcher: ToolDispatcher;
  private delegationDepth: number = 0;
  private cache: LocalAgentCache;
  private config: LocalAgentConfig;

  constructor(config: LocalAgentConfig) {
    this.config = {
      ...config,
      routing: {
        strategy: config.routing?.strategy ?? ('local-first' as const),
        fallbackToCloud: config.routing?.fallbackToCloud ?? true,
        thresholds: {
          ruleEngine: config.routing?.thresholds?.ruleEngine ?? 0.85,
          localLLM: config.routing?.thresholds?.localLLM ?? 0.6,
          cloud: config.routing?.thresholds?.cloud ?? 0,
        },
      },
      delegation: {
        enabled: true,
        complexityThreshold: 200,
        maxDepth: 2,
        ...config.delegation,
      },
    };
    this.ruleEngine = new KeywordRuleEngine();
    this.taskRouter = new TaskRouterImpl(
      this.config.routing.strategy,
      this.config.routing.fallbackToCloud
    );
    this.ollamaProvider = new OllamaProvider({
      baseUrl: this.config.ollama?.baseUrl,
      model: this.config.ollama?.defaultModel,
      timeout: this.config.ollama?.timeout,
    } as ProviderConfig);
    this.commandExecutor = new LocalCommandExecutor();
    this.simpleQAEngine = new SimpleQAEngine();
    this.simpleQAEngine.registerHandlers([
      new DateTimeHandler(),
      new SystemInfoHandler(),
      new GreetingHandler(),
    ]);

    this.toolDispatcher = new ToolDispatcher(
      this.mcpProvider ?? undefined,
      this.skillProvider ?? undefined,
      this.commandExecutor
    );

    this.cache = new LocalAgentCache(100, 60000);
  }

  setSkillProvider(provider: SkillProvider): void {
    this.skillProvider = provider;
    this.toolDispatcher = new ToolDispatcher(
      this.mcpProvider ?? undefined,
      this.skillProvider ?? undefined,
      this.commandExecutor
    );
  }

  setMCPProvider(provider: MCPProvider): void {
    this.mcpProvider = provider;
    this.toolDispatcher = new ToolDispatcher(
      this.mcpProvider ?? undefined,
      this.skillProvider ?? undefined,
      this.commandExecutor
    );
  }

  setLLMClient(client: AIProvider): void {
    this.llmClient = client;
  }

  async process(
    input: string,
    messages?: ChatMessage[]
  ): Promise<LocalAgentResult> {
    const cached = this.cache.get(input);
    if (cached) {
      return JSON.parse(cached);
    }

    const intent = this.ruleEngine.classify(input);
    const routeDecision = this.taskRouter.route(intent, {
      inputLength: input.length,
    });

    let result: LocalAgentResult;

    switch (routeDecision.target) {
      case 'rule_engine':
        result = await this.handleRuleEngine(input, intent, routeDecision);
        break;
      case 'ollama':
        result = await this.handleOllama(
          input,
          intent,
          routeDecision,
          messages
        );
        break;
      case 'cloud':
        result = await this.handleCloud(input, intent, routeDecision, messages);
        break;
      default:
        result = await this.handleCloud(input, intent, routeDecision, messages);
        break;
    }

    this.cache.set(input, JSON.stringify(result));
    return result;
  }

  private async handleRuleEngine(
    input: string,
    intent: Intent,
    routeDecision: RouteDecision
  ): Promise<LocalAgentResult> {
    const handler = routeDecision.handler;

    if (handler === 'simple_qa') {
      const qaResult = this.simpleQAEngine.process(input);
      if (qaResult) {
        return {
          response: qaResult.response,
          intent,
          routeDecision,
          source: 'rule_engine',
        };
      }
    }

    const toolResult = await this.toolDispatcher.dispatch(input);
    if (toolResult?.success && toolResult.output) {
      return {
        response: toolResult.output,
        intent,
        routeDecision,
        source: 'rule_engine',
      };
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

  private async handleMCP(
    input: string,
    intent: Intent
  ): Promise<LocalAgentResult> {
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

    const toolName = await this.mcpProvider.matchTool(input);
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
        response: result.success
          ? result.output || 'MCP tool executed'
          : result.error || 'MCP tool failed',
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

  private async handleSkill(
    input: string,
    intent: Intent
  ): Promise<LocalAgentResult> {
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

    const skillMatch = await this.skillProvider.matchSkill(input);
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
      const result = await this.skillProvider.executeSkill(
        skillMatch.skillName,
        {
          input,
          messages: [],
        }
      );

      return {
        response: result.success
          ? result.output || 'Skill executed'
          : result.error || 'Skill failed',
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
  ): Promise<LocalAgentResult> {
    if (!this.config.ollama?.enabled) {
      if (routeDecision.fallback) {
        return this.handleCloud(
          input,
          intent,
          routeDecision.fallback,
          messages
        );
      }
      return this.handleCloud(input, intent, routeDecision, messages);
    }

    const isAvailable = await this.ollamaProvider.isAvailable();

    if (!isAvailable) {
      if (routeDecision.fallback) {
        return this.handleCloud(
          input,
          intent,
          routeDecision.fallback,
          messages
        );
      }
      return this.handleCloud(input, intent, routeDecision, messages);
    }

    if (this.shouldDelegate(input)) {
      this.delegationDepth++;
      const delegatedDecision: RouteDecision = {
        ...routeDecision,
        target: 'cloud',
        model: routeDecision.fallback?.model || '',
        reason: `Delegated from Ollama (depth ${this.delegationDepth})`,
      };
      const result = await this.handleCloud(
        input,
        intent,
        delegatedDecision,
        messages
      );
      this.delegationDepth--;
      return result;
    }

    try {
      if (messages && messages.length > 0) {
        const response = await this.ollamaProvider.chat(messages, {
          model: routeDecision.model,
        });

        return {
          response: response.content,
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
        return this.handleCloud(
          input,
          intent,
          routeDecision.fallback,
          messages
        );
      }
      return this.handleCloud(input, intent, routeDecision, messages);
    }
  }

  private async handleCloud(
    input: string,
    intent: Intent,
    routeDecision: RouteDecision,
    messages?: ChatMessage[]
  ): Promise<LocalAgentResult> {
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
        model: routeDecision.model || '',
      });

      return {
        response: response.content,
        intent,
        routeDecision,
        source: 'cloud',
        tokens: response.usage
          ? {
              input: response.usage.prompt_tokens,
              output: response.usage.completion_tokens,
              total: response.usage.total_tokens,
            }
          : undefined,
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

  private shouldDelegate(input: string): boolean {
    const delegation = this.config.delegation;
    if (!delegation?.enabled) return false;
    if (this.delegationDepth >= delegation.maxDepth) return false;

    const complexKeywords = [
      '分析',
      '复写',
      '复杂',
      '详细',
      '重构',
      '优化',
      '设计',
      'analyze',
      'refactor',
      'complex',
      'detailed',
      'optimize',
      'architecture',
      'review',
      'security',
    ];
    const lower = input.toLowerCase();
    const hasKeyword = complexKeywords.some((k) => lower.includes(k));
    if (hasKeyword) return true;

    if (input.length > delegation.complexityThreshold) return true;

    return false;
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

  getConfig(): LocalAgentConfig {
    return { ...this.config };
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  clearCache(): void {
    this.cache.clear();
  }

  updateConfig(config: Partial<LocalAgentConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.routing) {
      this.taskRouter.setStrategy(config.routing.strategy);
      this.taskRouter.setFallbackEnabled(config.routing.fallbackToCloud);
    }

    if (config.ollama) {
      this.config.ollama = { ...this.config.ollama, ...config.ollama };
    }
  }
}

export function createLocalAgent(
  config?: Partial<LocalAgentConfig>
): LocalAgent {
  const defaultConfig: LocalAgentConfig = {
    ollama: {
      enabled: false,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      defaultModel: process.env.OLLAMA_DEFAULT_MODEL || '',
      timeout: parseInt(process.env.OLLAMA_TIMEOUT || '30000', 10),
    },
    routing: {
      strategy: 'local-first',
      fallbackToCloud: true,
      thresholds: {
        ruleEngine: 0.85,
        localLLM: 0.6,
        cloud: 0,
      },
    },
    delegation: {
      enabled: true,
      complexityThreshold: 200,
      maxDepth: 2,
    },
  };

  return new LocalAgent({ ...defaultConfig, ...config });
}

let globalLocalAgent: LocalAgent | null = null;

export function getGlobalLocalAgent(): LocalAgent {
  if (!globalLocalAgent) {
    globalLocalAgent = createLocalAgent();
  }
  return globalLocalAgent;
}

export function setGlobalLocalAgent(agent: LocalAgent): void {
  globalLocalAgent = agent;
}
