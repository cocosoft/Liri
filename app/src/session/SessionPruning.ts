/**
 * 会话修剪策略
 * 按时间/大小自动修剪旧会话
 * 对齐 OpenClaw config/sessions/store-pruning.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

export interface PruningConfig {
  sessionsDir: string;
  maxSessions: number;
  maxAgeDays: number;
  maxSizeMB: number;
  dryRun: boolean;
}

export interface PruningResult {
  sessionsPruned: number;
  bytesFreed: number;
  errors: string[];
  prunedSessions: string[];
}

import { resolveSessionsDir } from '@modules/config/paths';

const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  sessionsDir: resolveSessionsDir(),
  maxSessions: 100,
  maxAgeDays: 90,
  maxSizeMB: 500,
  dryRun: false,
};

export class SessionPruning {
  private config: PruningConfig;

  constructor(config: Partial<PruningConfig> = {}) {
    this.config = { ...DEFAULT_PRUNING_CONFIG, ...config };
  }

  async prune(): Promise<PruningResult> {
    const result: PruningResult = {
      sessionsPruned: 0,
      bytesFreed: 0,
      errors: [],
      prunedSessions: [],
    };

    if (!existsSync(this.config.sessionsDir)) {
      return result;
    }

    try {
      const now = Date.now();
      const maxAgeMs = this.config.maxAgeDays * 24 * 3600 * 1000;
      const maxSizeBytes = this.config.maxSizeMB * 1024 * 1024;

      const files = readdirSync(this.config.sessionsDir)
        .filter(
          (f) =>
            f.endsWith('.json') ||
            f.endsWith('.jsonl') ||
            f.endsWith('.transcript.jsonl')
        )
        .map((f) => {
          const fullPath = join(this.config.sessionsDir, f);
          const st = statSync(fullPath);
          return {
            name: f,
            path: fullPath,
            size: st.size,
            mtimeMs: st.mtimeMs,
          };
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs); // 最旧的在前

      let totalSize = files.reduce((s, f) => s + f.size, 0);

      for (const file of files) {
        let shouldRemove = false;

        // 超龄
        if (file.mtimeMs < now - maxAgeMs) {
          shouldRemove = true;
        }
        // 数量超限
        if (files.length - result.sessionsPruned > this.config.maxSessions) {
          shouldRemove = true;
        }
        // 大小超限
        if (totalSize > maxSizeBytes) {
          shouldRemove = true;
        }

        if (shouldRemove) {
          if (!this.config.dryRun) {
            try {
              unlinkSync(file.path);
            } catch (error) {
              result.errors.push(`${file.name}: ${String(error)}`);
              continue;
            }
          }
          result.sessionsPruned++;
          result.bytesFreed += file.size;
          result.prunedSessions.push(file.name);
          totalSize -= file.size;
        }
      }

      if (result.sessionsPruned > 0) {
        logger.info(
          `会话修剪完成: 移除 ${result.sessionsPruned} 个会话, 释放 ${(result.bytesFreed / 1024 / 1024).toFixed(2)} MB${this.config.dryRun ? ' (DRY-RUN)' : ''}`
        );
      }
    } catch (error) {
      result.errors.push(`修剪失败: ${String(error)}`);
      logger.error('会话修剪失败', error as Error);
    }

    return result;
  }

  updateConfig(config: Partial<PruningConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
