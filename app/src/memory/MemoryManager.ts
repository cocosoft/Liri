import { resolveDataDir } from '@modules/config/paths';
import type { Memory, MemoryStats } from './types/Memory';
import { createMemory } from './types/Memory';
import {
  validateMemoryId,
  validateMemoryPath,
  MemoryStoreImpl,
  MemoryStore,
} from './stores/MemoryStore';
import { MemoryScannerImpl } from './scanners/MemoryScanner';
import { MemoryRetrieverImpl } from './retrievers/MemoryRetriever';
import { MemoryType } from './types/MemoryType';
import {
  MemoryPromptService,
  MemoryPrompt,
} from './services/MemoryPromptService';
import {
  AutoMemoryService,
  AutoMemoryConfig,
} from './services/AutoMemoryService';
import {
  TeamMemoryService,
  TeamMemoryConfig,
  TeamMemorySyncStatus,
  TeamMemorySyncRecord,
} from './services/TeamMemoryService';
import {
  PYAppIntegrationService,
  PYAppConfig,
  Rule,
  Preference,
} from './services/PYAppIntegrationService';
import fsExtra from 'fs-extra';
import { join } from 'path';
import * as fs from 'fs';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { MemoryProvider } from './MemoryProvider';
import { memoryRelationGraph } from './utils/MemoryRelationGraph';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 记忆管理器接口
 */
export interface MemoryManager {
  // 创建记忆
  createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  // 获取记忆
  getMemory(id: string): Promise<Memory | null>;

  // 更新记忆
  updateMemory(id: string, updates: Partial<Memory>): Promise<Memory>;

  // 删除记忆
  deleteMemory(id: string): Promise<void>;

  // 检索相关记忆
  getRelevantMemories(query: string, limit?: number): Promise<Memory[]>;

  // 获取所有记忆
  getAllMemories(): Promise<Memory[]>;

  // 获取记忆统计信息
  getMemoryStats(): Promise<MemoryStats>;

  // 自动创建记忆（从聊天）
  createMemoryFromChat(
    messages: any[],
    name?: string,
    type?: string
  ): Promise<Memory>;

  // 团队记忆管理
  getTeamMemories(teamId: string): Promise<Memory[]>;
  createTeamMemory(
    teamId: string,
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  // 记忆老化管理
  cleanupExpiredMemories(): Promise<number>;
  setMemoryExpiry(id: string, expiresAt: Date): Promise<Memory>;

  // 语义搜索
  searchMemoriesBySemantic(query: string, limit?: number): Promise<Memory[]>;
  searchMemoriesByTags(tags: string[], limit?: number): Promise<Memory[]>;

  // 记忆提示系统
  generateMemoryPrompts(context?: {
    userActions?: string[];
    recentMemories?: Memory[];
    currentTask?: string;
    query?: string;
  }): Promise<MemoryPrompt[]>;
  getMemoryUsageStats(): Promise<{
    totalMemories: number;
    memoryTypes: Record<MemoryType, number>;
    recentMemories: number;
    averageMemorySize: number;
  }>;

  // 自动记忆功能
  processConversation(
    conversationId: string,
    messages: Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>
  ): Promise<Memory[]>;
  setAutoMemoryConfig(config: Partial<AutoMemoryConfig>): void;
  getAutoMemoryConfig(): AutoMemoryConfig;
  clearConversationMemory(conversationId: string): void;
  clearAllConversationMemories(): void;

  // 团队记忆功能
  createTeamMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;
  getTeamMemories(): Promise<Memory[]>;
  updateTeamMemory(id: string, updates: Partial<Memory>): Promise<Memory>;
  deleteTeamMemory(id: string): Promise<void>;
  setTeamMemoryConfig(config: Partial<TeamMemoryConfig>): void;
  getTeamMemoryConfig(): TeamMemoryConfig;
  getTeamMemorySyncStatus(): TeamMemorySyncStatus;
  getTeamMemoryLastSyncTime(): Date | null;
  getTeamMemorySyncRecords(limit?: number): TeamMemorySyncRecord[];
  triggerTeamMemorySync(): Promise<TeamMemorySyncRecord>;

  // 外部提供者管理
  addProvider(provider: MemoryProvider): Promise<void>;
  getProvider(): MemoryProvider | null;
  removeProvider(): void;

  // Liri.md集成功能
  initializePYAppIntegration(): Promise<void>;
  getPYAppConfig(): PYAppConfig | null;
  getPYAppRules(): Rule[];
  getPYAppRulesByCategory(category: string): Rule[];
  getPYAppRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[];
  getPYAppPreferences(): Preference[];
  getPYAppPreference(key: string): Preference | undefined;
  getPYAppPreferenceValue(key: string, defaultValue?: any): any;
  getPYAppRulesText(): string;
  checkPYAppChanges(): Promise<boolean>;
  addPYAppChangeListener(listener: (config: PYAppConfig) => void): void;
  removePYAppChangeListener(listener: (config: PYAppConfig) => void): void;
}

/**
 * 记忆管理器实现
 */
export class MemoryManagerImpl {
  /**
   * 记忆存储
   */
  private store: MemoryStoreImpl;

  private storeDir: string;

  /**
   * 记忆扫描器
   */
  private scanner: MemoryScannerImpl;

  /**
   * 记忆检索器
   */
  private retriever: MemoryRetrieverImpl;

  /**
   * 记忆提示服务
   */
  private promptService: MemoryPromptService;

  /**
   * 自动记忆服务
   */
  private autoMemoryService: AutoMemoryService;

  /**
   * 团队记忆服务
   */
  private teamMemoryService: TeamMemoryService;

  /**
   * Liri.md集成服务
   */
  private pyAppIntegrationService: PYAppIntegrationService;

  /**
   * 关联图文件路径
   */
  private relationGraphPath: string;

  /**
   * 外部记忆提供者（最多 1 个）
   */
  private provider: MemoryProvider | null = null;

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   */
  constructor(memoryDir: string = join(resolveDataDir(), 'memory')) {
    this.storeDir = memoryDir;
    this.relationGraphPath = join(memoryDir, 'memory-relation-graph.json');
    this.store = new MemoryStoreImpl(memoryDir);
    this.scanner = new MemoryScannerImpl();
    this.retriever = new MemoryRetrieverImpl(memoryDir);
    this.promptService = new MemoryPromptService(this as any);
    this.autoMemoryService = new AutoMemoryService(this as any);
    this.teamMemoryService = new TeamMemoryService(this as any);
    this.pyAppIntegrationService = new PYAppIntegrationService();

    // 加载关联图
    this.loadRelationGraph().catch(() => {});
  }

  /**
   * 创建记忆
   * @param memory 记忆数据
   * @returns 创建的记忆
   */
  async createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory> {
    // 创建记忆对象
    const newMemory = createMemory(memory);

    // 保存到存储
    await this.store.saveMemory(newMemory);

    // 增量更新检索器索引
    this.retriever.updateIndex(newMemory);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    return newMemory;
  }

  /**
   * 获取记忆
   * @param id 记忆ID
   * @returns 记忆对象或null
   */
  async getMemory(id: string): Promise<Memory | null> {
    validateMemoryId(id);
    return this.store.readMemory(id);
  }

  /**
   * 更新记忆
   * @param id 记忆ID
   * @param updates 更新数据
   * @returns 更新后的记忆
   */
  async updateMemory(id: string, updates: Partial<Memory>): Promise<Memory> {
    validateMemoryId(id);

    // 获取现有记忆
    const existingMemory = await this.store.readMemory(id);
    if (!existingMemory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 合并更新
    const updatedMemory: Memory = {
      ...existingMemory,
      ...updates,
      metadata: {
        ...existingMemory.metadata,
        ...(updates.metadata || {}),
      },
      updatedAt: new Date(),
    };

    // 保存到存储
    await this.store.saveMemory(updatedMemory);

    // 增量更新检索器索引
    this.retriever.updateIndex(updatedMemory);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    return updatedMemory;
  }

  /**
   * 删除记忆
   * @param id 记忆ID
   */
  async deleteMemory(id: string): Promise<void> {
    validateMemoryId(id);
    await this.store.deleteMemory(id);

    // 从检索器索引中移除
    this.retriever.removeFromIndex(id);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();
  }

  /**
   * 检索相关记忆
   * 使用混合搜索（关键词+语义），优先利用 EmbeddingService 提升检索准确度，
   * 同时利用关联图扩展关联记忆（联想记忆）
   * @param query 查询字符串
   * @param limit 返回数量限制
   * @returns 相关记忆列表
   */
  async getRelevantMemories(
    query: string,
    limit: number = 5
  ): Promise<Memory[]> {
    const results = await this.retriever.hybridSearch(query, limit);

    // 通过关联图扩展关联记忆
    const resultIds = new Set(results.map((m) => m.id));
    const relatedIds = new Set<string>();

    for (const memory of results) {
      const relations = memoryRelationGraph.getDirectRelations(memory.id);
      for (const relation of relations) {
        if (
          !resultIds.has(relation.targetId) &&
          !relatedIds.has(relation.targetId)
        ) {
          relatedIds.add(relation.targetId);
        }
      }
    }

    if (relatedIds.size > 0) {
      const relatedMemories: Memory[] = [];
      for (const id of relatedIds) {
        const memory = await this.store.readMemory(id);
        if (memory) {
          relatedMemories.push(memory);
        }
      }

      // 将关联记忆附加到结果末尾
      const combined = [...results, ...relatedMemories];
      return combined.slice(0, limit);
    }

    return results;
  }

  /**
   * 获取所有记忆
   * @returns 记忆列表
   */
  async getAllMemories(): Promise<Memory[]> {
    // 获取所有记忆ID
    const memoryIds = await this.store.listMemories();

    // 读取每个记忆
    const memories: Memory[] = [];
    for (const id of memoryIds) {
      const memory = await this.store.readMemory(id);
      if (memory) {
        memories.push(memory);
      }
    }

    return memories;
  }

  /**
   * 获取记忆统计信息
   * @returns 记忆统计信息
   */
  async getMemoryStats(): Promise<MemoryStats> {
    const memories = await this.getAllMemories();

    // 按类型统计
    const byType: Record<MemoryType, number> = {
      [MemoryType.USER_FACT]: 0,
      [MemoryType.USER_PREFERENCE]: 0,
      [MemoryType.PROJECT_KNOWLEDGE]: 0,
      [MemoryType.CODE_PATTERN]: 0,
      [MemoryType.DECISION]: 0,
    };

    let totalSize = 0;
    const now = new Date();
    let recent = 0;

    for (const memory of memories) {
      // 按类型统计
      if (byType[memory.metadata.type as MemoryType] !== undefined) {
        byType[memory.metadata.type as MemoryType]++;
      }

      // 计算总大小
      totalSize += Buffer.byteLength(memory.content, 'utf8');

      // 统计最近创建的记忆（7天内）
      const daysSinceCreation =
        (now.getTime() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation <= 7) {
        recent++;
      }
    }

    return {
      total: memories.length,
      byType,
      recent,
      totalSize,
    };
  }

  /**
   * 注册外部记忆提供者
   * 最多允许 1 个外部提供者，重复注册会覆盖
   * @param provider 记忆提供者实例
   */
  async addProvider(provider: MemoryProvider): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
    }

    await provider.initialize();
    this.provider = provider;
  }

  /**
   * 获取当前外部记忆提供者
   * @returns 记忆提供者或 null
   */
  getProvider(): MemoryProvider | null {
    return this.provider;
  }

  /**
   * 移除当前外部记忆提供者
   */
  removeProvider(): void {
    if (this.provider) {
      this.provider.shutdown().catch(() => {});
      this.provider = null;
    }
  }

  /**
   * 清理已过期的记忆
   * 遍历所有记忆，删除 metadata.expiresAt 已到期的记忆
   * @returns 被清理的记忆数量
   */
  async cleanupExpiredMemories(): Promise<number> {
    const allMemories = await this.getAllMemories();
    const now = new Date();
    const expired: string[] = [];

    for (const memory of allMemories) {
      if (
        memory.metadata.expiresAt &&
        new Date(memory.metadata.expiresAt) <= now
      ) {
        expired.push(memory.id);
      }
    }

    for (const id of expired) {
      await this.store.deleteMemory(id);
      this.retriever.removeFromIndex(id);
    }

    if (expired.length > 0) {
      await this.retriever.saveIndex();
      await this.saveRelationGraph();
    }

    return expired.length;
  }

  /**
   * 设置记忆过期时间
   * @param id 记忆ID
   * @param expiresAt 过期时间
   * @returns 更新后的记忆
   */
  async setMemoryExpiry(id: string, expiresAt: Date): Promise<Memory> {
    validateMemoryId(id);
    const memory = await this.store.readMemory(id);
    if (!memory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    memory.metadata.expiresAt = expiresAt;
    memory.updatedAt = new Date();

    await this.store.saveMemory(memory);
    this.retriever.updateIndex(memory);
    await this.retriever.saveIndex();
    await this.saveRelationGraph();

    return memory;
  }

  /**
   * 扫描记忆目录
   */
  async scanMemoryDirectory(): Promise<void> {
    await this.retriever.scanMemoryDirectory();
  }

  /**
   * 构建记忆索引
   */
  async buildMemoryIndex(): Promise<void> {
    await this.retriever.buildMemoryIndex();
    await this.retriever.saveIndex();
  }

  /**
   * 获取记忆存储
   * @returns 记忆存储
   */
  getStore(): MemoryStore {
    return this.store;
  }

  /**
   * 导出记忆为Markdown文件
   * @param id 记忆ID
   * @param exportDir 导出目录
   * @returns 导出文件路径
   */
  async exportMemoryAsMarkdown(
    id: string,
    exportDir: string = './exports'
  ): Promise<string> {
    validateMemoryId(id);
    validateMemoryPath(exportDir, 'exportDir');
    return this.store.exportMemoryAsMarkdown(id, exportDir);
  }

  /**
   * 导入Markdown文件为记忆
   * @param filePath Markdown文件路径
   * @returns 创建的记忆ID
   */
  async importMemoryFromMarkdown(filePath: string): Promise<string> {
    validateMemoryPath(filePath, 'filePath');
    const id = await this.store.importMemoryFromMarkdown(filePath);

    // 重新构建索引
    await this.buildMemoryIndex();

    return id;
  }

  /**
   * 获取记忆的Markdown预览
   * @param id 记忆ID
   * @returns Markdown预览内容
   */
  async getMemoryMarkdownPreview(id: string): Promise<string> {
    return this.store.getMemoryMarkdownPreview(id);
  }

  /**
   * 获取记忆扫描器
   * @returns 记忆扫描器
   */
  getScanner(): MemoryScannerImpl {
    return this.scanner;
  }

  /**
   * 获取记忆检索器
   * @returns 记忆检索器
   */
  getRetriever(): MemoryRetrieverImpl {
    return this.retriever;
  }

  /**
   * 备份记忆数据
   * @param backupDir 备份目录
   */
  async backupMemoryData(backupDir: string = './backups'): Promise<void> {
    await fsExtra.ensureDir(backupDir);

    // 复制记忆目录到备份目录
    const backupPath = join(
      backupDir,
      `memory_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`
    );

    try {
      // 检查源目录是否存在
      const sourceExists = await fsExtra.pathExists(this.storeDir);
      if (!sourceExists) {
        throw new AppError(
          `Source memory directory ${this.storeDir} does not exist`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      await fsExtra.copy(this.storeDir, backupPath);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Failed to backup memory data from ${this.storeDir} to ${backupPath}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 恢复记忆数据
   * @param backupDir 备份目录
   */
  async restoreMemoryData(backupDir: string): Promise<void> {
    // 检查备份目录是否存在
    if (!(await fsExtra.pathExists(backupDir))) {
      throw new AppError(
        `Backup directory ${backupDir} does not exist`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 清空当前记忆目录
    await fsExtra.emptyDir(this.storeDir);

    // 复制备份数据到当前记忆目录
    const files = await fsExtra.readdir(backupDir);
    for (const file of files) {
      const srcPath = join(backupDir, file);
      const destPath = join(this.storeDir, file);
      await fsExtra.copy(srcPath, destPath);
    }

    // 重新构建索引
    await this.buildMemoryIndex();
  }

  /**
   * 加载关联图
   */
  async loadRelationGraph(): Promise<void> {
    try {
      await fs.promises.access(this.relationGraphPath);
      const content = await fs.promises.readFile(
        this.relationGraphPath,
        'utf8'
      );
      const relations = JSON.parse(content);
      memoryRelationGraph.deserialize(relations);
    } catch {
      // 文件不存在或解析失败时使用空关联图
    }
  }

  /**
   * 保存关联图
   */
  async saveRelationGraph(): Promise<void> {
    try {
      const relations = memoryRelationGraph.serialize();
      await fs.promises.writeFile(
        this.relationGraphPath,
        JSON.stringify(relations, null, 2),
        'utf8'
      );
    } catch (error) {
      logger.error(
        'Error saving relation graph',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 初始化Liri.md集成
   */
  async initializePYAppIntegration(): Promise<void> {
    await this.pyAppIntegrationService.initialize();
  }

  /**
   * 获取Liri配置
   */
  getPYAppConfig(): PYAppConfig | null {
    return this.pyAppIntegrationService.getConfig();
  }

  /**
   * 获取所有Liri规则
   */
  getPYAppRules(): Rule[] {
    return this.pyAppIntegrationService.getRules();
  }

  /**
   * 获取指定类别的Liri规则
   */
  getPYAppRulesByCategory(category: string): Rule[] {
    return this.pyAppIntegrationService.getRulesByCategory(category);
  }

  /**
   * 获取指定优先级的Liri规则
   */
  getPYAppRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[] {
    return this.pyAppIntegrationService.getRulesByPriority(priority);
  }

  /**
   * 获取所有Liri偏好设置
   */
  getPYAppPreferences(): Preference[] {
    return this.pyAppIntegrationService.getPreferences();
  }

  /**
   * 获取指定键的Liri偏好设置
   */
  getPYAppPreference(key: string): Preference | undefined {
    return this.pyAppIntegrationService.getPreference(key);
  }

  /**
   * 获取Liri偏好设置值
   */
  getPYAppPreferenceValue(key: string, defaultValue?: any): any {
    return this.pyAppIntegrationService.getPreferenceValue(key, defaultValue);
  }

  /**
   * 获取Liri规则文本（用于AI模块）
   */
  getPYAppRulesText(): string {
    return this.pyAppIntegrationService.getRulesText();
  }

  /**
   * 检查Liri是否有变化
   */
  async checkPYAppChanges(): Promise<boolean> {
    return this.pyAppIntegrationService.checkForChanges();
  }

  /**
   * 添加Liri变化监听器
   */
  addPYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.addChangeListener(listener);
  }

  /**
   * 移除Liri变化监听器
   */
  removePYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.removeChangeListener(listener);
  }
}
