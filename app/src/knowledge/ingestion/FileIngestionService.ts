/**
 * FileIngestionService - 文件自动摄取服务
 * 当文件被读取或上传时，自动将其内容整理到知识库 raw/ 目录，
 * 为后续 KnowledgeCompiler 编译和做梦整理提供原料。
 */
import { readFile, writeFile, mkdir, copyFile, stat } from 'fs/promises';
import { join, extname, basename, resolve } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { resolvePyappHome } from '@modules/core';
import { configManager } from '@modules/config/ConfigManager';

const logger = new Logger({
  module: 'knowledge:ingestion:fileIngestionService',
  level: LogLevel.INFO,
});

/**
 * 摄取来源
 */
export type IngestionSource = 'file_read' | 'attachment' | 'manual';

/**
 * 文件分类
 */
export type FileCategory =
  | 'documentation'
  | 'note'
  | 'reference'
  | 'project'
  | 'code'
  | 'config'
  | 'data'
  | 'other';

/**
 * 摄取结果
 */
export interface IngestionResult {
  success: boolean;
  rawPath: string;
  fileName: string;
  category: FileCategory;
  action: 'created' | 'skipped' | 'error';
  error?: string;
}

/**
 * 摄取选项
 */
export interface IngestionOptions {
  /** 强制重新摄取，即使文件已存在 */
  force?: boolean;
  /** 是否跳过 AI 分类（快速模式） */
  skipClassification?: boolean;
  /** 自定义分类 */
  category?: FileCategory;
  /** 源文件描述 */
  description?: string;
}

/**
 * 需要彻底跳过的文件扩展名（编译产物、压缩包、动态库等）
 * 这些文件放在知识库中毫无价值，直接跳过
 */
const BINARY_SKIP_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.o',
  '.obj',
  '.lib',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.wasm',
]);

/**
 * 仅落库但不进行 AI 分类的媒体文件扩展名
 * 这些文件会被复制到 raw/ 目录并附带元数据，
 * 但不会尝试 AI 分类（AI 无法读取图片/音视频内容）
 */
const MEDIA_ONLY_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.ico',
  '.mp3',
  '.wav',
  '.mp4',
  '.avi',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
]);

/**
 * 需要跳过的目录模式
 */
const SKIP_DIRECTORIES = [
  'node_modules',
  '.git',
  '.svn',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.tox',
  'dist',
  'build',
  '.next',
  '.turbo',
  'target',
  'bin',
  'obj',
];

function isEditableTextFile(ext: string): boolean {
  const textExtensions = new Set([
    '.txt',
    '.md',
    '.markdown',
    '.rst',
    '.json',
    '.yaml',
    '.yml',
    '.xml',
    '.html',
    '.htm',
    '.css',
    '.scss',
    '.less',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.rs',
    '.go',
    '.java',
    '.cpp',
    '.c',
    '.h',
    '.hpp',
    '.rb',
    '.php',
    '.swift',
    '.kt',
    '.scala',
    '.sh',
    '.bash',
    '.zsh',
    '.ps1',
    '.bat',
    '.cmd',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.env',
    '.sql',
    '.graphql',
    '.proto',
    '.vue',
    '.svelte',
    '.astro',
    '.dockerfile',
    '.gitignore',
    '.editorconfig',
    '.svg',
  ]);
  return textExtensions.has(ext);
}

function shouldSkipFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();

  // 用户配置白名单模式：仅落库 include 列表中的类型
  const mergedConfig = configManager.getMergedConfig();
  const includeExts = mergedConfig['knowledge.ingest.include'] as
    | string[]
    | undefined;
  if (includeExts && Array.isArray(includeExts) && includeExts.length > 0) {
    return !includeExts.some((e: string) => e.toLowerCase() === ext);
  }

  // 用户配置黑名单模式：在内置规则基础上额外排除
  const excludeExts = mergedConfig['knowledge.ingest.exclude'] as
    | string[]
    | undefined;
  if (excludeExts && Array.isArray(excludeExts) && excludeExts.length > 0) {
    if (excludeExts.some((e: string) => e.toLowerCase() === ext)) return true;
  }

  // 内置默认规则
  if (BINARY_SKIP_EXTENSIONS.has(ext)) return true;
  if (SKIP_DIRECTORIES.some((dir) => filePath.includes(dir))) return true;

  return false;
}

function isMediaOnlyFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return MEDIA_ONLY_EXTENSIONS.has(ext);
}

/**
 * 文件自动摄取服务
 * 
 * @deprecated 审批职责已迁移至 KnowledgeImportTool，本服务保留用于后台自动摄取。
 *             对于用户主动触发的文件导入，请使用 KnowledgeImportTool（含 Inbox 审批）。
 */
export class FileIngestionService {
  private knowledgeRoot: string;
  private rawDir: string;
  private aiService: AIService | null = null;

  constructor(aiService?: AIService) {
    this.knowledgeRoot = join(resolvePyappHome(), 'knowledge');
    this.rawDir = join(this.knowledgeRoot, 'raw');
    this.aiService = aiService || null;
  }

  /**
   * 设置 AI 服务实例
   */
  setAIService(service: AIService): void {
    this.aiService = service;
  }

  /**
   * 摄取单个文件
   * 将文件内容复制到知识库 raw/ 目录，并附带元数据文件
   */
  async ingestFile(
    filePath: string,
    source: IngestionSource,
    options: IngestionOptions = {}
  ): Promise<IngestionResult> {
    const resolvedPath = resolve(filePath);

    if (shouldSkipFile(resolvedPath)) {
      return {
        success: false,
        rawPath: '',
        fileName: basename(resolvedPath),
        category: 'other',
        action: 'skipped',
        error: '文件类型被跳过（二进制、大文件或系统目录）',
      };
    }

    if (!existsSync(resolvedPath)) {
      return {
        success: false,
        rawPath: '',
        fileName: basename(resolvedPath),
        category: 'other',
        action: 'error',
        error: `文件不存在: ${resolvedPath}`,
      };
    }

    try {
      await mkdir(this.rawDir, { recursive: true });

      const fileName = basename(resolvedPath);
      const rawTargetPath = join(this.rawDir, fileName);

      if (!options.force && existsSync(rawTargetPath)) {
        return {
          success: true,
          rawPath: rawTargetPath,
          fileName,
          category: options.category || 'other',
          action: 'skipped',
        };
      }

      let category = options.category || 'other';

      if (isMediaOnlyFile(resolvedPath)) {
        // 媒体文件：按类型分配默认分类，不尝试 AI 分类
        const mediaCategory = this.getMediaCategory(resolvedPath);
        category = options.category || mediaCategory;
      } else if (!options.skipClassification && this.aiService) {
        try {
          const content = await this.safeReadFile(resolvedPath);
          if (content) {
            category = await this.classifyContent(
              fileName,
              content.slice(0, 3000)
            );
          }
        } catch (err) {
          logger.warning('AI 分类失败，使用默认分类', { fileName });
        }
      }

      await copyFile(resolvedPath, rawTargetPath);

      await this.writeMetadata(fileName, {
        source,
        category,
        originalPath: resolvedPath,
        ingestedAt: new Date().toISOString(),
        description: options.description || '',
      });

      logger.info('文件已摄取到知识库', {
        fileName,
        category,
        source,
        target: rawTargetPath,
      });

      return {
        success: true,
        rawPath: rawTargetPath,
        fileName,
        category,
        action: 'created',
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await handleError(error, {
        module: 'knowledge:ingestion',
        action: 'ingest_file',
        context: { filePath },
      });
      return {
        success: false,
        rawPath: '',
        fileName: basename(resolvedPath),
        category: 'other',
        action: 'error',
        error: errMsg,
      };
    }
  }

  /**
   * 批量摄取多个文件
   */
  async ingestFiles(
    filePaths: string[],
    source: IngestionSource,
    options: IngestionOptions = {}
  ): Promise<IngestionResult[]> {
    const results: IngestionResult[] = [];
    for (const filePath of filePaths) {
      const result = await this.ingestFile(filePath, source, options);
      results.push(result);
    }
    return results;
  }

  /**
   * 获取 raw 目录中未编译的文件列表
   */
  async getUncompiledFiles(): Promise<string[]> {
    if (!existsSync(this.rawDir)) return [];

    const { readdir } = await import('fs/promises');
    const files = await readdir(this.rawDir);

    return files
      .filter((f) => f.endsWith('.txt') || f.endsWith('.md'))
      .map((f) => join(this.rawDir, f));
  }

  /**
   * 获取 raw 目录统计信息
   */
  async getStats(): Promise<{
    totalFiles: number;
    categories: Record<string, number>;
  }> {
    if (!existsSync(this.rawDir)) {
      return { totalFiles: 0, categories: {} };
    }

    const { readdir } = await import('fs/promises');
    const files = await readdir(this.rawDir);
    const metaFiles = files.filter((f) => f.endsWith('.meta.json'));
    const categories: Record<string, number> = {};

    for (const metaFile of metaFiles) {
      try {
        const content = await readFile(join(this.rawDir, metaFile), 'utf-8');
        const meta = JSON.parse(content);
        const cat = meta.category || 'other';
        categories[cat] = (categories[cat] || 0) + 1;
      } catch (err) {
        // 跳过损坏的元数据文件
      }
    }

    return {
      totalFiles: files.filter((f) => !f.endsWith('.meta.json')).length,
      categories,
    };
  }

  /**
   * 根据媒体文件扩展名获取默认分类
   */
  private getMediaCategory(filePath: string): FileCategory {
    const ext = extname(filePath).toLowerCase();
    const imageExtensions = new Set([
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.ico',
    ]);
    const audioExtensions = new Set(['.mp3', '.wav']);
    const videoExtensions = new Set(['.mp4', '.avi', '.mov']);
    const fontExtensions = new Set(['.woff', '.woff2', '.ttf', '.eot']);

    if (imageExtensions.has(ext)) return 'reference';
    if (audioExtensions.has(ext)) return 'reference';
    if (videoExtensions.has(ext)) return 'reference';
    if (fontExtensions.has(ext)) return 'reference';

    return 'other';
  }

  /**
   * 使用 AI 对文件内容进行分类
   */
  private async classifyContent(
    fileName: string,
    contentPreview: string
  ): Promise<FileCategory> {
    if (!this.aiService) return 'reference';

    const systemPrompt = `你是一个文件分类助手。根据文件名和内容预览，判断文件最适合的分类。

可选的分类：
- documentation: 项目文档、教程、API 参考、说明文件
- note: 个人笔记、备忘录、学习笔记
- reference: 参考资料、技术手册、规范文档
- project: 项目计划、需求文档、设计文档
- code: 源代码文件（虽然可能被跳过）
- config: 配置文件、环境配置、依赖配置
- data: 数据文件、CSV、日志文件
- other: 其他类型

仅返回分类名称，不要有其他文字。`;

    const messages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: systemPrompt,
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: `文件名: ${fileName}\n\n内容预览:\n${contentPreview}`,
        timestamp: Date.now(),
      },
    ];

    try {
      const response = await this.aiService.generate(messages);
      const category = response.content.trim().toLowerCase() as FileCategory;
      const validCategories: FileCategory[] = [
        'documentation',
        'note',
        'reference',
        'project',
        'code',
        'config',
        'data',
        'other',
      ];
      return validCategories.includes(category) ? category : 'reference';
    } catch (err) {
      return 'reference';
    }
  }

  /**
   * 写入元数据文件
   */
  private async writeMetadata(
    fileName: string,
    metadata: {
      source: IngestionSource;
      category: FileCategory;
      originalPath: string;
      ingestedAt: string;
      description: string;
    }
  ): Promise<void> {
    const metaPath = join(this.rawDir, `${fileName}.meta.json`);
    await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /**
   * 安全读取文件（仅文本文件）
   */
  private async safeReadFile(filePath: string): Promise<string | null> {
    try {
      const ext = extname(filePath).toLowerCase();
      if (!isEditableTextFile(ext)) return null;

      const stats = await stat(filePath);
      if (stats.size > 1024 * 1024) return null;

      return await readFile(filePath, 'utf-8');
    } catch (err) {
      return null;
    }
  }
}

/**
 * 获取默认的 FileIngestionService 实例
 */
let defaultIngestionService: FileIngestionService | null = null;

export function getDefaultIngestionService(
  aiService?: AIService
): FileIngestionService {
  if (!defaultIngestionService) {
    defaultIngestionService = new FileIngestionService(aiService);
  }
  return defaultIngestionService;
}

export function resetDefaultIngestionService(): void {
  defaultIngestionService = null;
}
