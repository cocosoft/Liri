// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-10（2026-10-17）：TAOR 单轮进展统计与收益递减调用收口。
 *
 * 从 `TAORLoop` 外移的目的：
 * 1. 把「工具结果/产物」计数与“取本轮增量”集中在一处，避免调用点重复；
 * 2. 控制 `TAORLoop.ts` 行数（R04-001 ≤2000）。
 */
import { WRITE_TOOLS } from '../tool-constants.js';

export interface DiminishingBudget {
  checkDiminishingReturns(
    tokens: number,
    elapsedMs?: number,
    progress?: { newToolResults?: number; newArtifacts?: number }
  ): { diminishing: boolean; reason?: string };
}

export class RoundProgressTracker {
  failed = 0;
  private successful = 0;
  private artifacts = 0;
  private lastSuccessful = 0;
  private lastArtifacts = 0;

  /** 记录一次工具结果（失败/成功；成功且为写类工具时计产物）。 */
  record(toolName: string, failed: boolean, stats?: Map<string, number>): void {
    if (stats) stats.set(toolName, (stats.get(toolName) ?? 0) + 1);
    if (failed) {
      this.failed++;
      return;
    }
    this.successful++;
    if (WRITE_TOOLS.has(toolName)) this.artifacts++;
  }

  /** 取本轮新增进展并推进基线。 */
  takeDelta(): { newToolResults: number; newArtifacts: number } {
    const delta = {
      newToolResults: this.successful - this.lastSuccessful,
      newArtifacts: this.artifacts - this.lastArtifacts,
    };
    this.lastSuccessful = this.successful;
    this.lastArtifacts = this.artifacts;
    return delta;
  }

  /** 调用收益递减判定（自动带上本轮进展）。 */
  check(
    budget: DiminishingBudget,
    tokens: number
  ): { diminishing: boolean; reason?: string } {
    return budget.checkDiminishingReturns(tokens, undefined, this.takeDelta());
  }

  reset(): void {
    this.failed = 0;
    this.successful = 0;
    this.artifacts = 0;
    this.lastSuccessful = 0;
    this.lastArtifacts = 0;
  }
}
