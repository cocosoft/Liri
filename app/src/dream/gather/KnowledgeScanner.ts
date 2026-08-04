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
 * KnowledgeScanner — 知识文件变更扫描器
 *
 * 扫描知识库目录中的 .md 文件变更（按 mtime），
 * 支持 git-style diff 检测（小变更只返回 diff）。
 */

import { stat, readFile, writeFile, mkdir } from 'fs/promises';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { resolvePyappHome } from '@modules/core';
import type { KnowledgeDelta } from '../types';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'dream:gather:knowledgeScanner',
  level: LogLevel.INFO,
});

/** 大变更阈值：变更行数超过此比例视为全量变更 */
const LARGE_CHANGE_RATIO = 0.5;
/** 小变更阈值：变更行数小于此行数视为微小变更 */
const SMALL_CHANGE_LINES = 10;

export interface ScannedFile {
  filePath: string;
  fileName: string;
  mtimeMs: number;
  content: string;
  isDelta: boolean;
  delta?: KnowledgeDelta;
}

export class KnowledgeScanner {
  private knowledgeRoot: string;
  private deltaDir: string;

  constructor() {
    this.knowledgeRoot = join(resolvePyappHome(), 'knowledge');
    this.deltaDir = join(
      resolvePyappHome(),
      'data',
      'dream',
      'knowledge_delta'
    );
  }

  /**
   * 扫描知识库变更文件
   * @param sinceMs 上次梦境完成时间戳
   * @returns 变更文件列表（含内容或 diff）
   */
  async scanChanges(sinceMs: number): Promise<ScannedFile[]> {
    const results: ScannedFile[] = [];

    try {
      await this.scanDir(this.knowledgeRoot, sinceMs, results);
    } catch (e) {
      logger.warn('知识库扫描失败', { error: String(e) });
      void handleError(e, { module: 'dream:scanner', action: 'scanChanges' });
    }

    return results;
  }

  /** 递归扫描目录 */
  private async scanDir(
    dir: string,
    sinceMs: number,
    results: ScannedFile[]
  ): Promise<void> {
    const { readdir } = await import('fs/promises');
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as {
        name: string;
        isDirectory: () => boolean;
      }[];
    } catch {
      void handleError(new Error('读取目录失败'), {
        module: 'dream:scanner',
        action: 'readDir',
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // 跳过 raw/ 和 .knowledge-cache/ 目录
      if (entry.isDirectory()) {
        if (entry.name === 'raw' || entry.name.startsWith('.')) continue;
        await this.scanDir(fullPath, sinceMs, results);
        continue;
      }

      if (!entry.name.endsWith('.md')) continue;

      try {
        const s = await stat(fullPath);
        if (s.mtimeMs <= sinceMs) continue;

        const content = await readFile(fullPath, 'utf-8');
        const scanned: ScannedFile = {
          filePath: fullPath,
          fileName: relative(this.knowledgeRoot, fullPath),
          mtimeMs: s.mtimeMs,
          content,
          isDelta: false,
        };

        // 检查是否可以只返回 diff
        const delta = await this.computeDelta(scanned.fileName, content);
        if (delta) {
          scanned.isDelta = true;
          scanned.delta = delta;
        }

        results.push(scanned);
      } catch {
        /* skip unreadable files */
        void handleError(new Error('读取知识文件失败'), {
          module: 'dream:scanner',
          action: 'readKnowledgeFile',
        });
      }
    }
  }

  /**
   * 计算知识文件的变更增量
   * 小变更（< 10 行 diff）只返回 diff，大变更返回 null（需要全量读）
   */
  private async computeDelta(
    fileName: string,
    currentContent: string
  ): Promise<KnowledgeDelta | null> {
    const deltaPath = join(
      this.deltaDir,
      `${fileName.replace(/[/\\]/g, '_')}.json`
    );
    const currentHash = this.sha256(currentContent);

    let previous: KnowledgeDelta | null = null;
    try {
      const data = await readFile(deltaPath, 'utf-8');
      previous = JSON.parse(data) as KnowledgeDelta;
    } catch {
      /* first time scanning */
      void handleError(new Error('读取delta文件失败'), {
        module: 'dream:scanner',
        action: 'computeDelta',
      });
    }

    if (!previous) {
      // 首次扫描，存储基线
      await this.saveDelta(deltaPath, {
        fileName,
        baseSnapshot: currentHash,
        additions: [],
        removals: [],
        lastCheckedAt: Date.now(),
      });
      return null;
    }

    if (previous.baseSnapshot === currentHash) {
      // 内容未变（mtime 变了但内容没变）
      return null;
    }

    // 计算行级 diff
    const oldLines = this.getContentLines(previous);
    const newLines = currentContent.split('\n');
    const additions: string[] = [];
    const removals: string[] = [];
    const oldSet = new Set(oldLines);

    for (const line of newLines) {
      if (!oldSet.has(line)) {
        additions.push(line);
      }
    }
    const newSet = new Set(newLines);
    for (const line of oldLines) {
      if (!newSet.has(line)) {
        removals.push(line);
      }
    }

    const totalChanges = additions.length + removals.length;
    const totalLines = Math.max(oldLines.length, newLines.length);

    // 更新基线
    await this.saveDelta(deltaPath, {
      fileName,
      baseSnapshot: currentHash,
      additions,
      removals,
      lastCheckedAt: Date.now(),
    });

    // 小变更：只返回 diff
    if (
      totalChanges < SMALL_CHANGE_LINES &&
      totalChanges / totalLines < LARGE_CHANGE_RATIO
    ) {
      return {
        fileName,
        baseSnapshot: previous.baseSnapshot,
        additions,
        removals,
        lastCheckedAt: Date.now(),
      };
    }

    // 大变更或新文件：返回 null（表示需要全量读）
    return null;
  }

  /** 从 delta 记录中恢复旧内容行 */
  private getContentLines(_delta: KnowledgeDelta): string[] {
    // 简化实现：从 source content 中重建
    // 实际上需要存储完整旧内容或仅用 hash 比较
    return [];
  }

  private sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private async saveDelta(
    deltaPath: string,
    delta: KnowledgeDelta
  ): Promise<void> {
    await mkdir(this.deltaDir, { recursive: true });
    await writeFile(deltaPath, JSON.stringify(delta, null, 2), 'utf-8');
  }
}
