/**
 * .liri/ 配置管理器
 *
 * 负责读取/写入工作空间根目录下的 .liri/ 目录中的配置文件。
 * 提供工作空间自动检测、配置加载/保存、记忆管理等功能。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import type {
  LiriWorkspaceConfig,
  LiriKnowledgeConfig,
  LiriToolConfig,
  LiriMemoryConfig,
  LiriMemoryEntry,
  LiriDetectionResult,
  LiriCostControl,
  LiriAIStrategy,
  LiriModelPreference,
} from './types';

/** .liri/ 目录常量 */
const LIRI_DIR = '.liri';
const CONFIG_FILE = 'config.json';
const RULES_FILE = 'rules.md';
const KNOWLEDGE_FILE = 'knowledge.json';
const TOOLS_FILE = 'tools.json';
const MEMORY_FILE = 'memory.json';

/** 默认 .liri/ 子目录 */
const DEFAULT_SUBDIRS = ['workflows', 'agents', 'projects', 'teams', 'memory'];

/**
 * .liri/ 配置管理器
 *
 * 使用示例：
 * ```typescript
 * const manager = new LiriConfigManager("/path/to/project");
 * const config = await manager.loadConfig();
 * ```
 */
export class LiriConfigManager {
  /** 工作空间根目录路径 */
  private workspaceRoot: string;

  /** .liri/ 目录路径 */
  private liriDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.liriDir = join(workspaceRoot, '.liri');
  }

  /** .liri/ 目录路径 */
  get dir(): string {
    return this.liriDir;
  }

  // ========== 目录检测 ==========

  /**
   * 检测 .liri/ 目录是否存在
   */
  exists(): boolean {
    return existsSync(this.liriDir);
  }

  /**
   * 检测 .liri/ 目录状态，返回详细信息
   */
  detect(): LiriDetectionResult {
    const found = this.exists();

    if (!found) {
      return { found: false };
    }

    const subdirs = DEFAULT_SUBDIRS.filter((dir) =>
      existsSync(join(this.liriDir, dir))
    );

    const configFiles = [
      CONFIG_FILE,
      RULES_FILE,
      KNOWLEDGE_FILE,
      TOOLS_FILE,
      MEMORY_FILE,
    ].filter((file) => existsSync(join(this.liriDir, file)));

    return {
      found: true,
      path: this.liriDir,
      subdirs,
      configFiles,
    };
  }

  /**
   * 初始化 .liri/ 目录结构
   * 创建默认目录和空配置文件
   */
  init(): void {
    // 创建 .liri/ 目录
    if (!existsSync(this.liriDir)) {
      mkdirSync(this.liriDir, { recursive: true });
    }

    // 创建默认子目录
    for (const subdir of DEFAULT_SUBDIRS) {
      const subdirPath = join(this.liriDir, subdir);
      if (!existsSync(subdirPath)) {
        mkdirSync(subdirPath, { recursive: true });
      }
    }

    // 创建默认配置文件（如果不存在）
    this.initConfigIfNotExists();
  }

  /**
   * 初始化默认配置文件
   */
  private initConfigIfNotExists(): void {
    const configPath = join(this.liriDir, CONFIG_FILE);
    if (!existsSync(configPath)) {
      const defaultConfig: LiriWorkspaceConfig = {
        name: '',
        description: '',
        models: {
          defaultModel: '',
          planModel: '',
          doModel: '',
          analysisModel: '',
        },
        aiStrategy: {
          autoAccept: false,
          reviewStrictness: 'normal',
          autoBackup: true,
          maxParallelWorkItems: 3,
        },
        costControl: {
          dailyBudgetTokens: 500000,
          monthlyBudgetUSD: 20,
          alertThreshold: 0.8,
          hardLimit: false,
          expensiveModelOnlyFor: ['council', 'pdca'],
        },
      };
      this.writeJsonFile(configPath, defaultConfig);
    }

    const rulesPath = join(this.liriDir, RULES_FILE);
    if (!existsSync(rulesPath)) {
      writeFileSync(
        rulesPath,
        '# 工作空间规则\n\n<!-- 在此添加项目规则，AI 在执行时会遵守这些规则 -->\n',
        'utf-8'
      );
    }

    const knowledgePath = join(this.liriDir, KNOWLEDGE_FILE);
    if (!existsSync(knowledgePath)) {
      const defaultKnowledge: LiriKnowledgeConfig = {
        knowledgeBaseIds: [],
        autoIndex: true,
        indexExcludePatterns: [
          'node_modules/**',
          '.git/**',
          'dist/**',
          '.liri/**',
        ],
      };
      this.writeJsonFile(knowledgePath, defaultKnowledge);
    }

    const toolsPath = join(this.liriDir, TOOLS_FILE);
    if (!existsSync(toolsPath)) {
      const defaultTools: LiriToolConfig = {
        mcpServers: [],
        skills: [],
        disabledTools: [],
      };
      this.writeJsonFile(toolsPath, defaultTools);
    }

    const memoryPath = join(this.liriDir, MEMORY_FILE);
    if (!existsSync(memoryPath)) {
      const defaultMemory: LiriMemoryConfig = {
        entries: [],
        lastUpdated: new Date().toISOString(),
      };
      this.writeJsonFile(memoryPath, defaultMemory);
    }
  }

  // ========== config.json 读写 ==========

  /**
   * 加载工作空间配置
   */
  loadConfig(): LiriWorkspaceConfig {
    const configPath = join(this.liriDir, CONFIG_FILE);
    return this.readJsonFile<LiriWorkspaceConfig>(configPath) || {};
  }

  /**
   * 保存工作空间配置
   */
  saveConfig(config: LiriWorkspaceConfig): void {
    const configPath = join(this.liriDir, CONFIG_FILE);
    this.writeJsonFile(configPath, config);
  }

  /**
   * 更新配置的部分字段（深度合并）
   */
  updateConfig(partial: Partial<LiriWorkspaceConfig>): LiriWorkspaceConfig {
    const current = this.loadConfig();
    const merged = this.deepMerge(current, partial);
    this.saveConfig(merged);
    return merged;
  }

  // ========== rules.md 读写 ==========

  /**
   * 读取规则文件内容
   */
  loadRules(): string {
    const rulesPath = join(this.liriDir, RULES_FILE);
    if (!existsSync(rulesPath)) {
      return '';
    }
    return readFileSync(rulesPath, 'utf-8');
  }

  /**
   * 保存规则文件内容
   */
  saveRules(content: string): void {
    const rulesPath = join(this.liriDir, RULES_FILE);
    writeFileSync(rulesPath, content, 'utf-8');
  }

  /**
   * 追加规则内容
   */
  appendRules(content: string): void {
    const current = this.loadRules();
    this.saveRules(current + '\n' + content);
  }

  // ========== knowledge.json 读写 ==========

  /**
   * 加载知识库配置
   */
  loadKnowledge(): LiriKnowledgeConfig {
    const knowledgePath = join(this.liriDir, KNOWLEDGE_FILE);
    return (
      this.readJsonFile<LiriKnowledgeConfig>(knowledgePath) || {
        knowledgeBaseIds: [],
      }
    );
  }

  /**
   * 保存知识库配置
   */
  saveKnowledge(config: LiriKnowledgeConfig): void {
    const knowledgePath = join(this.liriDir, KNOWLEDGE_FILE);
    this.writeJsonFile(knowledgePath, config);
  }

  // ========== tools.json 读写 ==========

  /**
   * 加载工具配置
   */
  loadTools(): LiriToolConfig {
    const toolsPath = join(this.liriDir, TOOLS_FILE);
    return (
      this.readJsonFile<LiriToolConfig>(toolsPath) || {
        skills: [],
        mcpServers: [],
      }
    );
  }

  /**
   * 保存工具配置
   */
  saveTools(config: LiriToolConfig): void {
    const toolsPath = join(this.liriDir, TOOLS_FILE);
    this.writeJsonFile(toolsPath, config);
  }

  // ========== memory.json 读写 ==========

  /**
   * 加载工作空间记忆
   */
  loadMemory(): LiriMemoryConfig {
    const memoryPath = join(this.liriDir, MEMORY_FILE);
    return (
      this.readJsonFile<LiriMemoryConfig>(memoryPath) || {
        entries: [],
        lastUpdated: '',
      }
    );
  }

  /**
   * 保存工作空间记忆
   */
  saveMemory(config: LiriMemoryConfig): void {
    const memoryPath = join(this.liriDir, MEMORY_FILE);
    config.lastUpdated = new Date().toISOString();
    this.writeJsonFile(memoryPath, config);
  }

  /**
   * 添加记忆条目
   */
  addMemoryEntry(entry: LiriMemoryEntry): void {
    const memory = this.loadMemory();
    memory.entries.push(entry);
    this.saveMemory(memory);
  }

  /**
   * 获取所有配置文件的完整摘要
   */
  getSummary(): Record<string, unknown> {
    const detection = this.detect();

    return {
      exists: detection.found,
      liriDir: detection.path || null,
      subdirs: detection.subdirs || [],
      configFiles: detection.configFiles || [],
      config: this.loadConfig(),
      knowledge: this.loadKnowledge(),
      tools: this.loadTools(),
      memory: this.loadMemory(),
      rulesPreview: this.loadRules().substring(0, 500),
    };
  }

  // ========== 私有工具方法 ==========

  /**
   * 读取 JSON 文件
   */
  private readJsonFile<T>(filePath: string): T | null {
    try {
      if (!existsSync(filePath)) {
        return null;
      }
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * 写入 JSON 文件
   */
  private writeJsonFile(filePath: string, data: unknown): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 深度合并两个对象
   */
  private deepMerge<T>(target: T, source: Partial<T>): T {
    const result = { ...target } as Record<string, unknown>;

    for (const key of Object.keys(source as object) as (keyof T)[]) {
      const sourceVal = source[key];
      const targetVal = (result as Record<string, unknown>)[key as string];

      if (
        sourceVal !== null &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        targetVal !== null &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key as string] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>
        );
      } else if (sourceVal !== undefined) {
        result[key as string] = sourceVal;
      }
    }

    return result as T;
  }
}

/**
 * 为指定目录创建 LiriConfigManager 实例
 */
export function createLiriConfigManager(
  workspaceRoot: string
): LiriConfigManager {
  return new LiriConfigManager(workspaceRoot);
}

/**
 * 扫描指定目录，检测是否包含 .liri/ 目录
 * 支持向上查找（类似 git 的行为）
 */
export function detectLiriDir(startPath: string): LiriDetectionResult {
  let currentPath = startPath;

  // 向上查找最多 10 层
  for (let i = 0; i < 10; i++) {
    const liriPath = join(currentPath, LIRI_DIR);
    if (existsSync(liriPath)) {
      const manager = new LiriConfigManager(currentPath);
      return manager.detect();
    }

    const parentPath = dirname(currentPath);
    // 到达根目录，停止查找
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  return { found: false };
}
