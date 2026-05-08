//
/**
 * 代理策略
 */

import type {
  AgentStrategy,
  AgentTask,
  AgentResponse,
  AgentContext,
  BuiltInAgentDefinition
} from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai';

/**
 * 基础代理策略
 */
export abstract class BaseAgentStrategy implements AgentStrategy {
  name: string;
  description: string;

  /**
   * 构造函数
   * @param name 策略名称
   * @param description 策略描述
   */
  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  /**
   * 执行策略
   * @param task 任务
   * @param context 上下文
   * @returns 代理响应
   */
  abstract execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse>;

  /**
   * 构建系统提示
   * @param task 任务
   * @param context 上下文
   * @returns 系统提示
   */
  protected buildSystemPrompt(task: AgentTask, context: AgentContext): string {
    return (
      `你是一个AI代理，你的任务是：${task.description}\n\n` +
      `可用工具：\n${context.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n` +
      `请根据任务要求，决定是否使用工具，并按照以下格式输出：\n` +
      `思考：你的思考过程\n` +
      `工具：工具名称（如果需要使用工具）\n` +
      `参数：工具参数（如果需要使用工具）\n` +
      `回答：最终回答（如果不需要使用工具）`
    );
  }

  /**
   * 构建用户消息
   * @param task 任务
   * @returns 用户消息
   */
  protected buildUserMessage(task: AgentTask): string {
    return (
      `任务：${task.name}\n` +
      `描述：${task.description}\n` +
      `输入：${JSON.stringify(task.input, null, 2)}`
    );
  }
}

/**
 * 直接回答策略
 */
export class DirectAnswerStrategy extends BaseAgentStrategy {
  constructor() {
    super('direct_answer', '直接回答策略，不使用工具');
  }

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    const systemPrompt = this.buildSystemPrompt(task, context);
    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: context.temperature,
      max_tokens: context.maxTokens,
    });

    return {
      id: aiResponse.id,
      taskId: task.id,
      content: aiResponse.content,
      status: AgentState.COMPLETED,
      usage: aiResponse.usage
        ? {
            promptTokens: aiResponse.usage.prompt_tokens,
            completionTokens: aiResponse.usage.completion_tokens,
            totalTokens: aiResponse.usage.total_tokens,
          }
        : undefined,
      timestamp: Date.now(),
      finishReason: aiResponse.finish_reason,
    };
  }
}

/**
 * 工具使用策略
 */
export class ToolUseStrategy extends BaseAgentStrategy {
  constructor() {
    super('tool_use', '工具使用策略，根据需要使用工具');
  }

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    const systemPrompt = this.buildSystemPrompt(task, context);
    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: context.temperature,
      max_tokens: context.maxTokens,
    });

    // 解析AI响应，检查是否需要使用工具
    const responseText = aiResponse.content;
    const lines = responseText.split('\n');
    let thought = '';
    let toolName = '';
    let toolParams = '';
    let answer = '';

    for (const line of lines) {
      if (line.startsWith('思考：')) {
        thought = line.substring(3).trim();
      } else if (line.startsWith('工具：')) {
        toolName = line.substring(3).trim();
      } else if (line.startsWith('参数：')) {
        toolParams = line.substring(3).trim();
      } else if (line.startsWith('回答：')) {
        answer = line.substring(3).trim();
      }
    }

    // 如果需要使用工具
    if (toolName && toolParams) {
      try {
        const params = JSON.parse(toolParams);
        const tool = context.tools.find((t) => t.name === toolName);

        if (tool) {
          const toolResult = await tool.execute(params);

          // 将工具执行结果返回给AI，获取最终回答
          const toolMessage = `工具执行结果：${JSON.stringify(toolResult, null, 2)}`;
          messages.push({
            role: AIMessageRole.ASSISTANT,
            content: responseText,
          });
          messages.push({ role: AIMessageRole.USER, content: toolMessage });

          const finalResponse = await aiService.generate(
            messages,
            context.model,
            {
              temperature: context.temperature,
              max_tokens: context.maxTokens,
            }
          );

          return {
            id: finalResponse.id,
            taskId: task.id,
            content: finalResponse.content,
            result: toolResult,
            status: AgentState.COMPLETED,
            usage: finalResponse.usage
              ? {
                  promptTokens: finalResponse.usage.prompt_tokens,
                  completionTokens: finalResponse.usage.completion_tokens,
                  totalTokens: finalResponse.usage.total_tokens,
                }
              : undefined,
            timestamp: Date.now(),
            finishReason: finalResponse.finish_reason,
          };
        } else {
          return {
            id: aiResponse.id,
            taskId: task.id,
            content: `错误：工具 ${toolName} 不存在`,
            status: AgentState.FAILED,
            error: `工具 ${toolName} 不存在`,
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        return {
          id: aiResponse.id,
          taskId: task.id,
          content: `错误：${(error as Error).message}`,
          status: AgentState.FAILED,
          error: (error as Error).message,
          timestamp: Date.now(),
        };
      }
    } else {
      // 直接返回回答
      return {
        id: aiResponse.id,
        taskId: task.id,
        content: answer || responseText,
        status: AgentState.COMPLETED,
        usage: aiResponse.usage
          ? {
              promptTokens: aiResponse.usage.prompt_tokens,
              completionTokens: aiResponse.usage.completion_tokens,
              totalTokens: aiResponse.usage.total_tokens,
            }
          : undefined,
        timestamp: Date.now(),
        finishReason: aiResponse.finish_reason,
      };
    }
  }
}

/**
 * 策略工厂
 */
export class StrategyFactory {
  /**
   * 创建直接回答策略
   * @returns 直接回答策略
   */
  static createDirectAnswerStrategy(): AgentStrategy {
    return new DirectAnswerStrategy();
  }

  /**
   * 创建工具使用策略
   * @returns 工具使用策略
   */
  static createToolUseStrategy(): AgentStrategy {
    return new ToolUseStrategy();
  }

  /**
   * 根据名称创建策略
   * @param name 策略名称
   * @returns 策略实例
   */
  static createStrategy(name: string): AgentStrategy {
    switch (name) {
      case 'direct_answer':
        return new DirectAnswerStrategy();
      case 'tool_use':
        return new ToolUseStrategy();
      case 'general':
        return new (require('./GeneralAgentStrategy').GeneralAgentStrategy)();
      case 'code':
        return new (require('./CodeAgentStrategy').CodeAgentStrategy)();
      case 'explore':
        return new (require('./ExploreAgentStrategy').ExploreAgentStrategy)();
      case 'plan':
        return new (require('./PlanAgentStrategy').PlanAgentStrategy)();
      default:
        return new DirectAnswerStrategy();
    }
  }
}

/**
 * 获取内置Agent定义
 * @returns 内置Agent定义数组
 */
export function getBuiltInAgents(): BuiltInAgentDefinition[] {
  return [
    {
      agentType: 'general',
      whenToUse: '通用任务处理',
      source: 'built-in',
      baseDir: 'built-in',
      color: 'blue',
      getSystemPrompt: () => `你是一个通用AI代理，能够处理各种任务。请根据用户的请求，提供详细、准确的回答。`,
    },
    {
      agentType: 'code',
      whenToUse: '代码编写和分析',
      source: 'built-in',
      baseDir: 'built-in',
      color: 'green',
      getSystemPrompt: () => `你是一个代码专家，擅长编写、分析和调试代码。请提供高质量的代码解决方案。`,
    },
    {
      agentType: 'explore',
      whenToUse: '探索和研究',
      source: 'built-in',
      baseDir: 'built-in',
      color: 'purple',
      getSystemPrompt: () => `你是一个探索型AI代理，擅长研究和分析复杂问题。请提供深入的分析和见解。`,
    },
    {
      agentType: 'plan',
      whenToUse: '计划和规划',
      source: 'built-in',
      baseDir: 'built-in',
      color: 'yellow',
      getSystemPrompt: () => `你是一个规划专家，擅长制定详细的计划和方案。请提供结构化的计划和建议。`,
    },
  ];
}
