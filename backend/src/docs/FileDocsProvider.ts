/**
 * 文件文档提供器
 * 从 docs/ 文件夹加载 Markdown 文档内容，供帮助系统和文档搜索使用
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, basename, dirname } from 'node:path';

export interface FileDocEntry {
  relativePath: string;
  title: string;
  content: string;
  category: string;
  fileName: string;
}

export class FileDocsProvider {
  private docsRoot: string;
  private cache: Map<string, FileDocEntry> = new Map();
  private indexCache: FileDocEntry[] | null = null;

  constructor(docsRoot: string) {
    this.docsRoot = docsRoot;
  }

  /**
   * 获取 docs 根目录路径
   */
  getDocsRoot(): string {
    return this.docsRoot;
  }

  /**
   * 从 markdown 内容中提取标题
   */
  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : basename(this.docsRoot);
  }

  /**
   * 从相对路径中推断分类
   */
  private inferCategory(relativePath: string): string {
    const dir = dirname(relativePath);
    return dir === '.' ? '根目录' : dir;
  }

  /**
   * 递归扫描 docs 目录，建立文档索引
   */
  async buildIndex(): Promise<FileDocEntry[]> {
    if (this.indexCache) {
      return this.indexCache;
    }

    const entries: FileDocEntry[] = [];
    await this.scanDirectory(this.docsRoot, entries);
    this.indexCache = entries;
    return entries;
  }

  /**
   * 递归扫描目录
   */
  private async scanDirectory(
    dirPath: string,
    entries: FileDocEntry[],
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
        await this.scanDirectory(fullPath, entries);
      } else if (entry.endsWith('.md')) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const relativePath = relative(this.docsRoot, fullPath);
          const docEntry: FileDocEntry = {
            relativePath,
            title: this.extractTitle(content),
            content,
            category: this.inferCategory(relativePath),
            fileName: entry,
          };
          entries.push(docEntry);
          this.cache.set(relativePath, docEntry);
        } catch {
          // 跳过无法读取的文件
        }
      }
    }
  }

  /**
   * 根据路径加载文档内容（使用相对 docs 的路径）
   */
  async loadDoc(relativePath: string): Promise<FileDocEntry | null> {
    const cached = this.cache.get(relativePath);
    if (cached) {
      return cached;
    }

    const fullPath = join(this.docsRoot, relativePath);
    try {
      const content = await readFile(fullPath, 'utf-8');
      const docEntry: FileDocEntry = {
        relativePath,
        title: this.extractTitle(content),
        content,
        category: this.inferCategory(relativePath),
        fileName: basename(relativePath),
      };
      this.cache.set(relativePath, docEntry);
      return docEntry;
    } catch {
      return null;
    }
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
        entry.category.toLowerCase().includes(lowerQuery),
    );
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
  join(import.meta.dirname, '..', '..', 'docs'),
);
