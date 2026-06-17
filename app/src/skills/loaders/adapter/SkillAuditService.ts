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
 * SkillAuditService
 * 通用技能操作审计日志服务，记录所有技能安装、卸载、更新、启用/禁用等操作。
 * 审计日志写入 <SKILLS_DIR>/audit/ 目录，JSON Lines 格式。
 */

import { join } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 审计操作类型
 */
export enum SkillAuditAction {
  INSTALL = 'skill:installed',
  UNINSTALL = 'skill:uninstalled',
  UPDATE = 'skill:updated',
  ENABLE = 'skill:enabled',
  DISABLE = 'skill:disabled',
  INSTALL_FAILED = 'skill:install_failed',
  UPDATE_FAILED = 'skill:update_failed',
  SEARCH = 'skill:search',
}

/**
 * 审计日志条目
 */
export interface SkillAuditEntry {
  id: string;
  timestamp: number;
  action: SkillAuditAction;
  skillId: string;
  skillName: string;
  skillVersion?: string;
  details?: Record<string, unknown>;
  success: boolean;
  error?: string;
}

/**
 * SkillAuditService
 * 通用审计服务，以 JSON Lines 格式写入审计日志文件。
 */
export class SkillAuditService {
  private auditDir: string;
  private currentFile: string;
  private entryCounter = 0;

  /**
   * 构造函数
   * @param skillsPath 技能存储根目录
   */
  constructor(skillsPath: string) {
    this.auditDir = join(skillsPath, 'audit');
    this.ensureAuditDir();

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    this.currentFile = join(this.auditDir, `audit-${dateStr}.jsonl`);
  }

  /**
   * 确保审计目录存在
   */
  private ensureAuditDir(): void {
    if (!existsSync(this.auditDir)) {
      mkdirSync(this.auditDir, { recursive: true });
    }
  }

  /**
   * 生成条目 ID
   */
  private generateId(): string {
    this.entryCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.entryCounter.toString(36).padStart(4, '0');
    return `audit-${timestamp}-${counter}`;
  }

  /**
   * 记录审计日志
   */
  private writeEntry(entry: SkillAuditEntry): void {
    try {
      appendFileSync(this.currentFile, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (error) {
      logger.error('写入审计日志失败', error as Error);
    }
  }

  /**
   * 记录技能安装
   */
  recordInstall(
    skillId: string,
    skillName: string,
    version: string,
    success: boolean,
    error?: string
  ): void {
    this.writeEntry({
      id: this.generateId(),
      timestamp: Date.now(),
      action: success
        ? SkillAuditAction.INSTALL
        : SkillAuditAction.INSTALL_FAILED,
      skillId,
      skillName,
      skillVersion: version,
      success,
      error,
    });
  }

  /**
   * 记录技能卸载
   */
  recordUninstall(skillId: string, skillName: string): void {
    this.writeEntry({
      id: this.generateId(),
      timestamp: Date.now(),
      action: SkillAuditAction.UNINSTALL,
      skillId,
      skillName,
      success: true,
    });
  }

  /**
   * 记录技能更新
   */
  recordUpdate(
    skillId: string,
    skillName: string,
    oldVersion: string,
    newVersion: string,
    success: boolean,
    error?: string
  ): void {
    this.writeEntry({
      id: this.generateId(),
      timestamp: Date.now(),
      action: success
        ? SkillAuditAction.UPDATE
        : SkillAuditAction.UPDATE_FAILED,
      skillId,
      skillName,
      skillVersion: newVersion,
      details: { oldVersion, newVersion },
      success,
      error,
    });
  }

  /**
   * 记录技能启用/禁用
   */
  recordToggle(skillId: string, skillName: string, enabled: boolean): void {
    this.writeEntry({
      id: this.generateId(),
      timestamp: Date.now(),
      action: enabled ? SkillAuditAction.ENABLE : SkillAuditAction.DISABLE,
      skillId,
      skillName,
      success: true,
    });
  }

  /**
   * 查询审计日志
   */
  query(options?: {
    action?: SkillAuditAction;
    skillId?: string;
    limit?: number;
    offset?: number;
    startTime?: number;
    endTime?: number;
  }): SkillAuditEntry[] {
    const files = this.listAuditFiles();
    const entries: SkillAuditEntry[] = [];

    for (const file of files.reverse()) {
      try {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as SkillAuditEntry;
            entries.push(entry);
          } catch {
            // 跳过损坏的行
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    let filtered = entries;

    if (options?.action) {
      filtered = filtered.filter((e) => e.action === options.action);
    }
    if (options?.skillId) {
      filtered = filtered.filter((e) => e.skillId === options.skillId);
    }
    if (options?.startTime) {
      filtered = filtered.filter((e) => e.timestamp >= options.startTime!);
    }
    if (options?.endTime) {
      filtered = filtered.filter((e) => e.timestamp <= options.endTime!);
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);

    const offset = options?.offset || 0;
    const limit = options?.limit || 50;

    return filtered.slice(offset, offset + limit);
  }

  /**
   * 列出所有审计文件
   */
  private listAuditFiles(): string[] {
    if (!existsSync(this.auditDir)) {
      return [];
    }

    const { readdirSync } = require('fs');
    return readdirSync(this.auditDir)
      .filter((f: string) => f.startsWith('audit-') && f.endsWith('.jsonl'))
      .map((f: string) => join(this.auditDir, f));
  }
}
