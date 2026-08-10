/**
 * BatchRunner — 批量并行处理引擎
 *
 * P2-9: 对标 hermes-agent BatchRunner（多进程 Pool + checkpoint 断点续跑）。
 * 用于知识编译、FAQ 批量导入、数据迁移等大批量耗时操作。
 *
 * 特性：
 *   - Worker pool（可配置并行度）
 *   - Checkpoint 断点续跑（resume）
 *   - 进度回调
 *   - 结果聚合
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveDataSubDir } from '@modules/core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const logger = getLogger('tasks:batchRunner');

// ==========================================
// Types
// ==========================================

export interface BatchItem<TInput = unknown> {
  id: string;
  input: TInput;
}

export interface BatchResult<TOutput = unknown> {
  id: string;
  status: 'success' | 'failed' | 'skipped';
  output?: TOutput;
  error?: string;
  durationMs: number;
  startedAt: number;
  completedAt: number;
}

export interface BatchConfig {
  /** 最大并行度，默认 4 */
  concurrency: number;
  /** 失败后是否继续 */
  continueOnError: boolean;
  /** 超时（ms），0 = 不限制 */
  timeoutMs: number;
  /** checkpoint 文件路径 */
  checkpointPath?: string;
}

export interface BatchProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
}

export type BatchWorker<TInput, TOutput> = (
  item: BatchItem<TInput>
) => Promise<TOutput>;

// ==========================================
// Checkpoint
// ==========================================

interface CheckpointData {
  completed: string[];
  lastProcessedId: string | null;
  startedAt: number;
}

function loadCheckpoint(path: string): CheckpointData | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as CheckpointData;
  } catch (err) {
    handleError(err, { module: 'tasks:batchRunner', action: 'loadCheckpoint' });
    return null;
  }
}

function saveCheckpoint(
  path: string,
  completed: string[],
  lastId: string | null,
  startedAt: number
): void {
  try {
    const dir = path.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ completed, lastProcessedId: lastId, startedAt }),
      'utf-8'
    );
  } catch (err) {
    handleError(err, { module: 'tasks:batchRunner', action: 'saveCheckpoint' });
    logger.warn('batchRunner:checkpoint_write_failed', { path });
  }
}

// ==========================================
// BatchRunner
// ==========================================

export class BatchRunner<TInput = unknown, TOutput = unknown> {
  private config: Required<BatchConfig>;
  private results = new Map<string, BatchResult<TOutput>>();
  private completed = new Set<string>();
  private startedAt = 0;

  constructor(config?: Partial<BatchConfig>) {
    this.config = {
      concurrency: config?.concurrency ?? 4,
      continueOnError: config?.continueOnError ?? true,
      timeoutMs: config?.timeoutMs ?? 0,
      checkpointPath: config?.checkpointPath ?? '',
    };
  }

  /**
   * 执行批量任务
   * @param items 任务列表
   * @param worker 工作函数
   * @param onProgress 进度回调
   */
  async run(
    items: BatchItem<TInput>[],
    worker: BatchWorker<TInput, TOutput>,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<{ results: BatchResult<TOutput>[]; progress: BatchProgress }> {
    this.startedAt = Date.now();

    // Resume from checkpoint
    if (this.config.checkpointPath) {
      const ckpt = loadCheckpoint(this.config.checkpointPath);
      if (ckpt) {
        for (const id of ckpt.completed) this.completed.add(id);
        logger.info('batchRunner:resumed', {
          total: items.length,
          alreadyCompleted: this.completed.size,
        });
      }
    }

    const toProcess = items.filter((item) => !this.completed.has(item.id));

    // Process in parallel batches
    for (let i = 0; i < toProcess.length; i += this.config.concurrency) {
      const batch = toProcess.slice(i, i + this.config.concurrency);

      const batchPromises = batch.map((item) => this.processItem(item, worker));

      const settled = await Promise.allSettled(batchPromises);

      // Save checkpoint after each batch
      if (this.config.checkpointPath) {
        saveCheckpoint(
          this.config.checkpointPath,
          [...this.completed],
          batch[batch.length - 1]?.id ?? null,
          this.startedAt
        );
      }

      if (onProgress) {
        onProgress(this.getProgress(items.length));
      }
    }

    const results = items.map(
      (item) =>
        this.results.get(item.id) ?? {
          id: item.id,
          status: 'skipped' as const,
          durationMs: 0,
          startedAt: 0,
          completedAt: 0,
        }
    );

    logger.info('batchRunner:completed', {
      total: items.length,
      succeeded: results.filter((r) => r.status === 'success').length,
      failed: results.filter((r) => r.status === 'failed').length,
      durationMs: Date.now() - this.startedAt,
    });

    return { results, progress: this.getProgress(items.length) };
  }

  private async processItem(
    item: BatchItem<TInput>,
    worker: BatchWorker<TInput, TOutput>
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      let output: TOutput;
      if (this.config.timeoutMs > 0) {
        const promise = worker(item);
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout: ${this.config.timeoutMs}ms`)),
            this.config.timeoutMs
          )
        );
        output = await Promise.race([promise, timeout]);
      } else {
        output = await worker(item);
      }

      this.results.set(item.id, {
        id: item.id,
        status: 'success',
        output,
        durationMs: Date.now() - startedAt,
        startedAt,
        completedAt: Date.now(),
      });
      this.completed.add(item.id);
    } catch (err) {
      handleError(err, { module: 'tasks:batchRunner', action: 'runItem' });
      this.results.set(item.id, {
        id: item.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        startedAt,
        completedAt: Date.now(),
      });
      if (!this.config.continueOnError) throw err;
    }
  }

  private getProgress(total: number): BatchProgress {
    const elapsed = Date.now() - this.startedAt;
    const done = this.completed.size;
    const rate = elapsed > 0 ? done / (elapsed / 1000) : 0;
    const remaining = (total - done) / Math.max(rate, 0.001);
    const succeeded = [...this.results.values()].filter(
      (r) => r.status === 'success'
    ).length;
    const failed = [...this.results.values()].filter(
      (r) => r.status === 'failed'
    ).length;

    return {
      total,
      completed: done,
      succeeded,
      failed,
      skipped: 0,
      elapsedMs: elapsed,
      estimatedRemainingMs: Math.ceil(remaining),
    };
  }
}
