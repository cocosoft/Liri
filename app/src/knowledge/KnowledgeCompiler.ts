/**
 * LLM 知识编译管道 (KnowledgeCompiler)
 * Many-to-many 编译范型 — 对标 Karpathy LLM Wiki 方法论
 *
 * 一条 raw 源文件触发多页面更新：
 *   1. 创建/更新主摘要页
 *   2. 提取实体/概念生成独立页面
 *   3. 更新现有相关页面（交叉引用、矛盾标注）
 *
 * 职责：
 *   1. 读取 raw/ 目录的原始数据文件
 *   2. 通过 LLM 编译为多个结构化 Markdown wiki 页面
 *   3. 写入知识库目录并更新索引（index.md / log.md）
 *   4. 追踪原始文件来源（通过 companion .meta.json）
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { resolvePyappHome, resolveDataSubDir } from '@modules/core';
import { FileRegistry } from '@modules/services/file/FileRegistry';
import { FileSource } from '@modules/services/file/types';
import { IndexManager } from './IndexManager';
import { WikiLinter, defaultRules } from './lint/WikiLinter';
import { providerRegistry } from '@modules/ai';

const logger = new Logger({
  module: 'knowledge:knowledgeCompiler',
  level: LogLevel.INFO,
});

/** 编译状态记录文件路径 */
const COMPILE_STATE_PATH = join(
  resolveDataSubDir(''),
  'knowledge-compile-state.json'
);

/** 编译状态快照 */
interface CompileState {
  lastCompileAt: number;
  docs: Record<string, { mtime: number; compiledAt: number }>;
}

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

/** LLM 输出中 page-break 分隔符 */
const PAGE_BREAK = '---page-break---';

export interface CompileOptions {
  /** 是否强制重编译所有文件，默认 false（仅编译更新的文件） */
  force?: boolean;
  /** 最大并发编译数，默认 3 */
  concurrency?: number;
  /** 编译后是否自动运行 lint 检查，默认 true */
  lint?: boolean;
  /** 编译时使用的模型名，默认使用 aiService 的默认模型 */
  model?: string;
}

export interface CompileResult {
  compiled: number;
  skipped: number;
  errors: string[];
  totalFound: number;
  /** many-to-many: 实际生成的 wiki 页面总数（一条源文件可生成多页） */
  pagesCreated: number;
}

/**
 * LLM 知识编译器
 * Many-to-many 编译范型：
 *   一条 raw 源文件 → LLM 产出多个 wiki 页面（摘要页 + 实体/概念页）
 *   自动维护 index.md / log.md，确保知识"积累"而非替换。
 */
export class KnowledgeCompiler {
  private knowledgeRoot: string;
  private rawDir: string;
  private aiService: AIService;
  private indexManager: IndexManager;

  constructor(aiService: AIService) {
    this.knowledgeRoot = join(resolvePyappHome(), 'knowledge');
    this.rawDir = join(this.knowledgeRoot, 'raw');
    this.aiService = aiService;
    this.indexManager = new IndexManager(this.knowledgeRoot);
  }

  /**
   * 执行编译（many-to-many）
   * 每条 raw 源文件触发多页面生成，完成后更新索引
   */
  async compile(options: CompileOptions = {}): Promise<CompileResult> {
    const { force = false, model } = options;

    const result: CompileResult = {
      compiled: 0,
      skipped: 0,
      errors: [],
      totalFound: 0,
      pagesCreated: 0,
    };

    if (!existsSync(this.rawDir)) {
      logger.info('raw 目录不存在，跳过编译', { rawDir: this.rawDir });
      return result;
    }

    await mkdir(this.knowledgeRoot, { recursive: true });

    const rawFiles = await this.collectRawFiles();
    result.totalFound = rawFiles.length;

    if (rawFiles.length === 0) return result;

    // 加载编译状态快照，用于跳过无变更文件
    const compileState = await this.loadCompileState();
    const newState: CompileState = { lastCompileAt: Date.now(), docs: {} };

    // 检查是否有可用 Provider：options.model 显式指定时不检查
    if (!model && providerRegistry.size === 0) {
      const errMsg =
        '未找到可用供应商，跳过编译。请通过 /provider 命令配置供应商（如 deepseek/openai）。';
      logger.error('知识编译失败', { error: errMsg });
      result.errors.push(errMsg);
      return result;
    }

    for (const rawFile of rawFiles) {
      try {
        let needsCompile = force || (await this.needsRecompile(rawFile));

        // 增量优化：通过编译状态快照跳过 mtime 未变更的文件
        if (!force && !needsCompile) {
          const rawStat = await stat(rawFile);
          const prevState = compileState?.docs[rawFile];
          if (prevState && prevState.mtime === rawStat.mtimeMs) {
            // mtime 完全一致，且已有编译产物，可以安全跳过
            result.skipped++;
            newState.docs[rawFile] = prevState;
            continue;
          }
          // mtime 变更了但 needsRecompile 返回 false（可能编译产物仍更新）
          // 保守策略：仍需检查，但不需要强制重编译
          needsCompile = false;
        }

        if (!needsCompile) {
          // 记录当前 mtime 到新快照（即使跳过也要记录，避免下次重复判断）
          try {
            const rawStat = await stat(rawFile);
            newState.docs[rawFile] = {
              mtime: rawStat.mtimeMs,
              compiledAt: compileState?.docs[rawFile]?.compiledAt ?? Date.now(),
            };
          } catch {
            // stat 失败忽略
          }
          result.skipped++;
          continue;
        }

        const pages = await this.compileFile(rawFile, model);
        result.compiled++;
        result.pagesCreated += pages.length;

        // 编译成功，记录到快照
        try {
          const rawStat = await stat(rawFile);
          newState.docs[rawFile] = {
            mtime: rawStat.mtimeMs,
            compiledAt: Date.now(),
          };
        } catch {
          // stat 失败忽略
        }

        logger.info('文件编译完成', { file: rawFile, pages: pages.length });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`${rawFile}: ${errMsg}`);
        logger.error('文件编译失败', { file: rawFile, error: errMsg });
      }
    }

    // 持久化编译状态快照
    await this.saveCompileState(newState);

    // many-to-many: 全部编译完成后更新索引
    if (result.pagesCreated > 0) {
      await this.indexManager.updateIndexMd();
      await this.indexManager.appendLog({
        timestamp: Date.now(),
        action: 'compile',
        source: 'KnowledgeCompiler',
        pages: [],
        detail: `many-to-many 编译: ${result.compiled} 个源文件 → ${result.pagesCreated} 个页面`,
      });
    }

    // 编译后自动运行 lint 检查
    const shouldLint = options.lint !== false;
    if (shouldLint && result.pagesCreated > 0) {
      try {
        const linter = new WikiLinter(defaultRules);
        const lintReport = await linter.run(this.knowledgeRoot);
        const { error, warning } = lintReport.summary;
        if (error > 0 || warning > 0) {
          logger.warn(`编译后 lint 发现 ${error} 个错误, ${warning} 个警告`, {
            lintSummary: lintReport.summary,
          });
          // 将 lint 结果追加到 log.md
          await this.indexManager.appendLog({
            timestamp: Date.now(),
            action: 'lint',
            source: 'KnowledgeCompiler',
            pages: [],
            detail: `lint: ${error} errors, ${warning} warnings`,
          });
        } else {
          logger.info('编译后 lint 检查通过');
        }
      } catch (lintError) {
        await handleError(lintError, {
          module: 'knowledge:compiler',
          action: 'post_lint',
        });
      }
    }

    logger.info(
      `many-to-many 编译完成: ${result.compiled} 个源文件, ` +
        `${result.pagesCreated} 个页面, ${result.skipped} 个跳过, ` +
        `${result.errors.length} 个错误`
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
   * 判断是否需要重编译（many-to-many 感知）
   * 检查 .meta.json 中记录的 pages 列表，任一页面缺失或过时就重编译
   */
  private async needsRecompile(rawFile: string): Promise<boolean> {
    const metaFile = `${rawFile}.meta.json`;
    if (!existsSync(metaFile)) return true;

    try {
      const metaContent = await readFile(metaFile, 'utf-8');
      const meta = JSON.parse(metaContent);
      const pages: string[] = meta.pages;
      if (!pages || pages.length === 0) return true;

      const rawStat = await stat(rawFile);
      for (const pagePath of pages) {
        if (!existsSync(pagePath)) return true;
        const pageStat = await stat(pagePath);
        if (rawStat.mtimeMs > pageStat.mtimeMs) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  /**
   * 获取主摘要页的目标路径（many-to-many 中的"主入口页"）
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
   * 编译单个文件 → 产出多个 wiki 页面（many-to-many）
   *
   * 调用 LLM 生成多页内容（以 PAGE_BREAK 分隔），
   * 每页写入独立文件，并更新 companion .meta.json 记录 pages 列表
   *
   * @returns 生成的所有页面文件路径列表
   */
  private async compileFile(
    rawFile: string,
    model?: string
  ): Promise<string[]> {
    const rawContent = await readFile(rawFile, 'utf-8');
    const targetPath = this.getWikiTargetPath(rawFile);
    const fileName =
      targetPath.split(/[\\/]/).pop()?.replace(/\.md$/, '') || 'untitled';

    // many-to-many: 调用 LLM 生成多页内容
    const pagesContent = await this.generateManyPages(
      fileName,
      rawContent,
      targetPath,
      model
    );

    // 写入所有页面
    const writtenPages: string[] = [];
    for (const { filePath, content } of pagesContent) {
      const finalContent = await this.injectOriginalFileMeta(
        rawFile,
        content,
        filePath
      );
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, finalContent, 'utf-8');
      writtenPages.push(filePath);
    }

    // 更新 companion .meta.json 记录 pages 列表
    const metaFile = `${rawFile}.meta.json`;
    const meta = { pages: writtenPages, updatedAt: Date.now() };
    await writeFile(metaFile, JSON.stringify(meta, null, 2), 'utf-8');

    // 注册编译后的知识文档到 FileRegistry
    try {
      const registry = FileRegistry.getInstance();
      await registry.initDatabase();
      for (const pagePath of writtenPages) {
        await registry.registerFile({
          originalName: pagePath.split(/[\\/]/).pop() || 'page.md',
          content:
            pagesContent.find((p) => p.filePath === pagePath)?.content || '',
          source: FileSource.AUTO_INGEST,
          sourceId: rawFile.split(/[\\/]/).pop() || 'raw',
          description: `知识编译: ${pagePath.split(/[\\/]/).pop()}`,
          mimeType: 'text/markdown',
          storeZone: 'inbound',
        });
      }
    } catch {
      // 注册失败不影响编译主流程
    }

    return writtenPages;
  }

  /**
   * 从 companion .meta.json 读取原始文件信息并注入 frontmatter
   *
   * @param rawFile    源文件路径
   * @param wikiContent  待注入的 wiki 内容
   * @param _targetPath  目标文件路径（当前仅用于签名一致，预留扩展用）
   */
  private async injectOriginalFileMeta(
    rawFile: string,
    wikiContent: string,
    _targetPath?: string
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
   * 多页 LLM 生成（many-to-many）
   *
   * 将一条 raw 源文件发送给 LLM，要求产出多个独立 wiki 页面：
   *   - 第一页为主摘要页（概述/背景/核心概念）
   *   后续页为关联的实体/概念/术语页面
   *
   * 每页以 PAGE_BREAK (`---page-break---`) 分隔，
   * 每页包含独立 frontmatter（id, title, kind, tags, summary）
   * 以及 Markdown 正文。
   *
   * @param title    主摘要页标题
   * @param rawContent  源文件原始内容
   * @param targetPath  主摘要页的目标路径（用于计算关联页路径）
   * @returns  {filePath, content}[]  要写入的页面列表
   */
  private async generateManyPages(
    title: string,
    rawContent: string,
    targetPath: string,
    model?: string
  ): Promise<Array<{ filePath: string; content: string }>> {
    const systemPrompt = `你是一个知识库编译助手。采用 "many-to-many" 编译范型：
一条源文件应产出多个独立 wiki 页面（摘要页 + 相关概念页）。

要求：
1. 第一页为 **主摘要页**：概述源文件的核心内容，包含背景/关键信息/结论
2. 后续页为 **关联实体/概念页**：提取源文件中的重要术语、概念、人物、技术等，各生成独立页面
3. 每页有独立的意义 — 不要把一句话拆成一页

输出格式：
- 每页之间用 "${PAGE_BREAK}" 分隔（独占一行）
- 每页以标准 YAML frontmatter（\`---\` 包裹）开头
- frontmatter 必须包含: id（英文连字符格式, 如 "knowledge-base"）, title, kind（"summary" | "concept" | "entity"）, tags, summary

示例：
---
id: ${title.toLowerCase().replace(/\\s+/g, '-')}
title: ${title}
kind: summary
tags: []
summary: 源文件的核心摘要
---

## 概述

...

## 正文

...

## 相关概念

- [[related-concept]]

${PAGE_BREAK}
---
id: related-concept
title: 相关概念
kind: concept
tags: []
summary: 概念简介
---

## 定义

...

## 详情

...

---
注意：
- 所有页面使用 [[]] Wiki 链接互相引用
- 如果已有相关概念页面存在，在末尾添加 "## 更新记录" 备注变更
- 输出必须包含至少 2 页，最多 8 页`;

    const messages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: systemPrompt,
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: rawContent.slice(0, 16000),
        timestamp: Date.now(),
      },
    ];

    const response = await this.aiService.generate(messages, model);
    const rawOutput = response.content.trim();

    // 按 PAGE_BREAK 分隔为多个页面
    const blocks = rawOutput
      .split(new RegExp(`\\n${PAGE_BREAK}\\n`))
      .map((b) => b.trim())
      .filter(Boolean);

    if (blocks.length === 0) {
      // 保底：LLM 未产出多页，按单页处理
      let content = rawOutput;
      if (!content.startsWith('---')) {
        content = `---\ntitle: ${title}\ntags: []\nkind: summary\ncategory: 知识库\nsummary: 由原始文件编译\n---\n\n${content}`;
      }
      return [{ filePath: targetPath, content }];
    }

    // 解析每页的 frontmatter 提取 id 用于生成文件名
    const pages: Array<{ filePath: string; content: string }> = [];
    const mainDir = dirname(targetPath);

    for (const block of blocks) {
      const id = this.extractFrontmatterField(block, 'id');
      const kind = this.extractFrontmatterField(block, 'kind') || 'concept';

      // 确定文件名：主摘要页复用 targetPath，概念页用 id.md
      let pagePath: string;
      if (pages.length === 0) {
        // 第一页写为主摘要页
        pagePath = targetPath;
      } else {
        const safeId = id || `page-${pages.length}`;
        // 按 kind 分类存放：summary/ entity/ concept
        const subDir = join(mainDir, kind);
        pagePath = join(subDir, `${safeId}.md`);
      }

      pages.push({ filePath: pagePath, content: block });
    }

    return pages;
  }

  /**
   * 从 frontmatter 块中提取指定字段值
   */
  private extractFrontmatterField(block: string, field: string): string | null {
    const match = block.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fm = match[1];
    const lineMatch = fm.match(new RegExp(`^${field}:\\s*(.+)`, 'm'));
    return lineMatch ? lineMatch[1].trim().replace(/^"(.*)"$/, '$1') : null;
  }

  /**
   * 加载编译状态快照
   */
  private async loadCompileState(): Promise<CompileState | null> {
    try {
      if (!existsSync(COMPILE_STATE_PATH)) return null;
      const raw = await readFile(COMPILE_STATE_PATH, 'utf-8');
      return JSON.parse(raw) as CompileState;
    } catch {
      return null;
    }
  }

  /**
   * 持久化编译状态快照
   */
  private async saveCompileState(state: CompileState): Promise<void> {
    try {
      const dir = dirname(COMPILE_STATE_PATH);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(
        COMPILE_STATE_PATH,
        JSON.stringify(state, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.warning('编译状态快照保存失败', { error: String(error) });
    }
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
