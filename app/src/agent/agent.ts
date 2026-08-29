/**
 * AI代理
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error/handleError';
import {
  AIAgent,
  AgentConfig,
  AgentTask,
  AgentResponse,
  AgentState,
  AgentContext,
  AgentStrategy,
  AgentMemory,
} from './models/types';
import { StrategyFactory } from './strategies/agentStrategy';
import { createAgentMemory } from './memory/agentMemory';
import { AIModelType, AIMessageRole } from '@modules/ai';
import aiService from '@modules/ai';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent:agent');
import {
  saveTrajectory,
  messagesToTrajectory,
  type ConversationMessage,
} from './trajectory';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveSessionsDir } from '@modules/core';
import { CuratorScheduler } from '@modules/tools/AgentTool/CuratorScheduler';
import { SkillLifecycleManager } from '@modules/tools/AgentTool/SkillLifecycleManager';
import { InternalEventBus } from './events';

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
  private curator: CuratorScheduler | null = null;
  /** Y3 修复: 流式取消标记，cancel() 设置后 stream() 循环退出 */
  private _streamCancelled = false;
  private skillLifecycle: SkillLifecycleManager | null = null;
  private eventBus: InternalEventBus | null = null;

  /**
   * 构造函数
   * @param config 代理配置
   * @param eventBus 可选事件总线
   */
  constructor(config: AgentConfig, eventBus?: InternalEventBus) {
    this.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    this.name = `Agent ${this.id.substring(0, 6)}`;
    this.config = config;
    this.state = AgentState.IDLE;
    this.strategy = StrategyFactory.createStrategy(config.defaultStrategy);
    this.memory = createAgentMemory(config.memoryPath);
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.eventBus = eventBus ?? null;
    if (config.curatorConfig) {
      this.curator = new CuratorScheduler({
        enabled: config.curatorConfig.enabled,
        intervalHours: config.curatorConfig.intervalHours,
        minIdleHours: config.curatorConfig.minIdleHours,
        staleAfterDays: config.curatorConfig.staleAfterDays,
        archiveAfterDays: config.curatorConfig.archiveAfterDays,
      });
      this.skillLifecycle = new SkillLifecycleManager({
        staleAfterDays: config.curatorConfig.staleAfterDays,
        archiveAfterDays: config.curatorConfig.archiveAfterDays,
      });
    }
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
        promptMode: this.config.promptMode,
        // 添加额外的上下文信息
        metadata: {
          timestamp: Date.now(),
          agentName: this.name,
          strategyName: this.strategy.name,
        },
      };

      // 记录任务开始
      logger.info(`Agent ${this.name} starting task: ${task.name}`);

      await this.emitEvent('agent:execute:start', {
        taskId: task.id,
        taskName: task.name,
        strategy: this.strategy.name,
        toolCount: context.tools.length,
      });

      // 执行任务
      const response = await this.strategy.execute(task, context);

      // 记录任务完成
      logger.info(`Agent ${this.name} completed task: ${task.name}`);

      await this.emitEvent('agent:execute:end', {
        taskId: task.id,
        status: response.status,
        duration: Date.now() - this.updatedAt,
        responseId: response.id,
      });

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

      this.maybeRunCurator().catch((e) =>
        logger.warn('Curator background check failed', { error: String(e) })
      );

      return response;
    } catch (error) {
      // 增强错误处理
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      handleError(error, { module: 'agent:impl', action: 'Agent执行任务' });

      await this.emitEvent('agent:execute:error', {
        taskId: task.id,
        taskName: task.name,
        error: errorMessage,
        strategy: this.strategy.name,
      });

      const errorResponse: AgentResponse = {
        id: Date.now().toString(36),
        taskId: task.id,
        content: `执行任务时出错: ${errorMessage}`,
        status: AgentState.FAILED,
        error: errorMessage,
        timestamp: Date.now(),
        metadata: {
          errorType:
            error instanceof Error ? error.constructor.name : 'UnknownError',
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
    // Y3 修复: 使用类字段 _streamCancelled，cancel() 可中断流式循环
    this._streamCancelled = false;

    try {
      const context: AgentContext = {
        tools: this.config.tools,
        memory: this.memory,
        model: this.config.model,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        timeout: this.config.timeout,
        promptMode: this.config.promptMode,
      };

      // 检查AI服务是否支持流式输出
      if (typeof aiService.stream === 'function') {
        // 使用AI服务的流式API
        const systemPrompt = this.strategy.buildSystemPrompt
          ? this.strategy.buildSystemPrompt(task, context)
          : `你是一个AI代理，你的任务是：${task.description}`;

        const userMessage = this.strategy.buildUserMessage
          ? this.strategy.buildUserMessage(task)
          : `任务：${task.name}\n描述：${task.description}\n输入：${JSON.stringify(task.input, null, 2)}`;

        const messages = [
          { role: AIMessageRole.SYSTEM, content: systemPrompt },
          { role: AIMessageRole.USER, content: userMessage },
        ];

        // 流式生成响应
        const streamOptions = {
          temperature: context.temperature,
          max_tokens: context.maxTokens,
          timeout: context.timeout,
          tools: this.config.tools?.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters ?? {},
            },
          })),
        };

        await this.emitEvent('agent:reply:start', {
          taskId: task.id,
          messageCount: messages.length,
          model: context.model,
        });

        let lastToolCalls: AgentResponse['toolCalls'];
        try {
          for await (const chunk of aiService.stream(
            messages,
            context.model,
            streamOptions
          )) {
            // 检查是否被取消
            if (this._streamCancelled) {
              break;
            }

            // 追踪最后一个 chunk 的 tool_calls
            if (chunk.tool_calls && chunk.tool_calls.length > 0) {
              lastToolCalls = chunk.tool_calls;
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

              await this.emitEvent('agent:reply:delta', {
                taskId: task.id,
                chunkIndex: chunkIndex - 1,
                content: chunk.content,
                accumulatedLength: accumulatedContent.length,
              });
            }
          }
        } catch (streamError) {
          // 流式错误处理
          const errMsg = (streamError as Error).message;

          await this.emitEvent('agent:reply:error', {
            taskId: task.id,
            error: errMsg,
            accumulatedLength: accumulatedContent.length,
          });

          const errorResponse: AgentResponse = {
            id: `${responseId}_error`,
            taskId: task.id,
            content: `流式执行出错: ${errMsg}`,
            status: AgentState.FAILED,
            error: errMsg,
            timestamp: Date.now(),
          };

          this.state = AgentState.FAILED;
          this.updatedAt = Date.now();

          yield errorResponse;
          return;
        }

        // 最终响应
        // N2 修复: 流式结束后执行工具调用
        let finalContent = accumulatedContent;
        let finalResult: Record<string, unknown> | undefined;
        if (lastToolCalls && lastToolCalls.length > 0) {
          try {
            const toolResults: Array<{
              name: string;
              result: unknown;
              error?: string;
            }> = [];
            for (const tc of lastToolCalls) {
              const tool = this.config.tools?.find((t) => t.name === tc.name);
              if (tool) {
                try {
                  const result = await tool.execute(tc.arguments ?? {});
                  toolResults.push({ name: tc.name, result });
                } catch (execErr) {
                  toolResults.push({
                    name: tc.name,
                    result: null,
                    error: (execErr as Error).message,
                  });
                }
              }
            }

            if (toolResults.length > 0) {
              const toolResultSummary = toolResults
                .map(
                  (tr) =>
                    `${tr.name}: ${tr.error ? `ERROR: ${tr.error}` : JSON.stringify(tr.result, null, 2)}`
                )
                .join('\n');
              messages.push({
                role: AIMessageRole.ASSISTANT,
                content:
                  accumulatedContent ||
                  `调用工具: ${lastToolCalls.map((tc) => tc.name).join(', ')}`,
              });
              messages.push({
                role: AIMessageRole.USER,
                content: `Tool execution results:\n${toolResultSummary}`,
              });

              const followUpResponse = await aiService.generate(
                messages,
                context.model,
                {
                  temperature: context.temperature,
                  max_tokens: context.maxTokens,
                  tools: streamOptions.tools,
                }
              );
              finalContent = followUpResponse.content;
              finalResult = { toolResults };
            }
          } catch (execErr) {
            logger.warn('流式工具执行失败', { error: String(execErr) });
            finalContent = `${accumulatedContent}\n\n工具执行出错: ${(execErr as Error).message}`;
          }
        }

        const finalResponse: AgentResponse = {
          id: responseId,
          taskId: task.id,
          content: finalContent,
          status: AgentState.COMPLETED,
          timestamp: Date.now(),
          toolCalls: lastToolCalls,
          result: finalResult,
        };

        await this.emitEvent('agent:reply:end', {
          taskId: task.id,
          totalChunks: chunkIndex,
          totalLength: accumulatedContent.length,
        });

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
    this._streamCancelled = true;
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
      this.maybeRunCurator().catch((e) =>
        logger.warn('Curator background check failed', { error: String(e) })
      );
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
   * 检查并触发 Curator 后台审查
   *
   * 当代理空闲且距上次审查超过 intervalHours 时，
   * 自动执行技能生命周期转换并生成审查报告。
   */
  private async maybeRunCurator(): Promise<void> {
    if (!this.curator || !this.skillLifecycle) {
      return;
    }

    if (!this.curator.shouldRunNow()) {
      return;
    }

    logger.info('Curator triggered — running skill lifecycle transitions', {
      agentId: this.id,
      runCount: this.curator.getState().runCount + 1,
    });

    await this.curator.runReview(async () => {
      const transitions = this.skillLifecycle!.applyAutomaticTransitions();
      const summary = [
        `技能生命周期检查完成`,
        `检查 ${transitions.checked} 个技能`,
        transitions.markedStale > 0
          ? `${transitions.markedStale} 个标记为 stale`
          : '无 stale 转换',
        transitions.archived > 0
          ? `${transitions.archived} 个归档`
          : '无归档操作',
        transitions.reactivated > 0
          ? `${transitions.reactivated} 个重新激活`
          : '无重新激活',
      ].join(' | ');

      return {
        reviewedCount: transitions.checked,
        transitions,
        summary,
        durationMs: 0,
      };
    });
  }

  /**
   * 安全发射事件
   * @param type 事件类型
   * @param data 事件数据
   */
  private async emitEvent(type: string, data?: unknown): Promise<void> {
    if (!this.eventBus) return;
    try {
      await this.eventBus.emit(type, data, { source: `agent:${this.id}` });
    } catch (e) {
      logger.warn(`事件发射失败: ${type}`, { error: String(e) });
    }
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

  getSkillLifecycleManager(): SkillLifecycleManager | null {
    return this.skillLifecycle;
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
  serialize(): unknown {
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
  static deserialize(data: unknown): AIAgent {
    const d = data as {
      config: AgentConfig;
      id: string;
      name: string;
      state: AgentState;
      memory?: Record<string, unknown>;
      createdAt: number;
      updatedAt: number;
    };
    const agent = new AIAgentImpl(d.config);
    agent.id = d.id;
    agent.name = d.name;
    agent.state = d.state;

    // 恢复内存数据
    if (d.memory) {
      for (const [key, value] of Object.entries(d.memory)) {
        agent.memory.add(key, value);
      }
    }

    agent.createdAt = d.createdAt;
    agent.updatedAt = d.updatedAt;
    return agent;
  }

  /**
   * 保存 Agent 状态到磁盘
   * @param path 保存路径（可选，默认 app/data/sessions/<id>.json）
   * @returns 保存路径
   */
  saveState(path?: string): string {
    const sessionsDir = resolveSessionsDir();
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    const filepath = path || join(sessionsDir, `${this.id}.json`);

    const snapshot = {
      id: this.id,
      name: this.name,
      state: this.state,
      config: this.config,
      memory: this.memory.getAll(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      savedAt: Date.now(),
    };

    writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');
    logger.info(`Agent state saved`, { agentId: this.id, path: filepath });

    return filepath;
  }

  /**
   * 导出 Agent 状态为可序列化 JSON 对象
   * @returns 可序列化的状态对象
   */
  exportState(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      config: { ...this.config },
      memory: this.memory.getAll(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      exportedAt: Date.now(),
      version: '1.0',
    };
  }

  /**
   * 从磁盘加载 Agent 状态
   * @param path 保存路径
   * @returns 恢复的 Agent 实例
   */
  static loadState(path: string): AIAgentImpl {
    if (!existsSync(path)) {
      throw new AppError(
        `Agent state file not found: ${path}`,
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { path }
      );
    }

    const raw = readFileSync(path, 'utf-8');
    const snapshot = JSON.parse(raw);

    const agent = new AIAgentImpl(snapshot.config);
    agent.id = snapshot.id;
    agent.name = snapshot.name;
    agent.state = snapshot.state;
    agent.createdAt = snapshot.createdAt;
    agent.updatedAt = snapshot.updatedAt;

    if (snapshot.memory) {
      for (const [key, value] of Object.entries(snapshot.memory)) {
        agent.memory.add(key, value);
      }
    }

    logger.info(`Agent state loaded`, { agentId: agent.id, path });
    return agent;
  }

  /**
   * 保存对话轨迹
   * @param messages 对话消息列表
   * @param completed 是否正常完成
   */
  async saveTrajectory(
    messages: ConversationMessage[],
    completed: boolean
  ): Promise<void> {
    const trajectory = messagesToTrajectory(
      messages,
      this.config.model || 'unknown',
      completed,
      {
        sessionId: this.id,
        turnCount: 0,
        totalTokens: 0,
        durationMs: Date.now() - this.createdAt,
      }
    );

    await saveTrajectory(trajectory);
  }
}

/**
 * 创建AI代理实例
 * @param config 代理配置
 * @returns AI代理实例
 */
export function createAIAgent(config: Partial<AgentConfig> = {}): AIAgent {
  const defaultConfig: AgentConfig = {
    model: '',
    temperature: 0.7,
    maxTokens: 1000,
    timeout: 60000,
    memoryPath: '',
    // S4 修复: 默认使用 general 策略（支持工具调用）
    defaultStrategy: 'general',
    tools: [],
  };

  return new AIAgentImpl({ ...defaultConfig, ...config });
}

/**
 * AI代理实例
 */
export const aiAgent = createAIAgent();
