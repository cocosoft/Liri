/**
 * 记忆扫描器实现
 * 支持记忆文件扫描、记忆头信息扫描、相关记忆检索、记忆老化管理
 */

import { join, basename } from 'path';
import { readdir, stat, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { MemoryFile, MemoryType, MemoryLayer } from './MemdirService';
import { parseFrontmatter } from '@modules/utils/frontmatterParser';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 记忆头信息（参考CC memoryScan.ts）
 * 用于快速列出记忆文件的摘要信息，不加载完整内容
 */
export interface MemoryHeader {
  /** 文件名（相对路径） */
  filename: string;
  /** 文件绝对路径 */
  filePath: string;
  /** 最后修改时间（毫秒时间戳） */
  mtimeMs: number;
  /** 文件描述（来自frontmatter） */
  description: string | null;
  /** 记忆类型（来自frontmatter） */
  type: string | undefined;
}

const MAX_MEMORY_FILES = 200;
const FRONTMATTER_MAX_LINES = 30;

/**
 * 从frontmatter原始值解析MemoryType（参考CC memoryTypes.ts）
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined;
  const validTypes = ['user', 'feedback', 'project', 'reference'] as const;
  return validTypes.find((t) => t === raw) as MemoryType | undefined;
}

/**
 * 记忆扫描结果（来自CC源码）
 */
export interface MemoryScanResult {
  /**
   * 扫描的文件路径
   */
  filePath: string;

  /**
   * 记忆类型
   */
  type: MemoryType;

  /**
   * 记忆层级
   */
  layer: MemoryLayer;

  /**
   * 文件大小
   */
  size: number;

  /**
   * 修改时间
   */
  modifiedAt: Date;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 扫描时间
   */
  scannedAt: Date;

  /**
   * 是否有效
   */
  valid: boolean;

  /**
   * 错误信息
   */
  error?: string;
}

/**
 * 相关记忆查找结果（来自CC源码）
 */
export interface RelevantMemoryResult {
  /**
   * 记忆文件
   */
  memoryFile: MemoryFile;

  /**
   * 相关性分数
   */
  relevanceScore: number;

  /**
   * 匹配的关键词
   */
  matchedKeywords: string[];

  /**
   * 匹配的标签
   */
  matchedTags: string[];
}

/**
 * 记忆老化配置（来自CC源码）
 */
export interface MemoryAgingConfig {
  /**
   * 最大记忆数量
   */
  maxMemoryCount: number;

  /**
   * 记忆存活时间（毫秒）
   */
  memoryTTL: number;

  /**
   * 是否启用LRU淘汰
   */
  enableLRU: boolean;

  /**
   * LRU淘汰阈值
   */
  lruThreshold: number;
}

/**
 * 记忆扫描器类（基于CC源码实现）
 */
export class MemdirMemoryScanner {
  private scanResults: Map<string, MemoryScanResult> = new Map();
  private agingConfig: MemoryAgingConfig;

  constructor(config?: Partial<MemoryAgingConfig>) {
    this.agingConfig = {
      maxMemoryCount: 1000,
      memoryTTL: 30 * 24 * 60 * 60 * 1000, // 30天
      enableLRU: true,
      lruThreshold: 0.8, // 80%使用率时触发LRU
      ...config,
    };
  }

  /**
   * 扫描记忆文件头信息（参考CC memoryScan.ts）
   * 单次扫描：读取frontmatter，返回按时间排序的记忆头列表（最多200条）
   *
   * @param memoryDir 记忆目录路径
   * @param signal 可选的AbortSignal用于取消操作
   * @returns 记忆头信息列表，按修改时间降序排列
   */
  static async scanMemoryFiles(
    memoryDir: string,
    signal?: AbortSignal
  ): Promise<MemoryHeader[]> {
    try {
      const entries = await readdir(memoryDir);
      const mdFiles = entries.filter(
        (f) => f.endsWith('.md') && basename(f) !== 'MEMORY.md'
      );

      const headerResults = await Promise.allSettled(
        mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const filePath = join(memoryDir, relativePath);
          const stats = await stat(filePath);
          const content = await readFile(filePath, 'utf-8');

          // 只读取前FRONTMATTER_MAX_LINE行来解析frontmatter
          const lines = content.split('\n');
          const headLines = lines.slice(0, FRONTMATTER_MAX_LINES).join('\n');
          const { frontmatter } = parseFrontmatter(headLines);

          return {
            filename: relativePath,
            filePath,
            mtimeMs: stats.mtimeMs,
            description: frontmatter.description || null,
            type: frontmatter.type,
          };
        })
      );

      return headerResults
        .filter(
          (r): r is PromiseFulfilledResult<MemoryHeader> =>
            r.status === 'fulfilled'
        )
        .map((r) => r.value)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, MAX_MEMORY_FILES);
    } catch {
      return [];
    }
  }

  /**
   * 格式化记忆头列表为文本清单（参考CC memoryScan.ts）
   *
   * @param memories 记忆头信息列表
   * @returns 格式化的文本清单
   */
  static formatMemoryManifest(memories: MemoryHeader[]): string {
    return memories
      .map((m) => {
        const tag = m.type ? `[${m.type}] ` : '';
        const ts = new Date(m.mtimeMs).toISOString();
        return m.description
          ? `- ${tag}${m.filename} (${ts}): ${m.description}`
          : `- ${tag}${m.filename} (${ts})`;
      })
      .join('\n');
  }

  /**
   * 扫描记忆目录（来自CC源码）
   */
  async scanMemoryDirectory(directory: string): Promise<MemoryScanResult[]> {
    const results: MemoryScanResult[] = [];

    if (!existsSync(directory)) {
      return results;
    }

    try {
      const files = await readdir(directory);

      for (const fileName of files) {
        if (fileName.endsWith('.md')) {
          const filePath = join(directory, fileName);

          try {
            const stats = await stat(filePath);
            const content = await readFile(filePath, 'utf-8');

            const result: MemoryScanResult = {
              filePath,
              type: this.detectMemoryType(fileName, content),
              layer: this.detectMemoryLayer(directory),
              size: stats.size,
              modifiedAt: stats.mtime,
              createdAt: stats.birthtime,
              scannedAt: new Date(),
              valid: true,
            };

            results.push(result);
            this.scanResults.set(filePath, result);
          } catch (error) {
            const errorResult: MemoryScanResult = {
              filePath,
              type: MemoryType.USER_FACT,
              layer: MemoryLayer.AUTOMEM,
              size: 0,
              modifiedAt: new Date(),
              createdAt: new Date(),
              scannedAt: new Date(),
              valid: false,
              error: error instanceof Error ? error.message : String(error),
            };

            results.push(errorResult);
            this.scanResults.set(filePath, errorResult);
          }
        }
      }
    } catch (error) {
      logger.error(
        `Failed to scan memory directory ${directory}`,
        error instanceof Error ? error : new Error(String(error))
      );
    }

    return results;
  }

  /**
   * 查找相关记忆（来自CC源码）
   */
  async findRelevantMemories(
    query: string,
    memoryFiles: MemoryFile[],
    options: {
      limit?: number;
      minRelevanceScore?: number;
      searchFields?: ('content' | 'path' | 'type' | 'layer')[];
    } = {}
  ): Promise<RelevantMemoryResult[]> {
    const {
      limit = 10,
      minRelevanceScore = 0.1,
      searchFields = ['content', 'path'],
    } = options;

    const results: RelevantMemoryResult[] = [];

    // 提取查询关键词
    const queryKeywords = this.extractKeywords(query);

    for (const memoryFile of memoryFiles) {
      const relevanceScore = this.calculateRelevanceScore(
        memoryFile,
        queryKeywords,
        searchFields
      );

      if (relevanceScore >= minRelevanceScore) {
        const matchedKeywords = this.findMatchedKeywords(
          memoryFile,
          queryKeywords,
          searchFields
        );

        const matchedTags = this.extractTags(memoryFile.content);

        results.push({
          memoryFile,
          relevanceScore,
          matchedKeywords,
          matchedTags,
        });
      }
    }

    // 按相关性排序并限制结果数量
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * 应用记忆老化（来自CC源码）
   */
  async applyMemoryAging(memoryFiles: MemoryFile[]): Promise<MemoryFile[]> {
    const now = Date.now();
    const keptMemories: MemoryFile[] = [];

    // 按使用频率和年龄排序
    const sortedMemories = memoryFiles.sort((a, b) => {
      // 优先保留最近修改的文件
      return b.modifiedAt.getTime() - a.modifiedAt.getTime();
    });

    for (const memoryFile of sortedMemories) {
      const age = now - memoryFile.createdAt.getTime();

      // 检查是否超过TTL
      if (age > this.agingConfig.memoryTTL) {
        logger.info(`Memory file ${memoryFile.path} expired (age: ${age}ms)`);
        continue;
      }

      // 检查LRU淘汰
      if (
        this.agingConfig.enableLRU &&
        keptMemories.length >=
          this.agingConfig.maxMemoryCount * this.agingConfig.lruThreshold
      ) {
        logger.info(`Memory file ${memoryFile.path} removed by LRU`);
        continue;
      }

      keptMemories.push(memoryFile);
    }

    return keptMemories;
  }

  /**
   * 检测记忆类型（来自CC源码）
   */
  private detectMemoryType(fileName: string, content: string): MemoryType {
    const lowerContent = content.toLowerCase();

    if (fileName.includes('feedback') || lowerContent.includes('feedback')) {
      return MemoryType.USER_PREFERENCE;
    }

    if (fileName.includes('project') || lowerContent.includes('project')) {
      return MemoryType.PROJECT_KNOWLEDGE;
    }

    if (fileName.includes('reference') || lowerContent.includes('reference')) {
      return MemoryType.DECISION;
    }

    return MemoryType.USER_FACT;
  }

  /**
   * 检测记忆层级（来自CC源码）
   */
  private detectMemoryLayer(directory: string): MemoryLayer {
    if (directory.includes('.pyapp')) {
      if (directory.includes('memory')) {
        return MemoryLayer.AUTOMEM;
      }
      return MemoryLayer.USER;
    }

    if (directory === process.cwd()) {
      return MemoryLayer.PROJECT;
    }

    return MemoryLayer.LOCAL;
  }

  /**
   * 提取关键词（来自CC源码）
   */
  private extractKeywords(text: string): string[] {
    // 简化实现：按空格分割并过滤停用词
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
    ]);

    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 2 && !stopWords.has(word) && /^[a-z]+$/.test(word)
      );
  }

  /**
   * 计算相关性分数（来自CC源码）
   */
  private calculateRelevanceScore(
    memoryFile: MemoryFile,
    queryKeywords: string[],
    searchFields: string[]
  ): number {
    let score = 0;

    for (const field of searchFields) {
      let fieldText = '';

      switch (field) {
        case 'content':
          fieldText = memoryFile.content.toLowerCase();
          break;
        case 'path':
          fieldText = memoryFile.path.toLowerCase();
          break;
        case 'type':
          fieldText = memoryFile.type.toLowerCase();
          break;
        case 'layer':
          fieldText = memoryFile.layer.toLowerCase();
          break;
      }

      for (const keyword of queryKeywords) {
        if (fieldText.includes(keyword)) {
          score += 1;
        }
      }
    }

    // 归一化分数
    const maxPossibleScore = queryKeywords.length * searchFields.length;
    return maxPossibleScore > 0 ? score / maxPossibleScore : 0;
  }

  /**
   * 查找匹配的关键词（来自CC源码）
   */
  private findMatchedKeywords(
    memoryFile: MemoryFile,
    queryKeywords: string[],
    searchFields: string[]
  ): string[] {
    const matchedKeywords: string[] = [];

    for (const field of searchFields) {
      let fieldText = '';

      switch (field) {
        case 'content':
          fieldText = memoryFile.content.toLowerCase();
          break;
        case 'path':
          fieldText = memoryFile.path.toLowerCase();
          break;
        case 'type':
          fieldText = memoryFile.type.toLowerCase();
          break;
        case 'layer':
          fieldText = memoryFile.layer.toLowerCase();
          break;
      }

      for (const keyword of queryKeywords) {
        if (fieldText.includes(keyword) && !matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
      }
    }

    return matchedKeywords;
  }

  /**
   * 提取标签（来自CC源码）
   */
  private extractTags(content: string): string[] {
    // 简化实现：提取Markdown标签
    const tagMatches = content.matchAll(/\[([^\]]+)\]/g);
    const tags: string[] = [];

    for (const match of tagMatches) {
      tags.push(match[1]);
    }

    return tags;
  }

  /**
   * 获取扫描统计信息（来自CC源码）
   */
  getScanStats(): {
    totalScanned: number;
    validFiles: number;
    invalidFiles: number;
    averageSize: number;
    totalSize: number;
  } {
    const results = Array.from(this.scanResults.values());
    const validFiles = results.filter((r) => r.valid);
    const totalSize = validFiles.reduce((sum, r) => sum + r.size, 0);

    return {
      totalScanned: results.length,
      validFiles: validFiles.length,
      invalidFiles: results.length - validFiles.length,
      averageSize: validFiles.length > 0 ? totalSize / validFiles.length : 0,
      totalSize,
    };
  }

  /**
   * 清除扫描结果（来自CC源码）
   */
  clearScanResults(): void {
    this.scanResults.clear();
  }
}
