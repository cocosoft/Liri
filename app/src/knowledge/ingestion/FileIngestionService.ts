/**
 * FileIngestionService - 文件自动摄取服务
 * 当文件被读取或上传时，自动将其内容整理到知识库 raw/ 目录，
 * 为后续 KnowledgeCompiler 编译和做梦整理提供原料。
 */
import { readFile, writeFile, mkdir, copyFile, stat } from 'fs/promises';
import { join, extname, basename, resolve } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { AIService, AIMessage } from '@modules/ai/models/types';
import { AIMessageRole } from '@modules/ai/models/types';
import { resolvePyappHome } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

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
 * 需要跳过的文件扩展名（代码文件、二进制文件等）
 */
const SKIP_EXTENSIONS = new Set([
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
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.ico',
  '.svg',
  '.mp3',
  '.wav',
  '.mp4',
  '.avi',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.wasm',
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
  ]);
  return textExtensions.has(ext);
}

function shouldSkipFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;

  if (SKIP_DIRECTORIES.some((dir) => filePath.includes(dir))) return true;

  return false;
}

/**
 * 文件自动摄取服务
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

      if (!options.skipClassification && this.aiService) {
        try {
          const content = await this.safeReadFile(resolvedPath);
          if (content) {
            category = await this.classifyContent(
              fileName,
              content.slice(0, 3000)
            );
          }
        } catch {
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
      logger.error('文件摄取失败', { filePath, error: errMsg });
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
      } catch {
        // 跳过损坏的元数据文件
      }
    }

    return {
      totalFiles: files.filter((f) => !f.endsWith('.meta.json')).length,
      categories,
    };
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
    } catch {
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
    } catch {
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
