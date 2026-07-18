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
 * TaskDecomposer — 复杂消息拆分为子任务
 *
 * Phase 3 自动编排的核心组件。
 * 将用户复杂请求通过 LLM 分解为多个可独立路由的子任务，
 * 每个子任务可分配不同的 tier，支持依赖关系编排。
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
import type { RouterTier, JudgeResult } from './types.js';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'ai:task-decomposer',
});

/**
 * 子任务定义
 */
export interface SubTask {
  /** 子任务唯一标识 */
  id: string;
  /** 子任务描述/提示词 */
  description: string;
  /** 可选：强制指定 tier，不指定则由 Judge 自动分配 */
  tier?: RouterTier;
  /** 依赖的子任务 ID 列表（这些子任务完成后才能执行本任务） */
  dependsOn: string[];
  /** 执行状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 执行结果 */
  result?: string;
}

/**
 * 分解结果
 */
export interface DecompositionResult {
  /** 整体任务的主 tier */
  mainTier: RouterTier;
  /** 拆分子任务列表 */
  subTasks: SubTask[];
  /** 分解推理过程 */
  reasoning: string;
}

/** LLM 分解 prompt */
const DECOMPOSE_PROMPT = `You are a task decomposition expert. Break the user's request into subtasks.

Rules:
1. Each subtask should be self-contained and independently executable
2. Maximum 5 subtasks
3. Identify dependencies between subtasks (e.g., subtask B depends on subtask A's result)
4. Assign a complexity tier to each subtask: simple, medium, complex, reasoning
5. The overall task also gets a main tier

Respond with ONLY a JSON object:
{
  "mainTier": "simple|medium|complex|reasoning",
  "reasoning": "brief explanation of decomposition strategy",
  "subTasks": [
    {
      "id": "step-1",
      "description": "clear description of what this subtask does",
      "tier": "simple|medium|complex|reasoning",
      "dependsOn": []
    }
  ]
}

User message: {MESSAGE}`;

/**
 * TaskDecomposer 分解复杂请求为结构化子任务
 */
export class TaskDecomposer {
  /**
   * @param classifyFn - Judge 分类函数，用于单消息 tier 分配
   * @param decomposerProvider - 可选：用于分解的 LLM Provider（不指定则只做简单分解）
   */
  constructor(
    private classifyFn: ((message: string) => Promise<JudgeResult>) | null,
    private decomposerProvider?: AIProvider
  ) {}

  /**
   * 分解主入口
   *
   * @param message - 用户原始消息
   * @returns 分解结果
   */
  async decompose(message: string): Promise<DecompositionResult> {
    // 有 decomposerProvider → LLM 分解
    if (this.decomposerProvider) {
      try {
        return await this.llmDecompose(message);
      } catch (error) {
        await handleError(error, {
          module: 'ai:taskDecomposer',
          action: 'decompose',
        });
        logger.warning('TaskDecomposer: LLM 分解失败，回退简单分解', { error });
      }
    }

    // 无 decomposerProvider 或 LLM 失败 → 简单分解（单子任务）
    return this.simpleDecompose(message);
  }

  /**
   * LLM 驱动的任务分解
   */
  private async llmDecompose(message: string): Promise<DecompositionResult> {
    const prompt = DECOMPOSE_PROMPT.replace('{MESSAGE}', message);

    const response = await this.decomposerProvider!.chat([
      { role: 'user', content: prompt },
    ]);

    return this.parseDecomposition(response.content);
  }

  /**
   * 简单分解（当做单任务处理）
   */
  private async simpleDecompose(message: string): Promise<DecompositionResult> {
    let tier: RouterTier = 'medium';

    if (this.classifyFn) {
      try {
        const result = await this.classifyFn(message);
        tier = result.tier;
      } catch (err) {
        // 使用默认 tier
      }
    }

    return {
      mainTier: tier,
      subTasks: [
        {
          id: 'step-1',
          description: message,
          dependsOn: [],
          status: 'pending',
        },
      ],
      reasoning: '简单模式：未配置分解 Provider，整体任务单步执行',
    };
  }

  /**
   * 解析 LLM 返回的 JSON 分解结果
   */
  private parseDecomposition(content: string): DecompositionResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*"subTasks"[\s\S]*\}/);
      const json = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(json);

      const subTasks: SubTask[] = (parsed.subTasks || []).map(
        (st: any, index: number) => ({
          id: st.id || `step-${index + 1}`,
          description: st.description || '',
          tier: this.normalizeTier(st.tier),
          dependsOn: Array.isArray(st.dependsOn) ? st.dependsOn : [],
          status: 'pending' as const,
        })
      );

      return {
        mainTier: this.normalizeTier(parsed.mainTier),
        subTasks,
        reasoning: parsed.reasoning || 'LLM 自动分解',
      };
    } catch (error) {
      handleError(error, {
        module: 'ai:taskDecomposer',
        action: 'parseDecomposition',
      });
      logger.warning('TaskDecomposer: 解析分解结果失败', { error });
      throw error;
    }
  }

  /**
   * 归一化 tier
   */
  private normalizeTier(tier: string): RouterTier {
    const normalized = tier?.toLowerCase().trim() || '';
    if (['simple', 'medium', 'complex', 'reasoning'].includes(normalized)) {
      return normalized as RouterTier;
    }
    return 'medium';
  }
}
