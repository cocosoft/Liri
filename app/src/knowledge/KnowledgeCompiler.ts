/**
 * LLM 知识编译管道 (KnowledgeCompiler)
 * 对标 OpenClaw wiki 编译模式与 Hermes memory provider 架构
 *
 * 职责：
 *   1. 读取 raw/ 目录的原始数据文件
 *   2. 通过 LLM 编译为结构化 Markdown wiki 文档
 *   3. 写入知识库目录并更新摘要缓存
 *   4. 追踪原始文件来源（通过 companion .meta.json）
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { AIService, AIMessage } from '@modules/ai/models/types';
import { AIMessageRole } from '@modules/ai/models/types';
import { resolvePyappHome } from '@modules/core/paths';
import { FileRegistry } from '@modules/services/file/FileRegistry';
import { FileSource, type StoreZone } from '@modules/services/file/types';

const logger = new Logger({ level: LogLevel.INFO });

/** 可编译的文件扩展名（不含 .meta.json 伴侣文件） */
const COMPILABLE_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.tsv',
  '.xml',
  '.yaml',
  '.yml',
]);

export interface CompileOptions {
  /** 是否强制重编译所有文件，默认 false（仅编译更新的文件） */
  force?: boolean;
  /** 最大并发编译数，默认 3 */
  concurrency?: number;
}

export interface CompileResult {
  compiled: number;
  skipped: number;
  errors: string[];
  totalFound: number;
}

/**
 * LLM 知识编译器
 * 将 raw/ 原始数据处理为结构化 wiki 文档
 */
export class KnowledgeCompiler {
  private knowledgeRoot: string;
  private rawDir: string;
  private aiService: AIService;

  constructor(aiService: AIService) {
    this.knowledgeRoot = join(resolvePyappHome(), 'knowledge');
    this.rawDir = join(this.knowledgeRoot, 'raw');
    this.aiService = aiService;
  }

  /**
   * 执行编译
   */
  async compile(options: CompileOptions = {}): Promise<CompileResult> {
    const { force = false } = options;

    const result: CompileResult = {
      compiled: 0,
      skipped: 0,
      errors: [],
      totalFound: 0,
    };

    if (!existsSync(this.rawDir)) {
      logger.info('raw 目录不存在，跳过编译', { rawDir: this.rawDir });
      return result;
    }

    await mkdir(this.knowledgeRoot, { recursive: true });

    const rawFiles = await this.collectRawFiles();
    result.totalFound = rawFiles.length;

    if (rawFiles.length === 0) return result;

    for (const rawFile of rawFiles) {
      try {
        const needsCompile = force || (await this.needsRecompile(rawFile));
        if (!needsCompile) {
          result.skipped++;
          continue;
        }

        await this.compileFile(rawFile);
        result.compiled++;
        logger.info('文件编译完成', { file: rawFile });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`${rawFile}: ${errMsg}`);
        logger.error('文件编译失败', { file: rawFile, error: errMsg });
      }
    }

    logger.info(
      `编译完成: ${result.compiled} 个编译, ${result.skipped} 个跳过, ${result.errors.length} 个错误`
    );

    return result;
  }

  /**
   * 收集 raw 目录中的可编译文件
   */
  private async collectRawFiles(): Promise<string[]> {
    const files: string[] = [];
    const rawFiles = await readdir(this.rawDir);

    for (const file of rawFiles) {
      // 跳过伴侣元数据文件
      if (file.endsWith('.meta.json')) continue;

      const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
      if (COMPILABLE_EXTENSIONS.has(ext)) {
        files.push(join(this.rawDir, file));
      }
    }

    return files.sort();
  }

  /**
   * 判断是否需要重编译
   * 比较 raw 源文件和目标 wiki 文件的修改时间
   */
  private async needsRecompile(rawFile: string): Promise<boolean> {
    const wikiFile = this.getWikiTargetPath(rawFile);

    if (!existsSync(wikiFile)) return true;

    try {
      const rawStat = await stat(rawFile);
      const wikiStat = await stat(wikiFile);
      return rawStat.mtimeMs > wikiStat.mtimeMs;
    } catch {
      return true;
    }
  }

  /**
   * 获取编译后的目标路径
   */
  private getWikiTargetPath(rawFile: string): string {
    const baseName = rawFile.replace(
      /\.(txt|json|csv|tsv|xml|yaml|yml)$/,
      '.md'
    );
    const fileName = baseName.split(/[\\/]/).pop() || 'untitled.md';
    return join(this.knowledgeRoot, fileName);
  }

  /**
   * 编译单个文件
   */
  private async compileFile(rawFile: string): Promise<void> {
    const rawContent = await readFile(rawFile, 'utf-8');
    const targetPath = this.getWikiTargetPath(rawFile);
    const fileName =
      targetPath.split(/[\\/]/).pop()?.replace(/\.md$/, '') || 'untitled';

    const wikiContent = await this.generateWikiContent(fileName, rawContent);

    // 读取 companion meta.json 注入原始文件追溯信息
    const finalContent = await this.injectOriginalFileMeta(
      rawFile,
      wikiContent
    );

    await writeFile(targetPath, finalContent, 'utf-8');

    // 注册编译后的知识文档到 FileRegistry
    try {
      const registry = FileRegistry.getInstance();
      await registry.initDatabase();
      await registry.registerFile({
        originalName: targetPath.split(/[\\/]/).pop() || 'compiled.md',
        content: finalContent,
        source: FileSource.AUTO_INGEST,
        sourceId: rawFile.split(/[\\/]/).pop() || 'raw',
        description: `知识编译: ${fileName}`,
        mimeType: 'text/markdown',
        storeZone: 'inbound',
      });
    } catch {
      // 注册失败不影响编译主流程
    }
  }

  /**
   * 从 companion .meta.json 读取原始文件信息并注入 frontmatter
   */
  private async injectOriginalFileMeta(
    rawFile: string,
    wikiContent: string
  ): Promise<string> {
    const metaFile = `${rawFile}.meta.json`;
    if (!existsSync(metaFile)) return wikiContent;

    try {
      const metaContent = await readFile(metaFile, 'utf-8');
      const meta = JSON.parse(metaContent);

      if (meta.originalFile || meta.originalFormat) {
        const lines = wikiContent.split('\n');
        let fmEnd = -1;
        if (lines[0]?.trim() === '---') {
          fmEnd = lines.indexOf('---', 1);
        }
        if (fmEnd !== -1) {
          const fmLines = lines.slice(1, fmEnd);
          const hasOriginalFile = fmLines.some((l) =>
            l.startsWith('originalFile:')
          );
          const hasOriginalFormat = fmLines.some((l) =>
            l.startsWith('originalFormat:')
          );

          if (!hasOriginalFile && meta.originalFile) {
            fmLines.splice(1, 0, `originalFile: "${meta.originalFile}"`);
          }
          if (!hasOriginalFormat && meta.originalFormat) {
            fmLines.splice(2, 0, `originalFormat: "${meta.originalFormat}"`);
          }

          return ['---', ...fmLines, '---', ...lines.slice(fmEnd + 1)].join(
            '\n'
          );
        }
      }
    } catch {
      // 元数据文件损坏或缺失，忽略
    }

    return wikiContent;
  }

  /**
   * 使用 LLM 生成结构化 wiki 文档
   */
  private async generateWikiContent(
    title: string,
    rawContent: string
  ): Promise<string> {
    const systemPrompt = `你是一个知识库编译助手。将以下原始内容编译为结构化的 Markdown wiki 文档。

输出格式要求：
1. 以 YAML frontmatter 开头，包含: title, tags, category, summary
2. 使用 Markdown 标题层级组织内容
3. 对重要概念添加 [[]] Wiki 链接标记
4. 末尾添加 "## 相关概念" 小节，列举关联的 wiki 页面

输出必须严格使用以下模板格式:
---
title: ${title}
tags: []
category: 知识库
summary: 简要摘要，不超过 200 字
---

## 概述

...

## 正文

...

## 相关概念

- [[]]`;

    const messages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: systemPrompt,
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: rawContent.slice(0, 8000),
        timestamp: Date.now(),
      },
    ];

    const response = await this.aiService.generate(messages);
    let content = response.content.trim();

    if (!content.startsWith('---')) {
      content = `---\ntitle: ${title}\ntags: []\ncategory: 知识库\nsummary: 由原始文件编译\n---\n\n${content}`;
    }

    return content;
  }
}

/**
 * 一键执行知识编译
 */
export async function runKnowledgeCompile(
  aiService: AIService,
  options?: CompileOptions
): Promise<CompileResult> {
  const compiler = new KnowledgeCompiler(aiService);
  return compiler.compile(options);
}
