// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识去重策略 — KnowledgeDedupStrategy
 *
 * 写入前检测重复内容：
 *   1. 精确去重: SHA-256(content) 比对已有文件
 *   2. 近似去重: title 相似度 > 0.85（可选，默认关闭）
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'knowledge:dedup',
  level: LogLevel.INFO,
});

interface DedupEntry {
  contentHash: string;
  filePath: string;
  title: string;
}

export interface DedupResult {
  isDuplicate: boolean;
  existingPath?: string;
  existingTitle?: string;
  similarity: number;
}

export class KnowledgeDedupStrategy {
  private entries: Map<string, DedupEntry> = new Map();
  private baseDir: string;
  private enableFuzzy: boolean;
  private fuzzyThreshold: number;

  constructor(
    baseDir: string,
    options?: { enableFuzzy?: boolean; fuzzyThreshold?: number }
  ) {
    this.baseDir = baseDir;
    this.enableFuzzy = options?.enableFuzzy ?? false;
    this.fuzzyThreshold = options?.fuzzyThreshold ?? 0.85;
  }

  /** 从文件系统加载已有文件的 hash 索引 */
  async loadIndex(
    docFiles: Iterable<{ title: string; filePath: string }>
  ): Promise<void> {
    this.entries.clear();
    for (const doc of docFiles) {
      try {
        const fullPath = join(this.baseDir, doc.filePath);
        if (!existsSync(fullPath)) continue;
        const content = await readFile(fullPath, 'utf-8');
        const hash = createHash('sha256')
          .update(content)
          .digest('hex')
          .slice(0, 16);
        this.entries.set(hash, {
          contentHash: hash,
          filePath: doc.filePath,
          title: doc.title,
        });
      } catch {
        // 跳过不可读文件
      }
    }
    logger.info('已加载去重索引', { count: this.entries.size });
  }

  /** 检测内容是否与已有文档重复 */
  async check(title: string, content: string): Promise<DedupResult> {
    // 1. 精确去重
    const contentHash = createHash('sha256')
      .update(content)
      .digest('hex')
      .slice(0, 16);
    const exactMatch = this.entries.get(contentHash);
    if (exactMatch) {
      return {
        isDuplicate: true,
        existingPath: exactMatch.filePath,
        existingTitle: exactMatch.title,
        similarity: 1.0,
      };
    }

    // 2. 近似去重（title 相似度）
    if (this.enableFuzzy) {
      const lowerTitle = title.toLowerCase().trim();
      for (const [, entry] of this.entries) {
        const sim = this.titleSimilarity(
          lowerTitle,
          entry.title.toLowerCase().trim()
        );
        if (sim >= this.fuzzyThreshold) {
          return {
            isDuplicate: true,
            existingPath: entry.filePath,
            existingTitle: entry.title,
            similarity: sim,
          };
        }
      }
    }

    return { isDuplicate: false, similarity: 0 };
  }

  /** 将新写入的文档注册到去重索引 */
  register(title: string, filePath: string, content: string): void {
    const hash = createHash('sha256')
      .update(content)
      .digest('hex')
      .slice(0, 16);
    this.entries.set(hash, { contentHash: hash, filePath, title });
  }

  /** 从索引中移除文档 */
  remove(filePath: string): void {
    for (const [hash, entry] of this.entries) {
      if (entry.filePath === filePath) {
        this.entries.delete(hash);
        return;
      }
    }
  }

  /** 简单标题相似度（Jaccard on words） */
  private titleSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/[\s\-_]+/));
    const wordsB = new Set(b.split(/[\s\-_]+/));
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
