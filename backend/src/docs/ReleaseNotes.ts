/**
 * 释放说明管理器
 * 管理版本更新日志和释放说明
 */

import { ReleaseNote } from './types.js';
import { logger } from '../utils/log.js';

/**
 * 默认释放说明
 */
const DEFAULT_RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.0.0',
    releaseDate: '2024-01-01',
    notes: [
      '初始版本发布',
      '支持基本的文件操作',
      '支持代码分析和重构',
    ],
    isImportant: true,
    type: 'feature',
  },
  {
    version: '1.1.0',
    releaseDate: '2024-02-01',
    notes: [
      '新增 Git 操作支持',
      '优化代码分析功能',
      '修复已知问题',
    ],
    isImportant: false,
    type: 'improvement',
  },
  {
    version: '1.2.0',
    releaseDate: '2024-03-01',
    notes: [
      '新增测试生成功能',
      '支持多语言',
      '改进错误处理',
    ],
    isImportant: true,
    type: 'feature',
  },
];

/**
 * 释放说明管理器类
 */
export class ReleaseNotes {
  private notes: Map<string, ReleaseNote> = new Map();
  private lastSeenVersion: string | null = null;

  /**
   * 构造函数
   */
  constructor() {
    // 加载默认释放说明
    for (const note of DEFAULT_RELEASE_NOTES) {
      this.notes.set(note.version, note);
    }
  }

  /**
   * 添加释放说明
   * @param note 释放说明
   */
  addReleaseNote(note: ReleaseNote): void {
    this.notes.set(note.version, note);
  }

  /**
   * 获取释放说明
   * @param version 版本号
   * @returns 释放说明或undefined
   */
  getReleaseNote(version: string): ReleaseNote | undefined {
    return this.notes.get(version);
  }

  /**
   * 获取所有释放说明
   * @returns 释放说明数组
   */
  getAllReleaseNotes(): ReleaseNote[] {
    return Array.from(this.notes.values()).sort((a, b) =>
      this.compareVersions(b.version, a.version)
    );
  }

  /**
   * 获取最新释放说明
   * @returns 最新释放说明或undefined
   */
  getLatestReleaseNote(): ReleaseNote | undefined {
    const allNotes = this.getAllReleaseNotes();
    return allNotes.length > 0 ? allNotes[0] : undefined;
  }

  /**
   * 获取两个版本之间的释放说明
   * @param fromVersion 起始版本
   * @param toVersion 结束版本
   * @returns 释放说明数组
   */
  getReleaseNotesBetween(
    fromVersion: string,
    toVersion: string
  ): ReleaseNote[] {
    const allNotes = this.getAllReleaseNotes();
    return allNotes.filter((note) => {
      const noteVersion = note.version;
      return (
        this.compareVersions(noteVersion, fromVersion) > 0 &&
        this.compareVersions(noteVersion, toVersion) <= 0
      );
    });
  }

  /**
   * 获取最近的释放说明
   * @param limit 数量限制
   * @returns 释放说明数组
   */
  getRecentReleaseNotes(limit: number = 5): ReleaseNote[] {
    return this.getAllReleaseNotes().slice(0, limit);
  }

  /**
   * 获取重要更新
   * @returns 重要更新数组
   */
  getImportantReleaseNotes(): ReleaseNote[] {
    return this.getAllReleaseNotes().filter((note) => note.isImportant);
  }

  /**
   * 按类型获取释放说明
   * @param type 更新类型
   * @returns 释放说明数组
   */
  getReleaseNotesByType(
    type: 'feature' | 'bugfix' | 'improvement' | 'breaking'
  ): ReleaseNote[] {
    return this.getAllReleaseNotes().filter((note) => note.type === type);
  }

  /**
   * 检查是否有新版本的释放说明
   * @param currentVersion 当前版本
   * @returns 是否有新版本的释放说明
   */
  hasNewReleaseNotes(currentVersion: string): boolean {
    const latestNote = this.getLatestReleaseNote();
    if (!latestNote) {
      return false;
    }
    return this.compareVersions(latestNote.version, currentVersion) > 0;
  }

  /**
   * 获取未查看的释放说明
   * @returns 释放说明数组
   */
  getUnseenReleaseNotes(): ReleaseNote[] {
    if (!this.lastSeenVersion) {
      return this.getAllReleaseNotes();
    }
    return this.getReleaseNotesBetween(
      this.lastSeenVersion,
      this.getLatestReleaseNote()?.version || this.lastSeenVersion
    );
  }

  /**
   * 标记版本为已查看
   * @param version 版本号
   */
  markAsSeen(version: string): void {
    this.lastSeenVersion = version;
  }

  /**
   * 解析变更日志
   * @param content 变更日志内容
   * @returns 释放说明数组
   */
  parseChangelog(content: string): ReleaseNote[] {
    const notes: ReleaseNote[] = [];

    try {
      // 简单的 Markdown 格式解析
      const sections = content.split(/^## /gm).slice(1);

      for (const section of sections) {
        const lines = section.trim().split('\n');
        if (lines.length === 0) continue;

        const versionLine = lines[0];
        const version = versionLine.split(' - ')[0]?.trim() || '';
        const releaseDate = versionLine.split(' - ')[1]?.trim() || '';

        if (!version) continue;

        const noteLines = lines
          .slice(1)
          .filter((line) => line.trim().startsWith('- '))
          .map((line) => line.trim().substring(2).trim())
          .filter(Boolean);

        if (noteLines.length > 0) {
          notes.push({
            version,
            releaseDate,
            notes: noteLines,
            isImportant: false,
            type: 'improvement',
          });
        }
      }
    } catch (error) {
      logger.error('解析变更日志失败', error instanceof Error ? error : undefined);
    }

    return notes;
  }

  /**
   * 格式化释放说明
   * @param note 释放说明
   * @returns 格式化字符串
   */
  formatReleaseNote(note: ReleaseNote): string {
    const lines = [
      `## ${note.version}${note.releaseDate ? ` - ${note.releaseDate}` : ''}`,
      '',
      ...note.notes.map((n) => `- ${n}`),
      '',
    ];

    if (note.isImportant) {
      lines.unshift('⚠️ 重要更新');
    }

    return lines.join('\n');
  }

  /**
   * 获取格式化的释放说明列表
   * @param limit 数量限制
   * @returns 格式化字符串
   */
  getFormattedReleaseNotes(limit?: number): string {
    const notes = limit
      ? this.getRecentReleaseNotes(limit)
      : this.getAllReleaseNotes();

    return notes.map((note) => this.formatReleaseNote(note)).join('\n');
  }

  /**
   * 删除释放说明
   * @param version 版本号
   */
  removeReleaseNote(version: string): void {
    this.notes.delete(version);
  }

  /**
   * 清除所有释放说明
   */
  clearReleaseNotes(): void {
    this.notes.clear();
  }

  /**
   * 获取释放说明数量
   * @returns 释放说明数量
   */
  getReleaseNoteCount(): number {
    return this.notes.size;
  }

  /**
   * 比较版本号
   * @param versionA 版本A
   * @param versionB 版本B
   * @returns 比较结果
   */
  private compareVersions(versionA: string, versionB: string): number {
    const partsA = versionA.split('.').map(Number);
    const partsB = versionB.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;

      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }

    return 0;
  }
}

// 导出单例实例
export const releaseNotes = new ReleaseNotes();
