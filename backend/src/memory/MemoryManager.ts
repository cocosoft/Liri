// @ts-nocheck
import type { Memory, MemoryStats } from './types/Memory';
import { createMemory } from './types/Memory';
import { MemoryStoreImpl } from './stores/MemoryStore';
import { MemoryScannerImpl } from './scanners/MemoryScanner';
import { MemoryRetrieverImpl } from './retrievers/MemoryRetriever';
import { MemoryType } from './types/MemoryType';
import { MemoryPromptService, MemoryPrompt } from './services/MemoryPromptService';
import { AutoMemoryService, AutoMemoryConfig } from './services/AutoMemoryService';
import { TeamMemoryService, TeamMemoryConfig, TeamMemorySyncStatus, TeamMemorySyncRecord } from './services/TeamMemoryService';
import { PYAppIntegrationService, PYAppConfig, Rule, Preference } from './services/PYAppIntegrationService';

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

  // PY_APP.md集成功能
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
export class MemoryManagerImpl implements MemoryManager {
  /**
   * 记忆存储
   */
  private store: MemoryStoreImpl;

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
   * PY_APP.md集成服务
   */
  private pyAppIntegrationService: PYAppIntegrationService;

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   */
  constructor(memoryDir: string = './data/memory') {
    this.store = new MemoryStoreImpl(memoryDir);
    this.scanner = new MemoryScannerImpl();
    this.retriever = new MemoryRetrieverImpl(memoryDir);
    this.promptService = new MemoryPromptService(this);
    this.autoMemoryService = new AutoMemoryService(this);
    this.teamMemoryService = new TeamMemoryService(this);
    this.pyAppIntegrationService = new PYAppIntegrationService();
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

    return newMemory;
  }

  /**
   * 获取记忆
   * @param id 记忆ID
   * @returns 记忆对象或null
   */
  async getMemory(id: string): Promise<Memory | null> {
    return this.store.readMemory(id);
  }

  /**
   * 更新记忆
   * @param id 记忆ID
   * @param updates 更新数据
   * @returns 更新后的记忆
   */
  async updateMemory(id: string, updates: Partial<Memory>): Promise<Memory> {
    // 获取现有记忆
    const existingMemory = await this.store.readMemory(id);
    if (!existingMemory) {
      throw new Error(`Memory with id ${id} not found`);
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

    return updatedMemory;
  }

  /**
   * 删除记忆
   * @param id 记忆ID
   */
  async deleteMemory(id: string): Promise<void> {
    await this.store.deleteMemory(id);

    // 从检索器索引中移除
    this.retriever.removeFromIndex(id);
    await this.retriever.saveIndex();
  }

  /**
   * 检索相关记忆
   * @param query 查询字符串
   * @param limit 返回数量限制
   * @returns 相关记忆列表
   */
  async getRelevantMemories(
    query: string,
    limit: number = 5
  ): Promise<Memory[]> {
    return this.retriever.retrieve(query, limit);
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
      [MemoryType.USER]: 0,
      [MemoryType.FEEDBACK]: 0,
      [MemoryType.PROJECT]: 0,
      [MemoryType.REFERENCE]: 0,
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
  async exportMemoryAsMarkdown(id: string, exportDir: string = './exports'): Promise<string> {
    return this.store.exportMemoryAsMarkdown(id, exportDir);
  }

  /**
   * 导入Markdown文件为记忆
   * @param filePath Markdown文件路径
   * @returns 创建的记忆ID
   */
  async importMemoryFromMarkdown(filePath: string): Promise<string> {
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
    const backupPath = join(backupDir, `memory_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await fsExtra.copy(this.storeDir, backupPath);
  }

  /**
   * 恢复记忆数据
   * @param backupDir 备份目录
   */
  async restoreMemoryData(backupDir: string): Promise<void> {
    // 检查备份目录是否存在
    if (!(await fsExtra.pathExists(backupDir))) {
      throw new Error(`Backup directory ${backupDir} does not exist`);
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
   * 初始化PY_APP.md集成
   */
  async initializePYAppIntegration(): Promise<void> {
    await this.pyAppIntegrationService.initialize();
  }

  /**
   * 获取PY_APP配置
   */
  getPYAppConfig(): PYAppConfig | null {
    return this.pyAppIntegrationService.getConfig();
  }

  /**
   * 获取所有PY_APP规则
   */
  getPYAppRules(): Rule[] {
    return this.pyAppIntegrationService.getRules();
  }

  /**
   * 获取指定类别的PY_APP规则
   */
  getPYAppRulesByCategory(category: string): Rule[] {
    return this.pyAppIntegrationService.getRulesByCategory(category);
  }

  /**
   * 获取指定优先级的PY_APP规则
   */
  getPYAppRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[] {
    return this.pyAppIntegrationService.getRulesByPriority(priority);
  }

  /**
   * 获取所有PY_APP偏好设置
   */
  getPYAppPreferences(): Preference[] {
    return this.pyAppIntegrationService.getPreferences();
  }

  /**
   * 获取指定键的PY_APP偏好设置
   */
  getPYAppPreference(key: string): Preference | undefined {
    return this.pyAppIntegrationService.getPreference(key);
  }

  /**
   * 获取PY_APP偏好设置值
   */
  getPYAppPreferenceValue(key: string, defaultValue?: any): any {
    return this.pyAppIntegrationService.getPreferenceValue(key, defaultValue);
  }

  /**
   * 获取PY_APP规则文本（用于AI模块）
   */
  getPYAppRulesText(): string {
    return this.pyAppIntegrationService.getRulesText();
  }

  /**
   * 检查PY_APP是否有变化
   */
  async checkPYAppChanges(): Promise<boolean> {
    return this.pyAppIntegrationService.checkForChanges();
  }

  /**
   * 添加PY_APP变化监听器
   */
  addPYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.addChangeListener(listener);
  }

  /**
   * 移除PY_APP变化监听器
   */
  removePYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.removeChangeListener(listener);
  }
}
