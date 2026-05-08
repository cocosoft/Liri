/**
 * AI代理
 */

import { AIAgent, AgentConfig, AgentTask, AgentResponse, AgentState, AgentContext, AgentStrategy, AgentMemory } from './models/types';
import { StrategyFactory } from './strategies/agentStrategy';
import { createAgentMemory } from './memory/agentMemory';
import { AIModelType, AIMessageRole } from '../ai';
import aiService from '../ai';
import { logger } from '../utils/log';

/**
 * AI代理类
 */
export class AIAgentImpl implements AIAgent {
  id: string;
  name: string;
  config: AgentConfig;
  state: AgentState;
  private strategy: AgentStrategy;
  private memory: AgentMemory;
  private createdAt: number;
  private updatedAt: number;

  /**
   * 构造函数
   * @param config 代理配置
   */
  constructor(config: AgentConfig) {
    this.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    this.name = `Agent ${this.id.substring(0, 6)}`;
    this.config = config;
    this.state = AgentState.IDLE;
    this.strategy = StrategyFactory.createStrategy(config.defaultStrategy);
    this.memory = createAgentMemory(config.memoryPath);
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * 执行任务
   * @param task 任务
   * @returns 代理响应
   */
  async execute(task: AgentTask): Promise<AgentResponse> {
    this.state = AgentState.BUSY;
    this.updatedAt = Date.now();

    try {
      // 增强上下文管理
      const context: AgentContext = {
        tools: this.config.tools,
        memory: this.memory,
        model: this.config.model,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        timeout: this.config.timeout,
        taskId: task.id,
        agentId: this.id,
        // 添加额外的上下文信息
        metadata: {
          timestamp: Date.now(),
          agentName: this.name,
          strategyName: this.strategy.name,
        },
      };

      // 记录任务开始
      logger.info(`Agent ${this.name} starting task: ${task.name}`);

      // 执行任务
      const response = await this.strategy.execute(task, context);
      
      // 记录任务完成
      logger.info(`Agent ${this.name} completed task: ${task.name}`);
      
      this.state = response.status;
      this.updatedAt = Date.now();

      // 保存任务结果到内存
      this.memory.add(`task_${task.id}`, {
        task,
        response,
        timestamp: Date.now(),
        context: {
          model: context.model,
          strategy: this.strategy.name,
          toolCount: context.tools.length,
        },
      });

      return response;
    } catch (error) {
      // 增强错误处理
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Agent ${this.name} failed to execute task ${task.name}:`, error instanceof Error ? error : new Error(String(error)));
      
      const errorResponse: AgentResponse = {
        id: Date.now().toString(36),
        taskId: task.id,
        content: `执行任务时出错: ${errorMessage}`,
        status: AgentState.FAILED,
        error: errorMessage,
        timestamp: Date.now(),
        metadata: {
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
          agentId: this.id,
          agentName: this.name,
        },
      };

      this.state = AgentState.FAILED;
      this.updatedAt = Date.now();

      // 保存错误信息到内存
      this.memory.add(`task_${task.id}_error`, {
        task,
        error: errorMessage,
        timestamp: Date.now(),
      });

      return errorResponse;
    }
  }

  /**
   * 流式执行任务
   * @param task 任务
   * @returns 异步生成器，产生代理响应
   */
  async *stream(task: AgentTask): AsyncGenerator<AgentResponse> {
    this.state = AgentState.BUSY;
    this.updatedAt = Date.now();

    let responseId = Date.now().toString(36);
    let chunkIndex = 0;
    let accumulatedContent = '';
    let isCancelled = false;

    try {
      const context: AgentContext = {
        tools: this.config.tools,
        memory: this.memory,
        model: this.config.model,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        timeout: this.config.timeout,
      };

      // 检查AI服务是否支持流式输出
      if (typeof aiService.stream === 'function') {
        // 使用AI服务的流式API
        const systemPrompt = this.strategy.buildSystemPrompt ? 
          this.strategy.buildSystemPrompt(task, context) : 
          `你是一个AI代理，你的任务是：${task.description}`;
        
        const userMessage = this.strategy.buildUserMessage ? 
          this.strategy.buildUserMessage(task) : 
          `任务：${task.name}\n描述：${task.description}\n输入：${JSON.stringify(task.input, null, 2)}`;

        const messages = [
          { role: AIMessageRole.SYSTEM, content: systemPrompt },
          { role: AIMessageRole.USER, content: userMessage },
        ];

        // 流式生成响应
        const streamOptions = {
          temperature: context.temperature,
          max_tokens: context.maxTokens,
          timeout: context.timeout,
        };

        try {
          for await (const chunk of aiService.stream(messages, context.model, streamOptions)) {
            // 检查是否被取消
            if (isCancelled) {
              break;
            }

            if (chunk.content) {
              accumulatedContent += chunk.content;
              
              // 每收到一个chunk就产生一个响应
              yield {
                id: `${responseId}_${chunkIndex++}`,
                taskId: task.id,
                content: accumulatedContent,
                status: AgentState.BUSY,
                timestamp: Date.now(),
              };
            }
          }
        } catch (streamError) {
          // 流式错误处理
          const errorResponse: AgentResponse = {
            id: `${responseId}_error`,
            taskId: task.id,
            content: `流式执行出错: ${(streamError as Error).message}`,
            status: AgentState.FAILED,
            error: (streamError as Error).message,
            timestamp: Date.now(),
          };

          this.state = AgentState.FAILED;
          this.updatedAt = Date.now();

          yield errorResponse;
          return;
        }

        // 最终响应
        const finalResponse: AgentResponse = {
          id: responseId,
          taskId: task.id,
          content: accumulatedContent,
          status: AgentState.COMPLETED,
          timestamp: Date.now(),
        };

        // 保存任务结果到内存
        this.memory.add(`task_${task.id}`, {
          task,
          response: finalResponse,
          timestamp: Date.now(),
        });

        this.state = AgentState.COMPLETED;
        this.updatedAt = Date.now();

        yield finalResponse;
      } else {
        // 回退到非流式实现
        const response = await this.execute(task);
        yield response;
      }
    } catch (error) {
      const errorResponse: AgentResponse = {
        id: responseId,
        taskId: task.id,
        content: `执行任务时出错: ${(error as Error).message}`,
        status: AgentState.FAILED,
        error: (error as Error).message,
        timestamp: Date.now(),
      };

      this.state = AgentState.FAILED;
      this.updatedAt = Date.now();

      yield errorResponse;
    }
  }

  /**
   * 取消流式执行
   */
  cancel(): void {
    this.state = AgentState.IDLE;
    this.updatedAt = Date.now();
  }

  /**
   * 暂停代理
   */
  pause(): void {
    if (this.state === AgentState.BUSY) {
      this.state = AgentState.PAUSED;
      this.updatedAt = Date.now();
    }
  }

  /**
   * 恢复代理
   */
  resume(): void {
    if (this.state === AgentState.PAUSED) {
      this.state = AgentState.BUSY;
      this.updatedAt = Date.now();
    }
  }

  /**
   * 停止代理
   */
  stop(): void {
    this.state = AgentState.IDLE;
    this.updatedAt = Date.now();
  }

  /**
   * 获取代理状态
   * @returns 代理状态
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * 获取代理信息
   * @returns 代理信息
   */
  getInfo(): {
    id: string;
    name: string;
    state: AgentState;
    model: string;
    strategy: string;
    toolCount: number;
  } {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      model: this.config.model,
      strategy: this.strategy.name,
      toolCount: this.config.tools.length,
    };
  }

  /**
   * 更新代理配置
   * @param config 配置部分
   */
  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };

    // 如果策略名称改变，更新策略
    if (config.defaultStrategy) {
      this.strategy = StrategyFactory.createStrategy(config.defaultStrategy);
    }

    this.updatedAt = Date.now();
  }

  /**
   * 序列化代理
   * @returns 序列化的数据
   */
  serialize(): any {
    return {
      id: this.id,
      name: this.name,
      config: this.config,
      state: this.state,
      memory: this.memory.getAll(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 从序列化数据创建代理
   * @param data 序列化的数据
   * @returns AI代理实例
   */
  static deserialize(data: any): AIAgent {
    const agent = new AIAgentImpl(data.config);
    agent.id = data.id;
    agent.name = data.name;
    agent.state = data.state;

    // 恢复内存数据
    if (data.memory) {
      for (const [key, value] of Object.entries(data.memory)) {
        agent.memory.add(key, value);
      }
    }

    agent.createdAt = data.createdAt;
    agent.updatedAt = data.updatedAt;
    return agent;
  }
}

/**
 * 创建AI代理实例
 * @param config 代理配置
 * @returns AI代理实例
 */
export function createAIAgent(config: Partial<AgentConfig> = {}): AIAgent {
  const defaultConfig: AgentConfig = {
    model: AIModelType.GPT_3_5_TURBO,
    temperature: 0.7,
    maxTokens: 1000,
    timeout: 60000,
    memoryPath: '',
    defaultStrategy: 'direct_answer',
    tools: [],
  };

  return new AIAgentImpl({ ...defaultConfig, ...config });
}

/**
 * AI代理实例
 */
export const aiAgent = createAIAgent();
