/**
 * CuratorScheduler — 后台技能维护编排器
 *
 * 对标 Hermes agent/curator.py 的空闲触发调度模式。
 * 当 Agent 空闲且距上次运行超过 intervalHours 时，
 * 检查 skill 生命周期状态并 Fork 后台审查代理。
 *
 * 职责：
 *   1. 空闲触发调度（非定时任务）
 *   2. 状态持久化（app/data/memory/curator-state.json）
 *   3. 调用 SkillLifecycleManager 执行自动状态转换
 *   4. Fork 后台代理进行技能质量审查
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core';

const logger = new Logger({
  module: 'tools:curatorScheduler',
  level: LogLevel.INFO,
});

/** 调度器配置 */
export interface CuratorConfig {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  maxReviewTurns: number;
  staleAfterDays: number;
  archiveAfterDays: number;
}

/** 调度器持久化状态 */
export interface CuratorState {
  lastRunAt: number | null;
  lastRunDurationMs: number | null;
  lastRunSummary: string | null;
  paused: boolean;
  runCount: number;
}

/** 审查结果摘要 */
export interface CuratorReviewResult {
  reviewedCount: number;
  transitions: {
    markedStale: number;
    archived: number;
    reactivated: number;
  };
  summary: string;
  durationMs: number;
}

const DEFAULT_CONFIG: Required<CuratorConfig> = {
  enabled: true,
  intervalHours: 168,
  minIdleHours: 2,
  maxReviewTurns: 30,
  staleAfterDays: 30,
  archiveAfterDays: 90,
};

function defaultState(): CuratorState {
  return {
    lastRunAt: null,
    lastRunDurationMs: null,
    lastRunSummary: null,
    paused: false,
    runCount: 0,
  };
}

function stateFilePath(): string {
  return join(resolvePyappHome(), 'memory', 'curator-state.json');
}

function loadState(): CuratorState {
  const path = stateFilePath();
  if (!existsSync(path)) {
    return defaultState();
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data === 'object' && data !== null) {
      const base = defaultState();
      return { ...base, ...data };
    }
  } catch (e) {
    logger.warn('Failed to read curator state, using defaults', {
      error: String(e),
    });
  }
  return defaultState();
}

function saveState(state: CuratorState): void {
  const path = stateFilePath();
  try {
    const dir = path.substring(0, path.lastIndexOf('\\'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('Failed to save curator state', { error: String(e) });
  }
}

export class CuratorScheduler {
  private config: CuratorConfig;
  private state: CuratorState;

  constructor(config: Partial<CuratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = loadState();
  }

  isEnabled(): boolean {
    return this.config.enabled && !this.state.paused;
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  isPaused(): boolean {
    return this.state.paused;
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused;
    saveState(this.state);
  }

  getState(): CuratorState {
    return { ...this.state };
  }

  getConfig(): CuratorConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<CuratorConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  shouldRunNow(now: number = Date.now()): boolean {
    if (!this.config.enabled) {
      return false;
    }
    if (this.state.paused) {
      return false;
    }

    if (this.state.lastRunAt === null) {
      this.state.lastRunAt = now;
      this.state.lastRunSummary =
        '首次运行已标记 — 将在经过一个 interval 后执行首次审查；可手动触发立即运行';
      saveState(this.state);
      return false;
    }

    const elapsed = now - this.state.lastRunAt;
    const intervalMs = this.config.intervalHours * 60 * 60 * 1000;
    return elapsed >= intervalMs;
  }

  async runReview(
    reviewFn: () => Promise<CuratorReviewResult>
  ): Promise<CuratorReviewResult | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const startTime = Date.now();
    let result: CuratorReviewResult;

    try {
      result = await reviewFn();
    } catch (e) {
      await handleError(e, { module: 'tools:curator', action: 'review' });
      return null;
    }

    result.durationMs = Date.now() - startTime;
    this.state.lastRunAt = Date.now();
    this.state.lastRunDurationMs = result.durationMs;
    this.state.lastRunSummary = result.summary;
    this.state.runCount++;
    saveState(this.state);

    logger.info('Curator review completed', {
      runCount: this.state.runCount,
      durationMs: result.durationMs,
      reviewedCount: result.reviewedCount,
      transitions: result.transitions,
    });

    return result;
  }

  resetState(): void {
    this.state = defaultState();
    saveState(this.state);
  }
}
