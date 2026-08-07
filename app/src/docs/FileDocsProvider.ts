/**
 * 文件文档提供器
 * 从 docs/ 文件夹加载 Markdown 文档内容，供帮助系统和文档搜索使用
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, basename, dirname } from 'path';
import { resolvePyappHome } from '@modules/core';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({
  module: 'docs:FileDocsProvider',
  level: LogLevel.INFO,
});

export interface FileDocEntry {
  relativePath: string;
  title: string;
  content: string;
  category: string;
  fileName: string;
  source?: string;
  /** frontmatter tags（供标签过滤搜索使用） */
  tags?: string[];
}

export interface SearchResult {
  doc: FileDocEntry;
  score: number;
  highlights: string[];
}

export interface PaginatedSearchResult {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class FileDocsProvider {
  private docsRoots: string[];
  private cache: Map<string, FileDocEntry> = new Map();
  private indexCache: FileDocEntry[] | null = null;

  constructor(docsRoots: string | string[]) {
    this.docsRoots = Array.isArray(docsRoots) ? docsRoots : [docsRoots];
  }

  /**
   * 获取 docs 根目录路径列表
   */
  getDocsRoots(): string[] {
    return this.docsRoots;
  }

  /**
   * 从 markdown 内容中提取标题
   */
  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '未命名文档';
  }

  /**
   * 从相对路径中推断分类
   */
  private inferCategory(relativePath: string): string {
    const dir = dirname(relativePath);
    return dir === '.' ? '根目录' : dir;
  }

  /**
   * 解析 frontmatter tags（支持 `tags: ["a","b"]` / `[a, b]` / `a, b` 格式）
   */
  private parseFrontmatterTags(content: string): string[] {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];
    const tagsLine = fmMatch[1]
      .split('\n')
      .find((l) => l.trim().startsWith('tags:'));
    if (!tagsLine) return [];
    const val = tagsLine.split(':').slice(1).join(':').trim();
    if (!val) return [];
    if (val.startsWith('[') && val.endsWith(']')) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // fallthrough to manual split
      }
      return val
        .slice(1, -1)
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    return val
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  /**
   * 计算两个字符串之间的 Levenshtein 距离（用于模糊搜索）
   */
  private levenshteinDistance(s: string, t: string): number {
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    const dp: number[][] = [];
    for (let i = 0; i <= t.length; i++) {
      dp[i] = [i];
    }
    for (let j = 0; j <= s.length; j++) {
      dp[0][j] = j;
    }
    for (let i = 1; i <= t.length; i++) {
      for (let j = 1; j <= s.length; j++) {
        const cost = s[j - 1] === t[i - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[t.length][s.length];
  }

  /**
   * 计算文档与查询的匹配分数（模糊搜索）
   */
  private calculateScore(doc: FileDocEntry, query: string): number {
    const lowerQuery = query.toLowerCase();
    const lowerTitle = doc.title.toLowerCase();
    const lowerContent = doc.content.toLowerCase();
    const lowerCategory = doc.category.toLowerCase();

    let score = 0;

    // 精确匹配标题给予最高权重
    if (lowerTitle.includes(lowerQuery)) {
      score += 100;
    }
    // 标题包含查询词
    if (lowerTitle.includes(lowerQuery)) {
      score += 80;
    }
    // 分类包含查询词
    if (lowerCategory.includes(lowerQuery)) {
      score += 50;
    }
    // 内容包含查询词
    if (lowerContent.includes(lowerQuery)) {
      score += 40;
    }

    // 模糊匹配（Levenshtein 距离）
    const titleDistance = this.levenshteinDistance(lowerTitle, lowerQuery);
    const maxLen = Math.max(lowerTitle.length, lowerQuery.length);
    if (maxLen > 0) {
      const similarity = 1 - titleDistance / maxLen;
      if (similarity > 0.6) {
        score += similarity * 30;
      }
    }

    // 检查查询词是否是标题的前缀
    if (lowerTitle.startsWith(lowerQuery)) {
      score += 25;
    }

    return score;
  }

  /**
   * 提取高亮片段
   */
  private extractHighlights(doc: FileDocEntry, query: string): string[] {
    const highlights: string[] = [];
    const lowerQuery = query.toLowerCase();
    const content = doc.content;
    const lowerContent = content.toLowerCase();

    let index = 0;
    while ((index = lowerContent.indexOf(lowerQuery, index)) !== -1) {
      // 提取前后 50 个字符作为上下文
      const start = Math.max(0, index - 50);
      const end = Math.min(content.length, index + lowerQuery.length + 50);
      const snippet = content.slice(start, end);

      // 高亮匹配部分
      const highlightStart = index - start;
      const highlightEnd = highlightStart + lowerQuery.length;
      const highlighted =
        snippet.slice(0, highlightStart) +
        `**${snippet.slice(highlightStart, highlightEnd)}**` +
        snippet.slice(highlightEnd);

      highlights.push('...' + highlighted + '...');

      if (highlights.length >= 3) break; // 最多 3 个片段
      index = index + lowerQuery.length;
    }

    // 如果没有找到匹配，取开头部分
    if (highlights.length === 0) {
      const start = Math.min(150, content.length);
      highlights.push(content.slice(0, start) + '...');
    }

    return highlights;
  }

  /**
   * 递归扫描所有 docs 目录，建立文档索引
   */
  async buildIndex(): Promise<FileDocEntry[]> {
    if (this.indexCache) {
      return this.indexCache;
    }

    const entries: FileDocEntry[] = [];
    for (const root of this.docsRoots) {
      await this.scanDirectory(root, root, entries);
    }
    this.indexCache = entries;
    return entries;
  }

  /**
   * 递归扫描目录
   */
  private async scanDirectory(
    dirPath: string,
    sourceRoot: string,
    entries: FileDocEntry[]
  ): Promise<void> {
    let dirEntries: string[];
    try {
      dirEntries = await readdir(dirPath);
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      const fullPath = join(dirPath, entry);
      let stats;
      try {
        stats = await stat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        await this.scanDirectory(fullPath, sourceRoot, entries);
      } else if (entry.endsWith('.md')) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const relativePath = relative(sourceRoot, fullPath);
          const docEntry: FileDocEntry = {
            relativePath,
            title: this.extractTitle(content),
            content,
            category: this.inferCategory(relativePath),
            tags: this.parseFrontmatterTags(content),
            fileName: entry,
            source: sourceRoot,
          };
          entries.push(docEntry);
          const cacheKey = `${sourceRoot}:${relativePath}`;
          this.cache.set(cacheKey, docEntry);
        } catch (err) {
          // 跳过无法读取的文件

          handleError(err, {
            module: 'docs:FileDocsProvider',
            action: 'loadFile',
          });
        }
      }
    }
  }

  /**
   * 根据路径加载文档内容（使用相对 docs 的路径）
   */
  async loadDoc(
    relativePath: string,
    sourceRoot?: string
  ): Promise<FileDocEntry | null> {
    if (sourceRoot) {
      const cacheKey = `${sourceRoot}:${relativePath}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const fullPath = join(sourceRoot, relativePath);
      try {
        const content = await readFile(fullPath, 'utf-8');
        const docEntry: FileDocEntry = {
          relativePath,
          title: this.extractTitle(content),
          content,
          category: this.inferCategory(relativePath),
          tags: this.parseFrontmatterTags(content),
          fileName: basename(relativePath),
          source: sourceRoot,
        };
        this.cache.set(cacheKey, docEntry);
        return docEntry;
      } catch {
        return null;
      }
    }

    for (const root of this.docsRoots) {
      const cacheKey = `${root}:${relativePath}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const fullPath = join(root, relativePath);
      try {
        const content = await readFile(fullPath, 'utf-8');
        const docEntry: FileDocEntry = {
          relativePath,
          title: this.extractTitle(content),
          content,
          category: this.inferCategory(relativePath),
          tags: this.parseFrontmatterTags(content),
          fileName: basename(relativePath),
          source: root,
        };
        this.cache.set(cacheKey, docEntry);
        return docEntry;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * 搜索文档内容（简单文本搜索）
   */
  async search(query: string): Promise<FileDocEntry[]> {
    const entries = await this.buildIndex();
    const lowerQuery = query.toLowerCase();

    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(lowerQuery) ||
        entry.content.toLowerCase().includes(lowerQuery) ||
        entry.category.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 增强版搜索：模糊搜索 + 分数排序 + 高亮
   */
  async searchEnhanced(
    query: string,
    options?: {
      page?: number;
      pageSize?: number;
      minScore?: number;
    }
  ): Promise<PaginatedSearchResult> {
    const { page = 1, pageSize = 10, minScore = 10 } = options || {};
    const entries = await this.buildIndex();

    // 计算所有文档的匹配分数
    const results: SearchResult[] = entries
      .map((doc) => ({
        doc,
        score: this.calculateScore(doc, query),
        highlights: this.extractHighlights(doc, query),
      }))
      .filter((result) => result.score >= minScore)
      .sort((a, b) => b.score - a.score); // 按分数降序排列

    // 分页
    const total = results.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedResults = results.slice(startIndex, startIndex + pageSize);

    return {
      results: paginatedResults,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * 按分类获取文档列表
   */
  async getDocsByCategory(category: string): Promise<FileDocEntry[]> {
    const entries = await this.buildIndex();
    return entries.filter((entry) => entry.category === category);
  }

  /**
   * 获取所有分类
   */
  async getCategories(): Promise<string[]> {
    const entries = await this.buildIndex();
    const categories = new Set(entries.map((e) => e.category));
    return Array.from(categories).sort();
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.indexCache = null;
  }
}

export const fileDocsProvider = new FileDocsProvider(
  join(import.meta.dirname, '..', '..', 'docs')
);

export const knowledgeDocsProvider = new FileDocsProvider(
  join(resolvePyappHome(), 'knowledge')
);
