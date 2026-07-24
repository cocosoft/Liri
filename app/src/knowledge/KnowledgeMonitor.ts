// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识库可观测性 — KnowledgeMonitor
 *
 * 轻量指标采集，写入 JSONL 文件，支持按时间/操作类型过滤。
 * 指标存储: ~/.pyapp/data/knowledge/metrics.jsonl
 * 数据保留: 30 天自动轮转
 */

import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveDataSubDir } from '@modules/core';

const logger = new Logger({
  module: 'knowledge:monitor',
  level: LogLevel.INFO,
});

interface MetricEvent {
  ts: string;
  name: string;
  value: number;
  tags?: Record<string, string>;
}

export class KnowledgeMonitor {
  private metricsPath: string;

  constructor() {
    this.metricsPath = join(
      resolveDataSubDir(''),
      'knowledge',
      'metrics.jsonl'
    );
  }

  /** 记录一个指标事件 */
  async record(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    try {
      await this.ensureDir();
      const event: MetricEvent = {
        ts: new Date().toISOString(),
        name,
        value,
        ...(tags ? { tags } : {}),
      };
      await appendFile(this.metricsPath, JSON.stringify(event) + '\n', 'utf-8');
    } catch (err) {
      logger.debug('指标记录失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 计时并记录 */
  async time(
    name: string,
    fn: () => Promise<void>,
    tags?: Record<string, string>
  ): Promise<void> {
    const start = performance.now();
    try {
      await fn();
    } finally {
      await this.record(name, performance.now() - start, tags);
    }
  }

  /** 计时并返回结果 */
  async timeAndReturn<T>(
    name: string,
    fn: () => Promise<T>,
    tags?: Record<string, string>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      await this.record(name, performance.now() - start, tags);
      return result;
    } catch (err) {
      await this.record(name, performance.now() - start, {
        ...tags,
        error: '1',
      });
      throw err;
    }
  }

  private async ensureDir(): Promise<void> {
    const dir = join(resolveDataSubDir(''), 'knowledge');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

/** 默认全局单例 */
export const knowledgeMonitor = new KnowledgeMonitor();
