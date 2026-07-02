/**
 * 域管理器 — DomainManager
 *
 * 管理 ~/.pyapp/knowledge/domains/ 下的多域知识库。
 * 每个域是独立的知识子空间，拥有独立的 schema、wiki 页面、index.md。
 *
 * Domain-First 架构的核心编排入口。
 */
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { load, dump } from 'js-yaml';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  resolveDomainsRoot,
  resolveDomainDir,
  resolveDomainSchemaDir,
} from '@modules/core';

const logger = new Logger({
  module: 'knowledge:domain:domainManager',
  level: LogLevel.INFO,
});

/** 域描述信息 */
export interface DomainInfo {
  name: string;
  label: string;
  description: string;
  queryHints: DomainQueryHints;
  allowedCrossDomainRefs: string[];
  createdAt: number;
}

/** 域查询提示（用于 LLM 判断目标域） */
export interface DomainQueryHints {
  keywords: string[];
  languages?: string[];
}

/** 域编译规则（用于控制 LLM 输出详细程度等） */
export interface CompileRules {
  /** 输出详细程度：low（简要）/ medium（标准）/ high（详尽） */
  detailLevel?: 'low' | 'medium' | 'high';
  /** 索引更新频率：realtime / daily / weekly */
  indexFrequency?: 'realtime' | 'daily' | 'weekly';
  /** 命名约定（如：植物学用拉丁学名） */
  namingConvention?: string;
  /** 其他自定义规则 */
  customRules?: string[];
}

/** 域配置文件定义 */
export interface DomainConfig {
  name: string;
  label: string;
  description: string;
  queryHints: DomainQueryHints;
  allowedCrossDomainRefs: string[];
  compileRules?: CompileRules;
  createdAt: number;
}

/** 域概要信息（不含详情） */
export interface DomainSummary {
  name: string;
  label: string;
  description: string;
  keywordTags: string[];
  wikiPageCount: number;
}

const DEFAULT_DOMAIN_CONFIG: DomainConfig = {
  name: 'default',
  label: '默认域',
  description: '默认知识域，存放未分类的通用知识条目',
  queryHints: { keywords: [] },
  allowedCrossDomainRefs: [],
  createdAt: Date.now(),
};

const DOMAIN_CONFIG_FILENAME = '.domain.yaml';

/**
 * 域管理器
 *
 * 职责：
 * - 列出/创建/删除域
 * - 根据用户查询自动匹配目标域（detectDomain）
 * - 提供域注册表（汇总信息）
 */
export class DomainManager {
  private domainsRoot: string;

  constructor(domainsRoot?: string) {
    this.domainsRoot = domainsRoot || resolveDomainsRoot();
  }

  /**
   * 获取域根目录
   */
  getDomainsRoot(): string {
    return this.domainsRoot;
  }

  /**
   * 确保域根目录存在
   */
  async ensureRoot(): Promise<void> {
    if (!existsSync(this.domainsRoot)) {
      await mkdir(this.domainsRoot, { recursive: true });
    }
  }

  /**
   * 列出所有已注册域
   */
  async list(): Promise<DomainSummary[]> {
    await this.ensureRoot();

    const entries = await readdir(this.domainsRoot, { withFileTypes: true });
    const result: DomainSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const config = await this.getConfig(entry.name);
      if (!config) continue;

      const wikiCount = await this.countWikiPages(entry.name);

      result.push({
        name: config.name,
        label: config.label,
        description: config.description,
        keywordTags: config.queryHints.keywords,
        wikiPageCount: wikiCount,
      });
    }

    return result;
  }

  /**
   * 创建新域
   */
  async create(
    name: string,
    overrides?: Partial<Omit<DomainConfig, 'name' | 'createdAt'>>
  ): Promise<DomainConfig> {
    const domainDir = resolveDomainDir(name);
    if (existsSync(domainDir)) {
      throw new Error(`域 "${name}" 已存在`);
    }

    // 创建目录结构
    await mkdir(join(domainDir, 'wiki'), { recursive: true });
    await mkdir(resolveDomainSchemaDir(name), { recursive: true });

    // 写入 .domain.yaml
    const config: DomainConfig = {
      name,
      label: overrides?.label || name,
      description: overrides?.description || '',
      queryHints: overrides?.queryHints || { keywords: [] },
      allowedCrossDomainRefs: overrides?.allowedCrossDomainRefs || [],
      createdAt: Date.now(),
    };

    await this.writeConfig(name, config);

    logger.info('域已创建', { name, path: domainDir });

    return config;
  }

  /**
   * 获取域配置
   */
  async getConfig(name: string): Promise<DomainConfig | null> {
    const configPath = join(resolveDomainDir(name), DOMAIN_CONFIG_FILENAME);

    if (!existsSync(configPath)) {
      // 对 default 域，不存在则返回默认配置
      if (name === 'default') {
        return { ...DEFAULT_DOMAIN_CONFIG };
      }
      return null;
    }

    try {
      const raw = await readFile(configPath, 'utf-8');
      return this.parseYaml(raw);
    } catch (error) {
      logger.warning('读取域配置失败', { name, error });
      return null;
    }
  }

  /**
   * 检测用户查询最可能匹配哪个域
   * 用 queryHints.keywords 做简单关键词匹配
   */
  async detectDomain(query: string): Promise<string> {
    const domains = await this.list();
    if (domains.length === 0) return 'default';

    const queryLower = query.toLowerCase();
    let bestMatch = 'default';
    let bestScore = 0;

    for (const domain of domains) {
      let score = 0;
      for (const kw of domain.keywordTags) {
        if (queryLower.includes(kw.toLowerCase())) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = domain.name;
      }
    }

    return bestMatch;
  }

  /**
   * 获取所有域汇总信息（用于 system prompt 注入）
   */
  async getDomainSummaryText(): Promise<string> {
    const domains = await this.list();
    if (domains.length === 0) return '';

    const lines: string[] = ['可用知识域：'];

    for (const d of domains) {
      const tags =
        d.keywordTags.length > 0
          ? ` [关键词: ${d.keywordTags.join(', ')}]`
          : '';
      lines.push(`- ${d.label}（${d.description}）${tags}`);
    }

    return lines.join('\n');
  }

  /**
   * 获取域内 wiki 页面数量
   */
  private async countWikiPages(name: string): Promise<number> {
    const wikiDir = join(resolveDomainDir(name), 'wiki');
    if (!existsSync(wikiDir)) return 0;

    try {
      const files = await readdir(wikiDir);
      return files.filter((f) => f.endsWith('.md')).length;
    } catch {
      return 0;
    }
  }

  /**
   * 写入域配置
   */
  private async writeConfig(name: string, config: DomainConfig): Promise<void> {
    const configPath = join(resolveDomainDir(name), DOMAIN_CONFIG_FILENAME);
    const yaml = dump(config, { lineWidth: -1, noRefs: true });
    await writeFile(configPath, yaml, 'utf-8');
  }

  /**
   * 解析 YAML 配置（使用 js-yaml，与 SchemaLoader 保持一致）
   */
  private parseYaml(raw: string): DomainConfig {
    const parsed = load(raw) as Record<string, unknown>;
    const hints = (parsed.queryHints || {}) as Record<string, unknown>;
    return {
      name: String(parsed.name || ''),
      label: String(parsed.label || ''),
      description: String(parsed.description || ''),
      queryHints: {
        keywords: Array.isArray(hints.keywords)
          ? (hints.keywords as string[])
          : [],
        languages: Array.isArray(hints.languages)
          ? (hints.languages as string[])
          : undefined,
      },
      allowedCrossDomainRefs: Array.isArray(parsed.allowedCrossDomainRefs)
        ? (parsed.allowedCrossDomainRefs as string[])
        : [],
      compileRules: parsed.compileRules as CompileRules | undefined,
      createdAt: Number(parsed.createdAt) || 0,
    };
  }
}
