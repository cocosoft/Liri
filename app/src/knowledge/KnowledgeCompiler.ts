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
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { LLMPerformanceMonitor } from '@modules/ai';
import { handleError } from '@modules/error';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import {
  resolvePyappHome,
  resolveDataSubDir,
  globalEventBus,
} from '@modules/core';
import { FileRegistry } from '@modules/services/file/FileRegistry';
import { FileSource } from '@modules/services/file/types';
import { IndexManager } from './IndexManager';
import { WikiLinter, defaultRules } from './lint/WikiLinter';
import { providerRegistry, modelRouter } from '@modules/ai';
import {
  createMaxOutputRetryState,
  advanceMaxOutputRetry,
} from '@modules/ai/MaxOutputRetryHandler';
import { GraphExtractor } from './graph/GraphExtractor';
import { KnowledgeGraph } from './graph/KnowledgeGraph';
import { SchemaLoader } from './schema/SchemaLoader';
import { RecordStore } from './record/RecordStore';
import { extractRecordsFromCompiledPages } from './record/RecordExtractor';
import { RuleStore } from './rule/RuleStore';
import {
  extractRulesFromCompiledPages,
  detectRuleConflicts,
} from './rule/RuleExtractor';
import { computeFileDigest } from './lineage/contentFingerprint';
import { LineageStore } from './lineage/LineageStore';
import {
  extractDocument,
  DOCUMENT_EXTRACT_EXTS,
} from './ingestion/extractors/TextExtractor';
// 内存水位（2026-09-02）：非关键后台任务在压力下暂停（OS kswapd 式分级回收）
import { isMemoryUnderPressure } from '../monitoring/memoryPressure/MemoryPressureMonitor.js';
import {
  startCompileProgress,
  updateCompileProgress,
  finishCompileProgress,
  abortCompileProgress,
} from './CompileProgressTracker';

const logger = new OTelAwareLogger({
  module: 'knowledge:compiler',
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
  /** 编译轮次版本（K5.3：血缘/快照绑定，每次编译运行 +1） */
  lastVersion?: number;
  docs: Record<
    string,
    {
      mtime: number;
      compiledAt: number;
      /** 内容指纹（K5.1：sha1(raw 字节)，用于 mtime 未变时的内容变更检测） */
      digest?: string;
    }
  >;
}

/** 可编译的文件扩展名（不含 .meta.json 伴侣文件）
 * K1（知识库优化）：加入 PDF/DOCX/XLSX——文档类在 compileFile 入口经 extractor 抽取
 * 文本层后进入既有 LLM 编译管线（见 TextExtractor.DOCUMENT_EXTRACT_EXTS）。 */
const COMPILABLE_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.tsv',
  '.xml',
  '.yaml',
  '.yml',
  ...DOCUMENT_EXTRACT_EXTS,
]);

/** LLM 输出中 page-break 分隔符 */
const PAGE_BREAK = '---page-break---';

/**
 * 知识编译单次 LLM 输出 token 预算（P0 长文截断修复，2026-09-07）
 * transport 层 max_tokens 缺省 4096（ChatCompletionsTransport），多页产物易被静默截断；
 * 预算优先取 DB model_registry.max_output_tokens（数出同源），无记录/读取失败时用本默认值。
 */
const COMPILE_DEFAULT_MAX_TOKENS = 8192;
/** 编译单次输出 token 硬上限（对齐 ai/MaxOutputRetryHandler 的 maxOutputLimit） */
const COMPILE_MAX_TOKENS_LIMIT = 64000;

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
  /** 编译产出的文件路径列表（用于后续图谱提取） */
  compiledFiles: string[];
  /** R4：本次实际产出页面的源 raw 列表（原文分块刷新钩子用） */
  compiledRaws: string[];
  /** 编译轮次版本（K5.3，血缘/快照绑定） */
  version?: number;
  /** 编译质量信息（v1.5 新增） */
  quality?: {
    /** 0-100，基于 lint 问题数计算 */
    lintScore: number;
    /** 是否有告警 */
    hasWarnings: boolean;
    /** 编译失败次数（用于回滚阈值判断） */
    consecutiveFails: number;
  };
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
  private graphExtractor?: GraphExtractor;
  /**
   * 图谱自动提取互斥（2026-09-02 排查"会话中断"补充）：编译可能被调度器/
   * 用户多次触发叠加——若已有提取在进行，本次跳过避免后台任务堆积竞争事件循环
   * 与内存（证据：agentic 运行期与图谱提取并发时 RSS 尖峰 2-4.4GB、GC STW 最长 13.9s）。
   */
  private graphExtractRunning = false;
  /** 单次编译后图谱提取的页数上限（initial-build 全量重建防止无限排空） */
  private static readonly GRAPH_EXTRACT_MAX_PAGES = 50;
  /** 单页内容上限：超过则跳过提取（提取 prompt 仅用前 8000 字符，读入超大页纯属浪费内存） */
  private static readonly GRAPH_EXTRACT_MAX_FILE_BYTES = 1024 * 1024;
  /** 编译 max_tokens 预算缓存（key=模型名，避免逐文件查 DB；P0 长文截断修复） */
  private maxTokensCache = new Map<string, number>();
  /** K5 血缘：可选注入的 LineageStore（记录 doc→page 血缘） */
  private lineage?: LineageStore;
  /** K5.3 本次编译版本（runner 注入） */
  private compileVersion = 1;

  constructor(
    aiService: AIService,
    graphExtractor?: GraphExtractor,
    runtime?: { lineage?: LineageStore; version?: number }
  ) {
    this.knowledgeRoot = join(resolvePyappHome(), 'knowledge');
    this.rawDir = join(this.knowledgeRoot, 'raw');
    this.aiService = aiService;
    this.graphExtractor = graphExtractor;
    this.lineage = runtime?.lineage;
    this.compileVersion = runtime?.version ?? 1;
    this.indexManager = new IndexManager(this.knowledgeRoot);
  }

  /**
   * 执行编译（many-to-many）
   * 每条 raw 源文件触发多页面生成，完成后更新索引
   */
  async compile(options: CompileOptions = {}): Promise<CompileResult> {
    const { force = false, model } = options;

    // 编译模型解析：显式通过模型路由（DB 唯一事实来源）解析，
    // 任务类型 knowledge_compile（模型管理 → 任务分工可配置），
    // 避免回退到 ProviderRegistry 默认 provider 的不可控默认模型
    // （曾导致无效模型名 Pro/moonshotai/Kimi-K2.6 调 SiliconFlow 端点 400）
    const resolvedModel =
      model ||
      (await modelRouter.resolveAsync('knowledge_compile')) ||
      undefined;

    const result: CompileResult = {
      compiled: 0,
      skipped: 0,
      errors: [],
      totalFound: 0,
      pagesCreated: 0,
      compiledFiles: [],
      compiledRaws: [],
    };

    if (!existsSync(this.rawDir)) {
      logger.info('raw 目录不存在，跳过编译', { rawDir: this.rawDir });
      return result;
    }

    await mkdir(this.knowledgeRoot, { recursive: true });

    const rawFiles = await this.collectRawFiles();
    result.totalFound = rawFiles.length;

    if (rawFiles.length === 0) return result;

    // W9: 开始编译进度追踪
    startCompileProgress(rawFiles.length);

    // 加载编译状态快照，用于跳过无变更文件
    const compileState = await this.loadCompileState();
    // K5.3：编译轮次版本（血缘/快照绑定，每次运行 +1）
    const version = (compileState?.lastVersion ?? 0) + 1;
    this.compileVersion = version;
    const newState: CompileState = {
      lastCompileAt: Date.now(),
      lastVersion: version,
      docs: {},
    };
    // K5.1：raw 内容指纹缓存（同一次编译内每个文件至多读一次）
    const digestCache = new Map<string, string>();
    const digestFor = async (file: string): Promise<string> => {
      let digest = digestCache.get(file);
      if (!digest) {
        digest = await computeFileDigest(file);
        digestCache.set(file, digest);
      }
      return digest;
    };

    // 清理已删除 raw 文件的编译产物
    const cleanedCount = await this.cleanupDeletedRawFiles(
      new Set(rawFiles),
      compileState
    );
    if (cleanedCount > 0) {
      logger.info('已清理已删除 raw 文件的编译产物', { cleanedCount });
    }

    // 检查是否有可用 Provider：options.model 显式指定时不检查
    if (!resolvedModel && providerRegistry.size === 0) {
      const errMsg =
        '未找到可用供应商，跳过编译。请通过 /provider 命令配置供应商（如 deepseek/openai）。';
      logger.error('知识编译失败', { error: errMsg });
      result.errors.push(errMsg);
      abortCompileProgress(errMsg);
      return result;
    }

    for (const rawFile of rawFiles) {
      try {
        let needsCompile = force || (await this.needsRecompile(rawFile));

        // 增量优化：通过编译状态快照跳过 mtime 未变更的文件；
        // K5.1：mtime 一致时再比对内容指纹，内容变但 mtime 未变也触发重编译
        if (!force && !needsCompile) {
          const rawStat = await stat(rawFile);
          const prevState = compileState?.docs[rawFile];
          if (prevState && prevState.mtime === rawStat.mtimeMs) {
            if (prevState.digest) {
              const digest = await digestFor(rawFile);
              if (digest === prevState.digest) {
                // 指纹一致 → 内容未变，安全跳过
                result.skipped++;
                newState.docs[rawFile] = prevState;
                updateCompileProgress(result.compiled + result.skipped);
                continue;
              }
              // 指纹不同但 mtime 相同 → 内容被改写（如 touch 保留 mtime），强制编译
              needsCompile = true;
              logger.info('内容指纹变化触发重编译（mtime 未变）', {
                file: rawFile,
              });
            } else {
              // 旧快照无 digest（迁移期）→ 维持原跳过行为，新编译后自动补指纹
              result.skipped++;
              newState.docs[rawFile] = prevState;
              updateCompileProgress(result.compiled + result.skipped);
              continue;
            }
          } else {
            // mtime 变更了但 needsRecompile 返回 false（可能编译产物仍更新）
            // 保守策略：仍需检查，但不需要强制重编译
            needsCompile = false;
          }
        }

        if (!needsCompile) {
          // 记录当前 mtime 到新快照（即使跳过也要记录，避免下次重复判断）
          try {
            const rawStat = await stat(rawFile);
            const prevDoc = compileState?.docs[rawFile];
            newState.docs[rawFile] = {
              mtime: rawStat.mtimeMs,
              compiledAt: prevDoc?.compiledAt ?? Date.now(),
              ...(prevDoc?.digest ? { digest: prevDoc.digest } : {}),
            };
          } catch (_err) {
            // stat 失败忽略
          }
          result.skipped++;
          updateCompileProgress(result.compiled + result.skipped);
          continue;
        }

        const pages = await this.compileFile(rawFile, resolvedModel);
        result.compiled++;
        result.pagesCreated += pages.length;
        result.compiledFiles.push(...pages);
        // R4：实际产出页面的源 raw 记录（供原文分块页码索引刷新）
        if (pages.length > 0) result.compiledRaws.push(rawFile);

        // 编译成功，记录到快照（含内容指纹 K5.1）
        try {
          const rawStat = await stat(rawFile);
          newState.docs[rawFile] = {
            mtime: rawStat.mtimeMs,
            compiledAt: Date.now(),
            digest: await digestFor(rawFile),
          };
        } catch (_err) {
          // stat 失败忽略
        }

        // K5.2 血缘：doc(raw) → 本次编译页面（幂等；重编译先 purge 再写）
        if (this.lineage && pages.length > 0) {
          try {
            await this.lineage.purgeByDoc(rawFile);
            await this.lineage.addLinks(
              rawFile,
              pages.map((p) => ({
                artifactType: 'page' as const,
                artifactId: p,
              })),
              version
            );
          } catch (lineageErr) {
            // 血缘写入失败不影响编译主流程
            logger.warning('血缘写入失败', {
              file: rawFile,
              error: String(lineageErr),
            });
          }
        }

        updateCompileProgress(result.compiled + result.skipped);
        logger.info('文件编译完成', { file: rawFile, pages: pages.length });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`${rawFile}: ${errMsg}`);
        result.skipped++;
        updateCompileProgress(result.compiled + result.skipped, errMsg);
        logger.error('文件编译失败', { file: rawFile, error: errMsg });
      }
    }

    // 返回本轮编译版本（K5.3：runner/检索/审计标注用）
    result.version = version;

    // W9: 编译完成（KB-COMPILE-ASYNC：携带结果摘要，供前端进度轮询展示）
    finishCompileProgress({
      compiled: result.compiled,
      skipped: result.skipped,
      errors: result.errors.length,
    });

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
      // 发布知识变更事件，触发 KnowledgeRouter 倒排索引全量重建，
      // 使编译入库的新文档可被搜索立即命中（而非等待下次重启）
      globalEventBus.publish('knowledge:changed', {
        action: 'updated',
        filePath: this.knowledgeRoot,
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

    // LLM 图谱自动提取（编译后）
    // 触发条件：本次有新编译页面（增量提取新页面），或全部跳过但 knowledge
    // 域尚无图谱数据（从既有编译页面全量构建，避免图谱永远为空）
    if (this.graphExtractor && result.totalFound > 0) {
      const incremental = result.pagesCreated > 0;
      try {
        const hasKnowledgeEdges =
          await this.graphExtractor.hasDomainEdges('knowledge');
        if (incremental || !hasKnowledgeEdges) {
          const pagesToExtract = incremental
            ? (result.compiledFiles ?? [])
            : await this.collectExistingPages(rawFiles);
          if (pagesToExtract.length > 0) {
            if (this.graphExtractRunning) {
              logger.warn('图谱自动提取跳过：上一次提取仍在进行', {
                pages: pagesToExtract.length,
              });
              return result;
            }
            // 内存压力（L1+）下暂停非关键后台提取（OS kswapd 式：压力期让位主任务）
            if (isMemoryUnderPressure()) {
              logger.warn('图谱自动提取跳过：内存水位压力中（后台任务让位）', {
                pages: pagesToExtract.length,
              });
              return result;
            }
            this.graphExtractRunning = true;
            logger.info('开始图谱自动提取', {
              pages: pagesToExtract.length,
              mode: incremental ? 'incremental' : 'initial-build',
              maxPages: KnowledgeCompiler.GRAPH_EXTRACT_MAX_PAGES,
            });
            try {
              // 节流：上限页数（initial-build 全量重建防无限排空）
              const limited = pagesToExtract.slice(
                0,
                KnowledgeCompiler.GRAPH_EXTRACT_MAX_PAGES
              );
              if (limited.length < pagesToExtract.length) {
                logger.warn('图谱自动提取页数超上限，截断', {
                  total: pagesToExtract.length,
                  kept: limited.length,
                });
              }
              // 对页面进行图谱提取
              for (const compiledFile of limited) {
                try {
                  // 节流：超大页跳过（提取 prompt 仅用前 8000 字符，
                  // 全量读入巨页只会造成内存尖峰，与用户 agentic 任务竞争）
                  const { size } = await stat(compiledFile);
                  if (size > KnowledgeCompiler.GRAPH_EXTRACT_MAX_FILE_BYTES) {
                    logger.warn('图谱提取跳过超大页面', {
                      file: compiledFile,
                      bytes: size,
                    });
                    continue;
                  }
                  const content = await readFile(compiledFile, 'utf-8');
                  const extracted = await this.graphExtractor!.extract(
                    content,
                    'knowledge'
                  );
                  // R6：图谱 node 级血缘（doc=编译页；from/to 节点挂血缘）
                  if (
                    this.lineage &&
                    extracted &&
                    (extracted.edges?.length ?? 0) > 0
                  ) {
                    try {
                      const nodeIds = [
                        ...new Set(
                          extracted.edges.flatMap((e) => [e.from, e.to])
                        ),
                      ];
                      await this.lineage.purgeByDoc(compiledFile);
                      await this.lineage.addLinks(
                        compiledFile,
                        nodeIds.map((id) => ({
                          artifactType: 'node',
                          artifactId: id,
                        })),
                        this.compileVersion
                      );
                    } catch (lineageErr) {
                      logger.warning('node 血缘写入失败', {
                        file: compiledFile,
                        error: String(lineageErr),
                      });
                    }
                  }
                } catch {
                  // 单个文件提取失败不阻塞
                }
              }
            } finally {
              this.graphExtractRunning = false;
            }
          }
        }
      } catch (err) {
        void handleError(err, {
          module: 'knowledge:compiler',
          action: 'graph_extract',
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
   * 收集既有编译产物页面（全量图谱构建用）
   * 通过 raw 文件的 companion .meta.json 获取其生成的页面列表
   */
  private async collectExistingPages(rawFiles: string[]): Promise<string[]> {
    const pages: string[] = [];
    for (const rawFile of rawFiles) {
      const metaFile = `${rawFile}.meta.json`;
      if (!existsSync(metaFile)) continue;
      try {
        const meta = JSON.parse(await readFile(metaFile, 'utf-8'));
        if (Array.isArray(meta.pages)) {
          for (const page of meta.pages) {
            if (typeof page === 'string' && !pages.includes(page)) {
              pages.push(page);
            }
          }
        }
      } catch {
        // 忽略损坏的 meta 文件
      }
    }
    return pages;
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
    } catch (_err) {
      return true;
    }
  }

  /**
   * 获取主摘要页的目标路径（many-to-many 中的"主入口页"）
   */
  private getWikiTargetPath(rawFile: string): string {
    const baseName = rawFile.replace(
      /\.(txt|json|csv|tsv|xml|yaml|yml|pdf|docx|xlsx|xls)$/,
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
    // K1（知识库优化）：文档类（PDF/DOCX/XLSX）经 extractor 抽取文本层后进入 LLM
    // 编译管线；文本类仍 utf-8 直读（extractDocument 对两者统一处理，保持原行为）。
    const extracted = await extractDocument(rawFile);
    if (!extracted) {
      logger.warn('跳过无法抽取的文件', { file: rawFile });
      return [];
    }
    const rawContent = extracted.text;
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
    } catch (_err) {
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
    } catch (_err) {
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

    const startTime = performance.now();
    let rawOutput = '';
    // P0 长文截断修复（2026-09-07，源自 K1 e2e 验收）：原 generate 未传 max_tokens，
    // transport 缺省 4096 静默截断多页产物（曾以 4095 tokens 只写出 frontmatter 空页）。
    // 预算取自 DB 模型 max_output_tokens（数出同源）。
    // 重试触发条件有两类：
    //   1) finish_reason === 'max_tokens' —— 显式触顶截断；
    //   2) content 为空 —— 推理模型（thinking）的 completion_tokens 含推理开销，
    //      8192 预算可被推理耗尽返回空正文（实测 deepseek-v4-flash 4095/4095 空输出，
    //      翻倍到 16384 后同模型可产出 6445 token 正文），此时 finish_reason 不报
    //      max_tokens，需按"输出异常为空"加倍重试。
    // 重试耗尽仍异常 → 抛错跳过，绝不落盘残缺页。
    let retryState = createMaxOutputRetryState(
      await this.resolveCompileMaxTokens(model)
    );
    let truncated = false;
    try {
      for (;;) {
        const response = await this.aiService.generate(messages, model, {
          max_tokens: retryState.currentMaxTokens,
        });
        rawOutput = response.content.trim();

        // 记录 LLM 调用性能（每次真实调用均记录）
        const latency = performance.now() - startTime;
        const tokens = response.usage ?? {
          prompt_tokens: 0,
          completion_tokens: 0,
        };
        LLMPerformanceMonitor.getInstance().recordRequest({
          model: model ?? 'knowledge-compiler',
          inputTokens: tokens.prompt_tokens ?? 0,
          outputTokens: tokens.completion_tokens ?? 0,
          latency,
          success: true,
          cost: 0, // CostMonitor 通过 recordCost 单独计算
        });

        // 正文为空：推理模型可能把输出预算全耗在 thinking 上，等同截断，需重试
        const emptyOutput = rawOutput.length === 0;
        if (response.finish_reason !== 'max_tokens' && !emptyOutput) break;

        const next = advanceMaxOutputRetry('max_tokens', retryState);
        if (!next.shouldRetry) {
          truncated = true;
          logger.warn('知识编译输出异常，重试耗尽仍无法获得正文', {
            file: targetPath,
            emptyOutput,
            finishReason: response.finish_reason ?? 'unknown',
            outputTokens: tokens.completion_tokens ?? 0,
            maxTokens: retryState.currentMaxTokens,
          });
          break;
        }
        logger.warn(
          emptyOutput
            ? '知识编译输出为空（疑似推理模型预算被 thinking 耗尽），翻倍后重试'
            : '知识编译输出被 max_tokens 截断，加倍后重试',
          {
            file: targetPath,
            outputTokens: tokens.completion_tokens ?? 0,
            nextMaxTokens: next.currentMaxTokens,
            retryCount: next.retryCount,
          }
        );
        retryState = next;
      }
    } catch (err) {
      LLMPerformanceMonitor.getInstance().recordRequest({
        model: model ?? 'knowledge-compiler',
        inputTokens: 0,
        outputTokens: 0,
        latency: performance.now() - startTime,
        success: false,
        error: (err as Error).message,
        cost: 0,
      });
      throw err;
    }

    if (truncated) {
      // 失败即报错：不写残缺页（曾把 frontmatter 空页当成功产物落盘）；
      // needsRecompile 仍为 true，下次调度自动重试，避免"部分编译"假象长期固化。
      throw new Error(
        `知识编译输出异常（已自动加倍重试 ${retryState.retryCount} 次，仍无法获得完整正文）。` +
          '若目标模型为推理型（thinking 计入输出 token），可在「模型管理 → 该模型」' +
          '调大最大输出 tokens，或为 knowledge_compile 任务改配非推理模型后重试。'
      );
    }

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
   * 编译输出 token 预算（P0 长文截断修复）
   * 模型输出上限是模型属性 → 以 DB model_registry.max_output_tokens 为唯一事实源
   * （model-usage 规则：禁止按模型名硬编码属性表）；单实例内缓存避免逐文件查 DB。
   */
  private async resolveCompileMaxTokens(model?: string): Promise<number> {
    const cacheKey = model || '';
    const cached = this.maxTokensCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let budget = COMPILE_DEFAULT_MAX_TOKENS;
    if (model) {
      try {
        const { modelPricingService } =
          await import('@modules/ai/models/ModelPricingService.js');
        await modelPricingService.initialize();
        const record = await modelPricingService.getPricing(model);
        if (typeof record?.maxOutputTokens === 'number') {
          budget = record.maxOutputTokens;
        }
      } catch (err) {
        logger.warn('读取模型 maxOutputTokens 失败，使用编译默认预算', {
          model,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    budget = Math.min(budget, COMPILE_MAX_TOKENS_LIMIT);
    this.maxTokensCache.set(cacheKey, budget);
    return budget;
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
   * 清理已删除 raw 文件的编译产物
   * 对比当前 raw 文件集合与编译状态快照，删除孤儿 .meta.json 和对应的编译页面
   */
  private async cleanupDeletedRawFiles(
    currentRawFiles: Set<string>,
    compileState: CompileState | null
  ): Promise<number> {
    if (!compileState || Object.keys(compileState.docs).length === 0) return 0;

    const { unlink } = await import('fs/promises');
    const { existsSync } = await import('fs');
    let cleaned = 0;

    for (const [rawFilePath] of Object.entries(compileState.docs)) {
      // raw 文件已不存在 → 清理编译产物
      if (currentRawFiles.has(rawFilePath)) continue;
      if (!existsSync(rawFilePath)) {
        // 删除 .meta.json
        const metaFile = `${rawFilePath}.meta.json`;
        try {
          if (existsSync(metaFile)) {
            const metaContent = await readFile(metaFile, 'utf-8');
            const meta = JSON.parse(metaContent);
            const pages: string[] = meta.pages || [];
            // 删除所有编译页面
            for (const pagePath of pages) {
              if (existsSync(pagePath)) {
                await unlink(pagePath);
              }
            }
            await unlink(metaFile);
            cleaned += pages.length + 1; // pages + meta file
            logger.info('已清理删除文件的编译产物', {
              rawFile: rawFilePath,
              pagesRemoved: pages.length,
            });
          }
        } catch (_err) {
          // 清理失败不阻塞编译
        }
      }
    }
    return cleaned;
  }

  /**
   * 加载编译状态快照
   */
  private async loadCompileState(): Promise<CompileState | null> {
    try {
      if (!existsSync(COMPILE_STATE_PATH)) return null;
      const raw = await readFile(COMPILE_STATE_PATH, 'utf-8');
      return JSON.parse(raw) as CompileState;
    } catch (_err) {
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
 *
 * K2（本体驱动）装配：
 * - 图谱 schema 为 opt-in：仅当用户显式放置 .schema/entities.yaml 或 edges.yaml
 *   时加载白名单约束（GraphExtractor schema-aware），否则保持自由提取（防回归）。
 * - 字段级记录：编译产出页面后，若 .schema/records.yaml 存在则按 schema 抽取
 *   结构化记录落 knowledge_records 表（RecordStore upsert）。
 */
export async function runKnowledgeCompile(
  aiService: AIService,
  options?: CompileOptions
): Promise<CompileResult> {
  const graph = new KnowledgeGraph();
  await graph.init();

  const schemaLoader = new SchemaLoader();
  const schemaDir = schemaLoader.getSchemaDir();
  const hasGraphSchema =
    existsSync(join(schemaDir, 'entities.yaml')) ||
    existsSync(join(schemaDir, 'edges.yaml'));
  const graphSchemas = hasGraphSchema
    ? await schemaLoader.loadAll()
    : undefined;

  // K5 血缘：编译页与 record/rule 产物共用一条 LineageStore
  const lineage = new LineageStore();
  await lineage.init();

  const graphExtractor = new GraphExtractor(aiService, graph, graphSchemas);
  const compiler = new KnowledgeCompiler(aiService, graphExtractor, {
    lineage,
  });
  const result = await compiler.compile(options);
  const compiledPages = result.compiledFiles ?? [];
  const compileVersion = result.version ?? 1;

  try {
    // K2 字段级记录：仅本次有新编译页面且声明了 records.yaml 时执行
    if (result.pagesCreated > 0) {
      try {
        const recordSchemas = await schemaLoader.loadRecords();
        if (recordSchemas.size > 0 && compiledPages.length > 0) {
          const store = new RecordStore();
          try {
            await extractRecordsFromCompiledPages(
              aiService,
              recordSchemas,
              compiledPages,
              store
            );
            // K5.2 血缘：page → 各 record 行（doc 取编译页，其再经 page 血缘指向源 raw）
            for (const page of compiledPages) {
              const rows = await store.listBySourceFile(page);
              if (rows.length === 0) continue;
              await lineage.addLinks(
                page,
                rows.map((r) => ({ artifactType: 'record', artifactId: r.id })),
                compileVersion
              );
            }
          } finally {
            await store.close();
          }
        }
      } catch (err) {
        await handleError(err, {
          module: 'knowledge:compiler',
          action: 'record_extract',
        });
      }
    }

    // K3 规则类知识抽取：仅本次有新编译页面且声明了 rules.yaml 时执行
    if (result.pagesCreated > 0) {
      try {
        const ruleSchemas = await schemaLoader.loadRules();
        if (ruleSchemas.size > 0 && compiledPages.length > 0) {
          const ruleStore = new RuleStore();
          try {
            await extractRulesFromCompiledPages(
              aiService,
              ruleSchemas,
              compiledPages,
              ruleStore
            );
            // K5.2 血缘：page → 各 rule 行
            for (const page of compiledPages) {
              const rows = await ruleStore.listBySourceFile(page);
              if (rows.length === 0) continue;
              await lineage.addLinks(
                page,
                rows.map((r) => ({ artifactType: 'rule', artifactId: r.id })),
                compileVersion
              );
            }
            // R3：跨批全表 conflictOf 扫描（对全部已落库规则做配对 lint，warning 不阻断）
            try {
              const allRules = await ruleStore.listAll();
              const crossWarnings = detectRuleConflicts(
                allRules.map((r) => ({
                  id: r.id,
                  statement: r.statement,
                  conflictOf: r.conflictOf,
                }))
              );
              if (crossWarnings.length > 0) {
                logger.warning('规则跨批冲突校验发现警告', {
                  total: allRules.length,
                  warnings: crossWarnings.slice(0, 20),
                });
              } else {
                logger.info('规则跨批冲突校验通过', { total: allRules.length });
              }
            } catch (scanErr) {
              logger.warning('规则跨批冲突扫描失败', {
                error: String(scanErr),
              });
            }
          } finally {
            await ruleStore.close();
          }
        }
      } catch (err) {
        await handleError(err, {
          module: 'knowledge:compiler',
          action: 'rule_extract',
        });
      }
    }

    // R4 原文分块页码索引：对本次实际产出页面的文档类 raw（PDF/XLSX 等）
    // 刷新原文块（locators → page/section/tableId），供检索命中返回 doc.pdf#p.N 引用。
    // 仅处理会产生 locators 的扩展名（DOCX 无定位，跳过避免空跑解析）。
    if ((result.compiledRaws?.length ?? 0) > 0) {
      try {
        const { refreshSourceChunksForRaw } =
          await import('./source/SourceChunkStore');
        const locatorExts = new Set(['.pdf', '.xlsx', '.xls']);
        const raws = [...new Set(result.compiledRaws)];
        let docsWithChunks = 0;
        for (const raw of raws) {
          const dot = raw.lastIndexOf('.');
          const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : '';
          if (!locatorExts.has(ext)) continue;
          const n = await refreshSourceChunksForRaw(raw);
          if (n > 0) docsWithChunks++;
        }
        logger.info('R4 原文分块刷新完成', {
          compiledRaws: raws.length,
          docsWithChunks,
        });
      } catch (err) {
        await handleError(err, {
          module: 'knowledge:compiler',
          action: 'source_chunk_refresh',
        });
      }
    }
  } finally {
    await lineage.close();
  }

  return result;
}
