/**
 * 代理策略
 */

import type {
  AgentStrategy,
  AgentTask,
  AgentResponse,
  AgentContext,
  BuiltInAgentDefinition,
} from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'agent:strategies:agentStrategy', level: LogLevel.INFO });

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
   * 构建用户消息
   * @param task 任务
   * @returns 用户消息
   */
  public buildUserMessage(task: AgentTask): string {
    return (
      `Task: ${task.name}\n` +
      `Description: ${task.description}\n` +
      `Input: ${JSON.stringify(task.input, null, 2)}`
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
    const strategyExtra = `## 策略说明\n\n你是一个通用助手，能够直接回答问题而无需使用工具。\n\n能力范围：\n- 回答问题\n- 提供建议\n- 写作辅助\n- 信息检索\n- 任务规划`;
    const systemPrompt = await assembleSystemPrompt({
      strategyExtra,
      mode: context.promptMode,
    });
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
    const strategyExtra = `## 策略说明\n\n你是一个工具使用助手，能够根据任务需求选择和执行适当的工具。\n\n能力范围：\n- 根据任务需求选择合适的工具\n- 执行工具并处理结果\n- 分析工具输出以指导后续步骤\n- 组合多个工具调用以解决复杂问题`;
    const systemPrompt = await assembleSystemPrompt({
      strategyExtra,
      mode: context.promptMode,
    });
    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: context.temperature,
      max_tokens: context.maxTokens,
    });

    const responseText = aiResponse.content;
    const lines = responseText.split('\n');
    let thought = '';
    let toolName = '';
    let toolParams = '';
    let answer = '';

    for (const line of lines) {
      if (line.startsWith('Thought:') || line.startsWith('思考：')) {
        thought = line.substring(line.indexOf(':') + 1).trim();
      } else if (line.startsWith('Tool:') || line.startsWith('工具：')) {
        toolName = line.substring(line.indexOf(':') + 1).trim();
      } else if (line.startsWith('Parameters:') || line.startsWith('参数：')) {
        toolParams = line.substring(line.indexOf(':') + 1).trim();
      } else if (line.startsWith('Answer:') || line.startsWith('回答：')) {
        answer = line.substring(line.indexOf(':') + 1).trim();
      }
    }

    if (toolName && toolParams) {
      try {
        const params = JSON.parse(toolParams);
        const tool = context.tools.find((t) => t.name === toolName);

        if (tool) {
          const toolResult = await tool.execute(params);

          const toolMessage = `Tool execution result: ${JSON.stringify(toolResult, null, 2)}`;
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
            content: `Error: Tool ${toolName} not found`,
            status: AgentState.FAILED,
            error: `Tool ${toolName} not found`,
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        return {
          id: aiResponse.id,
          taskId: task.id,
          content: `Error: ${(error as Error).message}`,
          status: AgentState.FAILED,
          error: (error as Error).message,
          timestamp: Date.now(),
        };
      }
    } else {
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
      whenToUse: 'General purpose task handling',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () =>
        `You are Liri, a general-purpose AI agent capable of handling various tasks. Respond to user requests with detailed, accurate answers.`,
    },
    {
      agentType: 'code',
      whenToUse: 'Code writing and analysis',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () =>
        `You are Liri, a code expert skilled in writing, analyzing, and debugging code. Provide high-quality code solutions.`,
    },
    {
      agentType: 'explore',
      whenToUse: 'Exploration and research',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () =>
        `You are Liri, an exploration-focused AI agent skilled in researching and analyzing complex problems. Provide in-depth analysis and insights.`,
    },
    {
      agentType: 'plan',
      whenToUse: 'Planning and scheduling',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () =>
        `You are Liri, a planning expert skilled in creating detailed plans and proposals. Provide structured plans and recommendations.`,
    },
  ];
}
