// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识库运行时配置 — KnowledgeConfig
 *
 * 支持三层优先级覆盖：
 *   1. 环境变量（最高）如 KNOWLEDGE_KEYWORD_WEIGHT=0.3
 *   2. JSON 配置文件 ~/.pyapp/config/knowledge.json
 *   3. 代码默认值（最低）
 */

import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolvePyappHome } from '@modules/core';

const logger = new Logger({
  module: 'knowledge:config',
  level: LogLevel.INFO,
});

export interface KnowledgeSearchConfig {
  keywordWeight: number;
  semanticWeight: number;
  semanticThreshold: number;
  knowledgeDocBoost: number;
}

export interface KnowledgeLinterConfig {
  staleDays: number;
  maxIssues: number;
}

export interface KnowledgeSchedulerConfig {
  intervalMs: number;
  runOnStart: boolean;
}

export interface KnowledgeCompilerConfig {
  maxPagesPerFile: number;
  minPagesPerFile: number;
  qualityLintThreshold: number;
}

export interface VectorStoreConfig {
  /** 向量存储类型：jsonl | sqlite_vec */
  type: 'jsonl' | 'sqlite_vec';
  /** 语义搜索返回条数 */
  topK: number;
  /** 相似度最低阈值 */
  minScore: number;
}

export interface KnowledgeConfigData {
  version: 1;
  search: KnowledgeSearchConfig;
  linter: KnowledgeLinterConfig;
  scheduler: KnowledgeSchedulerConfig;
  compiler: KnowledgeCompilerConfig;
  vectorStore?: VectorStoreConfig;
}

const DEFAULTS: KnowledgeConfigData = {
  version: 1,
  search: {
    keywordWeight: 0.4,
    semanticWeight: 0.6,
    semanticThreshold: 0.3,
    knowledgeDocBoost: 0.5,
  },
  linter: {
    staleDays: 90,
    maxIssues: 100,
  },
  scheduler: {
    intervalMs: 300_000,
    runOnStart: false,
  },
  compiler: {
    maxPagesPerFile: 8,
    minPagesPerFile: 2,
    qualityLintThreshold: 3,
  },
};

const CONFIG_PATH = join(resolvePyappHome(), 'config', 'knowledge.json');

function envNumber(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return val === '1' || val.toLowerCase() === 'true';
}

export class KnowledgeConfig {
  private data: KnowledgeConfigData;

  constructor(data?: Partial<KnowledgeConfigData>) {
    this.data = {
      ...DEFAULTS,
      ...data,
      search: { ...DEFAULTS.search, ...data?.search },
      linter: { ...DEFAULTS.linter, ...data?.linter },
      scheduler: { ...DEFAULTS.scheduler, ...data?.scheduler },
      compiler: { ...DEFAULTS.compiler, ...data?.compiler },
    };
    this.applyEnvOverrides();
  }

  static async load(): Promise<KnowledgeConfig> {
    let fileConfig: Partial<KnowledgeConfigData> | undefined;
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = await readFile(CONFIG_PATH, 'utf-8');
        fileConfig = JSON.parse(raw);
        logger.info('已加载知识库配置文件', { path: CONFIG_PATH });
      }
    } catch (err) {
      logger.debug('知识库配置文件加载失败，使用默认值', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return new KnowledgeConfig(fileConfig);
  }

  private applyEnvOverrides(): void {
    this.data.search.keywordWeight = envNumber(
      'KNOWLEDGE_KEYWORD_WEIGHT',
      this.data.search.keywordWeight
    );
    this.data.search.semanticWeight = envNumber(
      'KNOWLEDGE_SEMANTIC_WEIGHT',
      this.data.search.semanticWeight
    );
    this.data.search.semanticThreshold = envNumber(
      'KNOWLEDGE_SEMANTIC_THRESHOLD',
      this.data.search.semanticThreshold
    );
    this.data.linter.staleDays = envNumber(
      'KNOWLEDGE_STALE_DAYS',
      this.data.linter.staleDays
    );
    this.data.scheduler.intervalMs = envNumber(
      'KNOWLEDGE_SCHEDULER_INTERVAL',
      this.data.scheduler.intervalMs
    );
    this.data.scheduler.runOnStart = envBool(
      'KNOWLEDGE_SCHEDULER_RUN_ON_START',
      this.data.scheduler.runOnStart
    );
  }

  get search(): KnowledgeSearchConfig {
    return { ...this.data.search };
  }

  get linter(): KnowledgeLinterConfig {
    return { ...this.data.linter };
  }

  get scheduler(): KnowledgeSchedulerConfig {
    return { ...this.data.scheduler };
  }

  get compiler(): KnowledgeCompilerConfig {
    return { ...this.data.compiler };
  }

  get vectorStore(): VectorStoreConfig | undefined {
    return this.data.vectorStore ? { ...this.data.vectorStore } : undefined;
  }

  /** 获取配置摘要（用于 CLI 回显） */
  summarize(): string {
    const s = this.data.search;
    const l = this.data.linter;
    const sc = this.data.scheduler;
    const c = this.data.compiler;
    return [
      `search.keywordWeight: ${s.keywordWeight}${envNumber('KNOWLEDGE_KEYWORD_WEIGHT', NaN) === s.keywordWeight ? ' (env)' : ''}`,
      `search.semanticWeight: ${s.semanticWeight}${envNumber('KNOWLEDGE_SEMANTIC_WEIGHT', NaN) === s.semanticWeight ? ' (env)' : ''}`,
      `search.semanticThreshold: ${s.semanticThreshold}`,
      `linter.staleDays: ${l.staleDays}${envNumber('KNOWLEDGE_STALE_DAYS', NaN) === l.staleDays ? ' (env)' : ''}`,
      `scheduler.intervalMs: ${sc.intervalMs}`,
      `compiler.maxPagesPerFile: ${c.maxPagesPerFile}`,
    ].join('\n');
  }

  /** 获取原始配置数据 */
  toJSON(): KnowledgeConfigData {
    return { ...this.data };
  }

  /** 更新配置并持久化 */
  update(partial: Partial<KnowledgeConfigData>): KnowledgeConfigData {
    if (partial.search) {
      this.data.search = { ...this.data.search, ...partial.search };
    }
    if (partial.linter) {
      this.data.linter = { ...this.data.linter, ...partial.linter };
    }
    if (partial.scheduler) {
      this.data.scheduler = { ...this.data.scheduler, ...partial.scheduler };
    }
    if (partial.compiler) {
      this.data.compiler = { ...this.data.compiler, ...partial.compiler };
    }
    if (partial.vectorStore !== undefined) {
      this.data.vectorStore = partial.vectorStore
        ? { ...partial.vectorStore }
        : undefined;
    }
    return this.data;
  }

  /** 持久化配置到磁盘 */
  async save(): Promise<void> {
    const { mkdir, writeFile } = await import('fs/promises');
    const { dirname } = await import('path');
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
    logger.info('知识库配置已保存', { path: CONFIG_PATH });
  }
}
