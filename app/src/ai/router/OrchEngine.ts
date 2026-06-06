// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * OrchEngine — 子任务编排执行引擎
 *
 * Phase 3 自动编排的执行层。
 * 接收 TaskDecomposer 的分解结果，按依赖顺序执行子任务，
 * 每个子任务通过 SmartRouter 独立路由，支持并行执行无依赖任务。
 */

// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type { AIProvider } from '../providers/AIProvider.js';
import type { RouteDecision, RouterTier } from './types.js';
import { TaskDecomposer } from './TaskDecomposer.js';
import type { DecompositionResult, SubTask } from './TaskDecomposer.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 编排结果
 */
export interface OrchResult {
  /** 原始消息 */
  originalMessage: string;
  /** 分解结果 */
  decomposition: DecompositionResult;
  /** 各子任务执行结果 */
  subTaskResults: SubTaskResult[];
  /** 合成后的最终响应 */
  finalResponse: string;
  /** 是否全部成功 */
  allSucceeded: boolean;
}

/**
 * 单子任务执行结果
 */
export interface SubTaskResult {
  /** 子任务 ID */
  subTaskId: string;
  /** 路由决策 */
  decision: RouteDecision;
  /** LLM 响应内容 */
  response: string;
  /** 是否成功 */
  success: boolean;
  /** 耗时（ms） */
  durationMs: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 合成 prompt：将多个子任务结果合并为最终响应
 */
const SYNTHESIZE_PROMPT = `You are a response synthesis expert. Combine the results of multiple subtasks into a coherent final response.

Original user request: {MESSAGE}

Subtask results:
{RESULTS}

Synthesize a complete, well-structured response that addresses the original request.`;

/**
 * OrchEngine 执行子任务编排
 */
export class OrchEngine {
  /**
   * @param taskDecomposer - 任务分解器
   * @param decideFn - SmartRouter.decide 的包装函数，根据消息+可选的子任务 hint 返回 RouteDecision
   * @param executeFn - 执行函数，根据决策调用对应 provider
   * @param synthesizeProvider - 可选：合成最终响应的 Provider（不指定则直接拼接）
   */
  constructor(
    private taskDecomposer: TaskDecomposer,
    private decideFn: (message: string, options?: { tierHint?: RouterTier; skipJudge?: boolean; sessionId?: string }) => Promise<RouteDecision>,
    private executeFn: (decision: RouteDecision, message: string) => Promise<string>,
    private synthesizeProvider?: AIProvider
  ) {}

  /**
   * 编排执行主入口
   *
   * 流程：分解 → 按依赖顺序执行子任务 → 合成最终响应
   *
   * @param message - 用户原始消息
   * @returns 编排结果
   */
  async orchestrate(message: string): Promise<OrchResult> {
    // 1. 分解
    const decomposition = await this.taskDecomposer.decompose(message);
    logger.info('OrchEngine: 分解完成', {
      mainTier: decomposition.mainTier,
      subTaskCount: decomposition.subTasks.length,
    });

    // 2. 执行子任务（按依赖顺序）
    const subTaskResults = await this.executeSubTasks(message, decomposition.subTasks);

    // 3. 检查是否全部成功
    const allSucceeded = subTaskResults.every((r) => r.success);

    // 4. 合成最终响应
    let finalResponse: string;
    if (allSucceeded && subTaskResults.length > 1) {
      finalResponse = await this.synthesizeResponse(message, subTaskResults);
    } else if (subTaskResults.length === 1) {
      finalResponse = subTaskResults[0].response;
    } else {
      finalResponse = subTaskResults
        .filter((r) => r.success)
        .map((r) => r.response)
        .join('\n\n');
    }

    return {
      originalMessage: message,
      decomposition,
      subTaskResults,
      finalResponse,
      allSucceeded,
    };
  }

  /**
   * 按依赖顺序执行子任务
   * 使用拓扑排序：无依赖的任务可并行执行
   */
  private async executeSubTasks(
    message: string,
    subTasks: SubTask[]
  ): Promise<SubTaskResult[]> {
    const results = new Map<string, SubTaskResult>();
    const pending = new Set(subTasks.map((t) => t.id));
    const maxIterations = subTasks.length * 2; // 防止死循环
    let iterations = 0;

    while (pending.size > 0 && iterations < maxIterations) {
      iterations++;
      const batch = [...pending].filter((id) => {
        const task = subTasks.find((t) => t.id === id)!;
        return task.dependsOn.every((depId) => results.has(depId));
      });

      if (batch.length === 0) {
        // 依赖无法满足（死锁或缺失依赖）
        logger.warning('OrchEngine: 依赖无法满足，剩余任务跳过', {
          pending: [...pending],
        });
        break;
      }

      // 并行执行无依赖冲突的任务
      const batchResults = await Promise.all(
        batch.map(async (taskId) => {
          const task = subTasks.find((t) => t.id === taskId)!;
          return this.executeSingleTask(message, task);
        })
      );

      for (const result of batchResults) {
        results.set(result.subTaskId, result);
        pending.delete(result.subTaskId);
      }
    }

    // 按原始顺序返回
    return subTasks.map((t) => {
      const result = results.get(t.id);
      if (!result) {
        return {
          subTaskId: t.id,
          decision: { provider: '', model: '', tier: 'medium', reason: '未执行' },
          response: '',
          success: false,
          durationMs: 0,
          error: '依赖无法满足，跳过执行',
        };
      }
      return result;
    });
  }

  /**
   * 执行单个子任务
   */
  private async executeSingleTask(
    message: string,
    task: SubTask
  ): Promise<SubTaskResult> {
    const startTime = Date.now();

    try {
      // 子任务的上下文：原始消息 + 子任务描述
      const contextMessage = task.description
        ? `[子任务 ${task.id}]\n原始请求: ${message}\n\n子任务描述: ${task.description}`
        : message;

      // 通过 SmartRouter 决策（可传递 tier hint）
      const decision = await this.decideFn(contextMessage, {
        tierHint: task.tier,
      });

      // 执行
      const response = await this.executeFn(decision, contextMessage);

      const durationMs = Date.now() - startTime;

      logger.debug('OrchEngine: 子任务完成', {
        taskId: task.id,
        tier: decision.tier,
        model: decision.model,
        durationMs,
      });

      return {
        subTaskId: task.id,
        decision,
        response,
        success: true,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      logger.warning('OrchEngine: 子任务失败', {
        taskId: task.id,
        error,
        durationMs,
      });

      return {
        subTaskId: task.id,
        decision: { provider: '', model: '', tier: 'medium', reason: '执行失败' },
        response: '',
        success: false,
        durationMs,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 合成多个子任务结果为最终响应
   */
  private async synthesizeResponse(
    message: string,
    results: SubTaskResult[]
  ): Promise<string> {
    // 如果只有一个子任务成功，直接返回
    const successful = results.filter((r) => r.success);
    if (successful.length <= 1) {
      return successful.length === 1 ? successful[0].response : '所有子任务均失败';
    }

    // 有合成 Provider → LLM 合成
    if (this.synthesizeProvider) {
      try {
        const resultsText = successful
          .map((r) => `--- ${r.subTaskId} (${r.decision.tier}, ${r.decision.model}) ---\n${r.response}`)
          .join('\n\n');

        const prompt = SYNTHESIZE_PROMPT
          .replace('{MESSAGE}', message)
          .replace('{RESULTS}', resultsText);

        const response = await this.synthesizeProvider.chat([
          { role: 'user', content: prompt },
        ]);

        return response.content;
      } catch (error) {
        logger.warning('OrchEngine: 合成失败，使用简单拼接', { error });
      }
    }

    // 无合成 Provider 或合成失败 → 简单拼接
    return successful
      .map((r) => r.response)
      .join('\n\n');
  }
}
