/**
 * 办公模块审计日志
 * 按日写入 JSONL 格式的审计轨迹
 * 企业合规——记录 who/when/what/result
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';

import type { AuditEntry } from '../types';

const logger = new Logger({
  module: 'doc:audit',
  level: LogLevel.INFO,
});

/** 审计目录 */
function getAuditDir(): string {
  return path.join(resolvePyappHome(), 'office', 'audit');
}

/** 今日审计文件路径 */
function getTodayAuditPath(): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(getAuditDir(), `${today}.jsonl`);
}

/**
 * 办公审计日志器
 * 每条操作追加一行 JSON，成本极低
 */
export class OfficeAuditLogger {
  /**
   * 记录一条审计日志
   * 邮件审计不记录正文内容（脱敏），仅记录收件人数、主题哈希和发送结果
   */
  static async record(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
    const auditEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      // 确保审计目录存在
      const auditDir = getAuditDir();
      if (!fs.existsSync(auditDir)) {
        fs.mkdirSync(auditDir, { recursive: true });
      }

      // 追加一行 JSON
      const jsonLine = JSON.stringify(auditEntry) + '\n';
      fs.appendFileSync(getTodayAuditPath(), jsonLine, 'utf-8');

      logger.debug('审计日志已记录', {
        operation: entry.operation,
        target: entry.target,
        result: entry.result,
      });
    } catch (error) {
      // 审计日志写入失败不阻塞业务
      logger.warn('审计日志写入失败', { error: String(error) });
    }
  }
}
