/**
 * 执行守护者 —— 原子操作包装器
 * 所有写操作套用临时文件 + 重命名策略
 * Phase 1 必须包含（方案 §5.1.8）
 */

import * as fs from 'fs';
import { AppError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'doc:execution',
  level: LogLevel.INFO,
});

/**
 * 执行守护者
 * 对文档的 create/edit/render 操作提供原子性保证
 */
export class ExecutionGuardian {
  /**
   * 原子化写操作
   * 流程：备份 → 写入临时文件 → 成功后重命名 → 失败则回滚
   */
  async guardedWrite(
    operation: 'create' | 'edit' | 'render',
    targetPath: string,
    execute: (tmpPath: string) => Promise<void>
  ): Promise<void> {
    const tmpPath = targetPath + '.tmp';
    const backupPath = targetPath + '.backup';

    // 备份已有文件
    const existed = fs.existsSync(targetPath);
    if (existed) {
      fs.copyFileSync(targetPath, backupPath);
      logger.debug('文件已备份', { target: targetPath, backup: backupPath });
    }

    try {
      // 写入临时文件
      await execute(tmpPath);

      // 验证输出文件存在且非空
      if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
        throw new AppError(
          '操作输出文件为空',
          'EXECUTION' as any,
          'HIGH' as any,
          'DOC_COMMAND_FAILED'
        );
      }

      // 原子重命名
      fs.renameSync(tmpPath, targetPath);

      // 清理备份
      if (existed && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }

      logger.info('文件操作完成', { operation, target: targetPath });
    } catch (err) {
      // 失败回滚
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      if (existed && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, targetPath);
        logger.info('文件已回滚', { target: targetPath });
      }
      throw err;
    }
  }

  /**
   * 撤销最近一次编辑（从 .backup 恢复）
   */
  async undo(targetPath: string): Promise<void> {
    const backupPath = targetPath + '.backup';
    if (!fs.existsSync(backupPath)) {
      throw new AppError(
        '无可用备份，无法撤销',
        'EXECUTION' as any,
        'LOW' as any,
        'DOC_NO_BACKUP'
      );
    }
    fs.renameSync(backupPath, targetPath);
    logger.info('文档已撤销', { target: targetPath });
  }
}
