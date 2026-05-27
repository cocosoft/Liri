/**
 * 预编译摘要持久化 (KnowledgeDigestService)
 * 对标 OpenClaw vault 双缓存架构：文件系统 + digest 缓存
 *
 * 职责：
 *   1. 扫描知识库目录，提取 frontmatter 摘要信息
 *   2. 将摘要持久化到 .knowledge-cache/digest.json
 *   3. 提供快速查询接口，避免重复读取文件
 *   4. 通过 mtime 检测自动失效重建
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

export interface DocDigest {
  path: string;
  title: string;
  summary: string;
  tags: string[];
  category: string;
  wordCount: number;
  lastModified: string;
  lineCount: number;
}

export interface DigestCache {
  version: number;
  updatedAt: string;
  docs: DocDigest[];
}

const DIGEST_VERSION = 1;
const DIGEST_FILENAME = 'digest.json';

/**
 * 预编译摘要服务
 */
export class KnowledgeDigestService {
  private knowledgeRoot: string;
  private cacheDir: string;
  private cachePath: string;
  private cached: DigestCache | null = null;

  constructor() {
    this.knowledgeRoot = join(resolvePyappHome(), 'knowledge');
    this.cacheDir = join(this.knowledgeRoot, '.knowledge-cache');
    this.cachePath = join(this.cacheDir, DIGEST_FILENAME);
  }

  /**
   * 获取摘要缓存路径
   */
  getCachePath(): string {
    return this.cachePath;
  }

  /**
   * 构建或刷新摘要缓存
   */
  async buildDigest(): Promise<DigestCache> {
    const docs: DocDigest[] = [];
    const files = await this.collectDocFiles();

    for (const filePath of files) {
      const digest = await this.extractDigest(filePath);
      if (digest) docs.push(digest);
    }

    const cache: DigestCache = {
      version: DIGEST_VERSION,
      updatedAt: new Date().toISOString(),
      docs,
    };

    await this.persistDigest(cache);
    this.cached = cache;

    logger.info(`摘要缓存已构建: ${docs.length} 个文档`);

    return cache;
  }

  /**
   * 加载摘要缓存（优先使用缓存，失效时自动重建）
   */
  async loadDigest(): Promise<DigestCache> {
    if (this.cached) return this.cached;

    if (existsSync(this.cachePath)) {
      try {
        const content = await readFile(this.cachePath, 'utf-8');
        const cache: DigestCache = JSON.parse(content);

        if (cache.version === DIGEST_VERSION) {
          const needsRebuild = await this.checkStaleness(cache);
          if (!needsRebuild) {
            this.cached = cache;
            return cache;
          }
        }
      } catch (error) {
        logger.warning('摘要缓存读取失败，将重建', { error });
      }
    }

    return this.buildDigest();
  }

  /**
   * 按关键词搜索摘要
   */
  async searchDigest(query: string): Promise<DocDigest[]> {
    const cache = await this.loadDigest();
    const lowerQuery = query.toLowerCase();

    return cache.docs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(lowerQuery) ||
        doc.summary.toLowerCase().includes(lowerQuery) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)) ||
        doc.category.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 获取所有文档摘要
   */
  async getAllDigests(): Promise<DocDigest[]> {
    const cache = await this.loadDigest();
    return cache.docs;
  }

  /**
   * 按标签筛选文档
   */
  async getDocsByTag(tag: string): Promise<DocDigest[]> {
    const cache = await this.loadDigest();
    const lowerTag = tag.toLowerCase();

    return cache.docs.filter((doc) =>
      doc.tags.some((t) => t.toLowerCase() === lowerTag)
    );
  }

  /**
   * 收集所有 Markdown 文件
   */
  private async collectDocFiles(): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'raw') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    }

    await walk(this.knowledgeRoot);
    return files;
  }

  /**
   * 从单个文件提取摘要
   */
  private async extractDigest(filePath: string): Promise<DocDigest | null> {
    const relPath = relative(this.knowledgeRoot, filePath);
    try {
      const content = await readFile(filePath, 'utf-8');
      const stats = await stat(filePath);

      const { frontmatter, body } = this.parseFrontmatter(content);
      const wordCount = body.split(/\s+/).filter(Boolean).length;
      const lineCount = body.split('\n').length;

      return {
        path: relPath,
        title: frontmatter.title || relPath.replace(/\.md$/, ''),
        summary:
          frontmatter.summary || body.slice(0, 200).replace(/\n/g, ' ') + '...',
        tags: this.parseTags(frontmatter),
        category: frontmatter.category || '知识库',
        wordCount,
        lastModified: stats.mtime.toISOString(),
        lineCount,
      };
    } catch {
      return null;
    }
  }

  /**
   * 解析 Markdown frontmatter
   */
  private parseFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const frontmatter: Record<string, string> = {};
    let body = content;

    if (content.startsWith('---')) {
      const endIndex = content.indexOf('---', 3);
      if (endIndex !== -1) {
        const fmText = content.slice(3, endIndex).trim();
        body = content.slice(endIndex + 3).trim();
        for (const line of fmText.split('\n')) {
          const colonIndex = line.indexOf(':');
          if (colonIndex !== -1) {
            const key = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim();
            frontmatter[key] = value;
          }
        }
      }
    }

    return { frontmatter, body };
  }

  /**
   * 解析 tags 字段（支持 YAML 数组格式）
   */
  private parseTags(frontmatter: Record<string, string>): string[] {
    const tagsRaw = frontmatter.tags || '';
    if (!tagsRaw) return [];

    const trimmed = tagsRaw.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed
          .slice(1, -1)
          .split(',')
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ''));
      }
    }

    if (trimmed.startsWith('-')) {
      return trimmed
        .split('\n')
        .map((t) => t.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean);
    }

    return trimmed
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  /**
   * 判断缓存是否失效
   * 比较缓存中每个文件的 lastModified 与实际文件 mtime
   */
  private async checkStaleness(cache: DigestCache): Promise<boolean> {
    for (const doc of cache.docs) {
      const fullPath = join(this.knowledgeRoot, doc.path);
      try {
        const stats = await stat(fullPath);
        if (stats.mtime.toISOString() !== doc.lastModified) {
          return true;
        }
      } catch {
        return true;
      }
    }

    const currentFiles = await this.collectDocFiles();
    if (currentFiles.length !== cache.docs.length) {
      return true;
    }

    return false;
  }

  /**
   * 持久化摘要到缓存文件
   */
  private async persistDigest(cache: DigestCache): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  }
}

/**
 * 构建全局摘要服务实例
 */
let defaultDigestService: KnowledgeDigestService | null = null;

export function getDefaultDigestService(): KnowledgeDigestService {
  if (!defaultDigestService) {
    defaultDigestService = new KnowledgeDigestService();
  }
  return defaultDigestService;
}
