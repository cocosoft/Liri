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
/**
 * DreamPhaseManager — 梦境阶段管理器
 *
 * 管理梦境三阶段（light → deep → rem）的执行顺序和门控条件。
 */

import type { DreamPhase } from './types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface PhaseResult {
  phase: DreamPhase;
  success: boolean;
  error?: string;
}

export type PhaseExecutor = (phase: DreamPhase) => Promise<PhaseResult>;

export class DreamPhaseManager {
  private readonly phaseOrder: DreamPhase[] = ['light', 'deep', 'rem'];

  /**
   * 按顺序执行梦境阶段
   * @param executor 阶段执行函数
   * @param startFrom 从哪个阶段开始（默认从 light 开始）
   */
  async executePhases(
    executor: PhaseExecutor,
    startFrom: DreamPhase = 'light'
  ): Promise<PhaseResult[]> {
    const results: PhaseResult[] = [];
    const startIndex = this.phaseOrder.indexOf(startFrom);

    if (startIndex === -1) {
      logger.warn(`[DreamPhaseManager] 未知阶段: ${startFrom}，从 light 开始`);
    }

    const phases = startIndex >= 0
      ? this.phaseOrder.slice(startIndex)
      : this.phaseOrder;

    logger.info(`[DreamPhaseManager] 开始执行阶段: ${phases.join(' → ')}`);

    for (const phase of phases) {
      logger.info(`[DreamPhaseManager] 进入阶段: ${phase}`);
      const result = await executor(phase);
      results.push(result);

      if (!result.success) {
        logger.warn(`[DreamPhaseManager] 阶段 ${phase} 失败: ${result.error}，停止后续阶段`);
        break;
      }

      logger.info(`[DreamPhaseManager] 阶段 ${phase} 完成`);
    }

    logger.info(`[DreamPhaseManager] 全部阶段执行完毕: ${results.length}/${phases.length} 成功`);
    return results;
  }

  /** 获取所有阶段 */
  getPhases(): DreamPhase[] {
    return [...this.phaseOrder];
  }
}
