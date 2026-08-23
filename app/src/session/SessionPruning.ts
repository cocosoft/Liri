/**
 * 会话修剪策略
 * 按时间/大小自动修剪旧会话
 * 对齐 OpenClaw config/sessions/store-pruning.ts
 */

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';

const logger = getLogger('session:pruning');

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

import { resolveSessionsDir } from '@modules/core';

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

      // M5-fix: 兼容两种布局——
      //  旧布局：顶层 *.json/*.jsonl（会话文件散放）
      //  新布局：{sessionId}/session.json 子目录（修剪对象是目录）
      const items = readdirSync(this.config.sessionsDir)
        .map((name) => {
          const fullPath = join(this.config.sessionsDir, name);
          const st = statSync(fullPath);
          // 新布局：目录型会话（取目录内 session.json 的 mtime 作参考）
          const isDirSession =
            st.isDirectory() && existsSync(join(fullPath, 'session.json'));
          // 旧布局：顶层会话文件
          const isLegacyFile =
            st.isFile() &&
            (name.endsWith('.json') ||
              name.endsWith('.jsonl') ||
              name.endsWith('.transcript.jsonl'));
          if (!isDirSession && !isLegacyFile) return null;
          return { name, path: fullPath, size: st.size, mtimeMs: st.mtimeMs };
        })
        .filter((i): i is NonNullable<typeof i> => i !== null)
        .sort((a, b) => a.mtimeMs - b.mtimeMs); // 最旧的在前

      let totalSize = items.reduce((s, f) => s + f.size, 0);

      for (const item of items) {
        let shouldRemove = false;

        // 超龄
        if (item.mtimeMs < now - maxAgeMs) {
          shouldRemove = true;
        }
        // 数量超限
        if (items.length - result.sessionsPruned > this.config.maxSessions) {
          shouldRemove = true;
        }
        // 大小超限
        if (totalSize > maxSizeBytes) {
          shouldRemove = true;
        }

        if (shouldRemove) {
          if (!this.config.dryRun) {
            try {
              // M5-fix: 软删除 —— rename 到 .trash 而非物理删除（unlinkSync），
              // 保留误剪恢复路径，对齐新链软删除语义。
              const trashRoot = join(this.config.sessionsDir, '.trash');
              mkdirSync(trashRoot, { recursive: true });
              renameSync(
                item.path,
                join(trashRoot, `${item.name}-${Date.now()}`)
              );
            } catch (error) {
              result.errors.push(`${item.name}: ${String(error)}`);
              continue;
            }
          }
          result.sessionsPruned++;
          result.bytesFreed += item.size;
          result.prunedSessions.push(item.name);
          totalSize -= item.size;
        }
      }

      if (result.sessionsPruned > 0) {
        logger.info(
          `会话修剪完成: 移除 ${result.sessionsPruned} 个会话, 释放 ${(result.bytesFreed / 1024 / 1024).toFixed(2)} MB${this.config.dryRun ? ' (DRY-RUN)' : ''}`
        );
      }
    } catch (error) {
      result.errors.push(`修剪失败: ${String(error)}`);
      handleError(error, {
        module: 'sessions:pruning',
        action: '会话修剪失败',
      });
    }

    return result;
  }

  updateConfig(config: Partial<PruningConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
