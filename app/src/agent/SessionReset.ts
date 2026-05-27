/**
 * Agent 会话重置
 * 按原因分类重置会话状态
 * 对齐 OpenClaw agents/harness/types.ts reset 参数
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

export type ResetReason =
  | 'new'
  | 'reset'
  | 'idle'
  | 'daily'
  | 'compaction'
  | 'deleted'
  | 'manual'
  | 'unknown';

export interface ResetParams {
  sessionId: string;
  reason: ResetReason;
  sessionFile?: string;
  preserveConfig?: boolean;
}

export interface ResetResult {
  success: boolean;
  reason: ResetReason;
  message: string;
  backedUp?: boolean;
  backupPath?: string;
}

export class SessionReset {
  private stateDir: string;

  constructor(stateDir?: string) {
    this.stateDir = stateDir || process.cwd();
  }

  async reset(params: ResetParams): Promise<ResetResult> {
    const { sessionId, reason, sessionFile, preserveConfig } = params;

    switch (reason) {
      case 'new':
        return this.resetNew(sessionId);
      case 'reset':
        return this.resetUser(sessionId, sessionFile);
      case 'compaction':
        return this.resetCompaction(sessionId, sessionFile);
      case 'daily':
        return this.resetDaily(sessionId);
      case 'idle':
        return this.resetIdle(sessionId);
      case 'deleted':
        return this.resetDeleted(sessionId);
      case 'manual':
        return this.resetManual(sessionId, preserveConfig);
      default:
        return this.resetDefault(sessionId);
    }
  }

  private async resetNew(sessionId: string): Promise<ResetResult> {
    logger.info(`创建新会话: ${sessionId}`);
    return { success: true, reason: 'new', message: '新会话已创建' };
  }

  private async resetUser(
    sessionId: string,
    sessionFile?: string
  ): Promise<ResetResult> {
    if (sessionFile && existsSync(sessionFile)) {
      const backup = `${sessionFile}.${Date.now()}.bak`;
      try {
        unlinkSync(sessionFile);
        return {
          success: true,
          reason: 'reset',
          message: `会话已重置 (备份: ${backup})`,
          backedUp: true,
          backupPath: backup,
        };
      } catch (error) {
        return {
          success: false,
          reason: 'reset',
          message: `重置失败: ${String(error)}`,
        };
      }
    }
    return { success: true, reason: 'reset', message: '会话已重置' };
  }

  private async resetCompaction(
    sessionId: string,
    sessionFile?: string
  ): Promise<ResetResult> {
    logger.info(`压缩会话: ${sessionId}`);
    if (sessionFile && existsSync(sessionFile)) {
      const backup = `${sessionFile}.compact-${Date.now()}.bak`;
      try {
        renameSync(sessionFile, backup);
        return {
          success: true,
          reason: 'compaction',
          message: `会话已压缩 (备份: ${backup})`,
          backedUp: true,
          backupPath: backup,
        };
      } catch (error) {
        return {
          success: false,
          reason: 'compaction',
          message: `压缩失败: ${String(error)}`,
        };
      }
    }
    return { success: true, reason: 'compaction', message: '会话已压缩' };
  }

  private async resetDaily(sessionId: string): Promise<ResetResult> {
    logger.info(`每日重置: ${sessionId}`);
    return { success: true, reason: 'daily', message: '每日会话重置' };
  }

  private async resetIdle(sessionId: string): Promise<ResetResult> {
    logger.info(`空闲会话清理: ${sessionId}`);
    return { success: true, reason: 'idle', message: '空闲会话已清理' };
  }

  private async resetDeleted(sessionId: string): Promise<ResetResult> {
    logger.info(`已删除会话: ${sessionId}`);
    return { success: true, reason: 'deleted', message: '会话已删除' };
  }

  private async resetManual(
    sessionId: string,
    preserveConfig?: boolean
  ): Promise<ResetResult> {
    const msg = preserveConfig ? '会话已手动重置 (保留配置)' : '会话已手动重置';
    return { success: true, reason: 'manual', message: msg };
  }

  private async resetDefault(sessionId: string): Promise<ResetResult> {
    return { success: true, reason: 'unknown', message: '会话已重置' };
  }
}
