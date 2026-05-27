/**
 * LLM 知识编译管道 (KnowledgeCompiler)
 * 对标 OpenClaw wiki 编译模式与 Hermes memory provider 架构
 *
 * 职责：
 *   1. 读取 raw/ 目录的原始数据文件
 *   2. 通过 LLM 编译为结构化 Markdown wiki 文档
 *   3. 写入知识库目录并更新摘要缓存
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { AIService, AIMessage } from '@modules/ai/models/types';
import { AIMessageRole } from '@modules/ai/models/types';
import { resolvePyappHome } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

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
      if (
        file.endsWith('.txt') ||
        file.endsWith('.md') ||
        file.endsWith('.json')
      ) {
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
    const baseName = rawFile.replace(/\.(txt|json)$/, '.md');
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

    await writeFile(targetPath, wikiContent, 'utf-8');
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
