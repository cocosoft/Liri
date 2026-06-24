/**
 * ParallelOrchestrator — 方案 7：Agent 并行执行编排器
 *
 * 接收 LLM 传入的 tasks 数组，通过 SubAgentEngine 并行执行多个子 Agent，
 * 发射并行事件供前端 SSE 时间线展示。
 * 支持 AbortController 链式取消和 Promise.allSettled 异常隔离。
 */

import { randomUUID } from 'crypto';
import { SubAgentEngine, getSubAgentEngine } from './SubAgentEngine';
import { globalEventBus } from '../../core/events/EventBus.js';
import { OrchestrationEventType } from '../../agent/events/OrchestrationEvents.js';
import type {
  ParallelStartData,
  ParallelEndData,
  ParallelTaskStartData,
  ParallelTaskCompleteData,
} from '../../agent/events/OrchestrationEvents.js';
import type { SubTask } from './types';
import type { Tool } from '../types/Tool';
import type { ToolDefinition } from '@modules/ai';

/** 子任务执行结果 */
export interface SubTaskResult {
  /** 子任务 ID */
  taskId: string;
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** 任务描述 */
  description: string;
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 错误信息 */
  error?: string;
  /** 耗时（毫秒） */
  durationMs: number;
  /** Token 使用情况 */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** 并行执行编排器 */
export class ParallelOrchestrator {
  private engine: SubAgentEngine;
  private activeTasks: Map<string, AbortController> = new Map();

  constructor() {
    this.engine = getSubAgentEngine();
  }

  /**
   * 并行执行一组子任务
   *
   * @param tasks      子任务数组
   * @param systemPrompt  公共系统提示词
   * @param model         可选模型覆盖
   * @returns 每个子任务的执行结果
   */
  async executeAll(
    tasks: SubTask[],
    systemPrompt?: string,
    model?: string
  ): Promise<SubTaskResult[]> {
    // 1. 发射并行开始事件
    const startPayload: ParallelStartData = {
      totalTasks: tasks.length,
      tasks: tasks.map((t) => ({
        description: t.description,
        agentType: t.subagent_type,
        name: t.name,
      })),
    };
    globalEventBus.publish(OrchestrationEventType.PARALLEL_START, startPayload);

    // 2. 并行执行所有子任务（异常隔离）
    const results = await Promise.allSettled(
      tasks.map((task) => this.executeSingle(task, systemPrompt, model))
    );

    // 3. 汇总结果
    const finalResults: SubTaskResult[] = results.map((r, idx) => {
      if (r.status === 'fulfilled') {
        return r.value;
      }
      const task = tasks[idx];
      return {
        taskId: task.id || `task-${idx}`,
        agentId: `parallel-${idx}-failed`,
        name: task.name || task.description,
        description: task.description,
        success: false,
        output: '',
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        durationMs: 0,
      };
    });

    // 4. 发射并行完成事件
    const completedCount = finalResults.filter((r) => r.success).length;
    const endPayload: ParallelEndData = {
      totalTasks: tasks.length,
      completedTasks: completedCount,
      failedTasks: tasks.length - completedCount,
    };
    globalEventBus.publish(OrchestrationEventType.PARALLEL_END, endPayload);

    return finalResults;
  }

  /**
   * 执行单个子任务
   */
  private async executeSingle(
    task: SubTask,
    systemPrompt?: string,
    model?: string
  ): Promise<SubTaskResult> {
    const agentId = `parallel-${randomUUID().substring(0, 8)}`;
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeTasks.set(agentId, abortController);

    // 发射子任务开始事件
    const taskStartPayload: ParallelTaskStartData = {
      agentId,
      taskName: task.name || task.description,
      description: task.description,
    };
    globalEventBus.publish(
      OrchestrationEventType.PARALLEL_TASK_START,
      taskStartPayload
    );

    try {
      // 构建请求参数
      const engineInput = {
        agentId,
        systemPrompt:
          systemPrompt || `你是一个专业助手，负责：${task.description}`,
        messages: [{ role: 'user' as const, content: task.prompt }],
        tools: [] as ToolDefinition[],
        toolInstances: new Map<string, Tool>(),
        maxTurns: 20,
        model: model || task.model,
      };

      // 通过 SubAgentEngine 执行
      const result = await this.engine.execute(engineInput);
      const durationMs = Date.now() - startTime;

      // 发射子任务完成事件
      const taskCompletePayload: ParallelTaskCompleteData = {
        agentId,
        taskName: task.name || task.description,
        success: result.completed,
        output: result.output,
        durationMs,
      };
      globalEventBus.publish(
        OrchestrationEventType.PARALLEL_TASK_COMPLETE,
        taskCompletePayload
      );

      return {
        taskId: task.id || agentId,
        agentId,
        name: task.name || task.description,
        description: task.description,
        success: result.completed,
        output: result.output,
        durationMs,
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // 发射子任务失败事件
      const taskFailPayload: ParallelTaskCompleteData = {
        agentId,
        taskName: task.name || task.description,
        success: false,
        error: errorMessage,
        durationMs,
      };
      globalEventBus.publish(
        OrchestrationEventType.PARALLEL_TASK_COMPLETE,
        taskFailPayload
      );

      return {
        taskId: task.id || agentId,
        agentId,
        name: task.name || task.description,
        description: task.description,
        success: false,
        output: '',
        error: errorMessage,
        durationMs,
      };
    } finally {
      this.activeTasks.delete(agentId);
    }
  }

  /**
   * 取消所有正在执行的任务
   */
  abortAll(): void {
    for (const controller of this.activeTasks.values()) {
      controller.abort();
    }
    this.activeTasks.clear();
  }

  /**
   * 获取当前活跃任务数
   */
  getActiveCount(): number {
    return this.activeTasks.size;
  }
}
