/**
 * 用户反馈模块
 * 实现用户反馈收集、处理和管理功能
 */

import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'fs';
import { logger } from '../utils/log.js';
import { sanitizeInput } from '@modules/security';
import { resolveDataDir } from '../config/paths';

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  type: 'bug' | 'feature' | 'improvement' | 'question' | 'other';
  category: string;
  title: string;
  description: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  contact?: string;
  attachments?: string[];
  metadata?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface FeedbackStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  averageResolutionTime?: number;
}

export interface FeedbackFilter {
  type?: FeedbackEntry['type'];
  status?: FeedbackEntry['status'];
  severity?: FeedbackEntry['severity'];
  category?: string;
  fromDate?: string;
  toDate?: string;
  searchQuery?: string;
}

export class FeedbackManager {
  private feedbackDir: string;
  private feedbackFile: string;
  private statsFile: string;
  private cache: Map<string, FeedbackEntry> = new Map();
  private stats: FeedbackStats | null = null;

  constructor() {
    this.feedbackDir = join(resolveDataDir(), 'feedback');
    this.feedbackFile = join(this.feedbackDir, 'feedback.json');
    this.statsFile = join(this.feedbackDir, 'stats.json');
    this.ensureFeedbackDir();
    this.loadFeedback();
  }

  /**
   * 确保反馈目录存在
   */
  private ensureFeedbackDir(): void {
    if (!existsSync(this.feedbackDir)) {
      mkdirSync(this.feedbackDir, { recursive: true });
    }
  }

  /**
   * 加载反馈数据
   */
  private loadFeedback(): void {
    if (existsSync(this.feedbackFile)) {
      try {
        const content = readFileSync(this.feedbackFile, 'utf-8');
        const entries: FeedbackEntry[] = JSON.parse(content);
        for (const entry of entries) {
          this.cache.set(entry.id, entry);
        }
      } catch (error) {
        logger.warn('Failed to load feedback data:', { error: String(error) });
      }
    }
  }

  /**
   * 保存反馈数据
   */
  private saveFeedback(): void {
    try {
      const entries = Array.from(this.cache.values());
      writeFileSync(this.feedbackFile, JSON.stringify(entries, null, 2));
    } catch (error) {
      logger.error('Failed to save feedback data:', error as any);
    }
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 提交反馈
   */
  submitFeedback(
    feedback: Omit<FeedbackEntry, 'id' | 'timestamp' | 'status'>
  ): FeedbackEntry {
    const entry: FeedbackEntry = {
      ...feedback,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      status: 'open',
      title: sanitizeInput(feedback.title) as string,
      description: sanitizeInput(feedback.description) as string,
    };

    this.cache.set(entry.id, entry);
    this.saveFeedback();
    this.stats = null; // 重置统计缓存

    logger.info(`Feedback submitted: ${entry.id}`);
    return entry;
  }

  /**
   * 获取反馈
   */
  getFeedback(id: string): FeedbackEntry | undefined {
    return this.cache.get(id);
  }

  /**
   * 获取所有反馈
   */
  getAllFeedback(filter?: FeedbackFilter): FeedbackEntry[] {
    let entries = Array.from(this.cache.values());

    if (filter) {
      if (filter.type) {
        entries = entries.filter((e) => e.type === filter.type);
      }
      if (filter.status) {
        entries = entries.filter((e) => e.status === filter.status);
      }
      if (filter.severity) {
        entries = entries.filter((e) => e.severity === filter.severity);
      }
      if (filter.category) {
        entries = entries.filter((e) => e.category === filter.category);
      }
      if (filter.fromDate) {
        entries = entries.filter((e) => e.timestamp >= filter.fromDate!);
      }
      if (filter.toDate) {
        entries = entries.filter((e) => e.timestamp <= filter.toDate!);
      }
      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        entries = entries.filter(
          (e) =>
            e.title.toLowerCase().includes(query) ||
            e.description.toLowerCase().includes(query)
        );
      }
    }

    // 按时间倒序排列
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return entries;
  }

  /**
   * 更新反馈状态
   */
  updateFeedbackStatus(
    id: string,
    status: FeedbackEntry['status'],
    resolution?: string
  ): boolean {
    const entry = this.cache.get(id);
    if (!entry) {
      return false;
    }

    entry.status = status;
    if (status === 'resolved' || status === 'closed') {
      entry.resolvedAt = new Date().toISOString();
      entry.resolution = resolution;
    }

    this.saveFeedback();
    this.stats = null; // 重置统计缓存
    logger.info(`Feedback ${id} status updated to ${status}`);
    return true;
  }

  /**
   * 更新反馈详情
   */
  updateFeedback(id: string, updates: Partial<FeedbackEntry>): boolean {
    const entry = this.cache.get(id);
    if (!entry) {
      return false;
    }

    const allowedFields = [
      'title',
      'description',
      'severity',
      'category',
      'contact',
    ];
    for (const field of allowedFields) {
      if (field in updates) {
        (entry as any)[field] = sanitizeInput((updates as any)[field]);
      }
    }

    this.saveFeedback();
    this.stats = null; // 重置统计缓存
    logger.info(`Feedback ${id} updated`);
    return true;
  }

  /**
   * 删除反馈
   */
  deleteFeedback(id: string): boolean {
    if (!this.cache.has(id)) {
      return false;
    }

    this.cache.delete(id);
    this.saveFeedback();
    this.stats = null; // 重置统计缓存
    logger.info(`Feedback ${id} deleted`);
    return true;
  }

  /**
   * 获取统计信息
   */
  getStats(): FeedbackStats {
    if (this.stats) {
      return this.stats;
    }

    const entries = Array.from(this.cache.values());
    const stats: FeedbackStats = {
      total: entries.length,
      open: 0,
      inProgress: 0,
      resolved: 0,
      closed: 0,
      byType: {},
      bySeverity: {},
    };

    for (const entry of entries) {
      switch (entry.status) {
        case 'open':
          stats.open++;
          break;
        case 'in_progress':
          stats.inProgress++;
          break;
        case 'resolved':
          stats.resolved++;
          break;
        case 'closed':
          stats.closed++;
          break;
      }

      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;

      if (entry.severity) {
        stats.bySeverity[entry.severity] =
          (stats.bySeverity[entry.severity] || 0) + 1;
      }
    }

    // 计算平均解决时间
    const resolvedEntries = entries.filter((e) => e.resolvedAt);
    if (resolvedEntries.length > 0) {
      const totalTime = resolvedEntries.reduce((sum, e) => {
        const created = new Date(e.timestamp).getTime();
        const resolved = new Date(e.resolvedAt!).getTime();
        return sum + (resolved - created);
      }, 0);
      stats.averageResolutionTime = totalTime / resolvedEntries.length;
    }

    this.stats = stats;
    return stats;
  }

  /**
   * 获取最近的反馈
   */
  getRecentFeedback(limit: number = 10): FeedbackEntry[] {
    const entries = this.getAllFeedback();
    return entries.slice(0, limit);
  }

  /**
   * 获取打开的反馈数量
   */
  getOpenCount(): number {
    return this.getStats().open;
  }

  /**
   * 导出反馈数据
   */
  exportFeedback(filter?: FeedbackFilter): string {
    const entries = this.getAllFeedback(filter);
    return JSON.stringify(entries, null, 2);
  }

  /**
   * 导入反馈数据
   */
  importFeedback(data: string): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;

    try {
      const entries: FeedbackEntry[] = JSON.parse(data);
      for (const entry of entries) {
        if (this.cache.has(entry.id)) {
          skipped++;
        } else {
          this.cache.set(entry.id, entry);
          imported++;
        }
      }
      this.saveFeedback();
      this.stats = null;
    } catch (error) {
      logger.error('Failed to import feedback:', error as any);
    }

    return { imported, skipped };
  }

  /**
   * 清空所有反馈
   */
  clearAllFeedback(): void {
    this.cache.clear();
    this.saveFeedback();
    this.stats = null;
    logger.info('All feedback cleared');
  }
}

/**
 * 全局反馈管理器实例
 */
export const feedbackManager = new FeedbackManager();
