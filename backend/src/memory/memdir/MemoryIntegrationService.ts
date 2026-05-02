/**
 * 记忆系统集成服务
 * 将文件化记忆系统（Memdir）与现有数据库记忆系统集成
 */

import type { Memory, MemoryStats } from '../types/Memory';
import type { MemoryFile, MemdirService, MemoryType, MemoryLayer } from './MemdirService';
import type { MemoryScanner, RelevantMemoryResult } from './MemoryScanner';
import type { MemoryCommands, MemoryCommandOptions, MemoryCommandResult } from './MemoryCommands';

/**
 * 集成记忆接口（结合文件化和数据库记忆）
 */
export interface IntegratedMemory {
  /**
   * 记忆ID
   */
  id: string;
  
  /**
   * 记忆内容
   */
  content: string;
  
  /**
   * 记忆来源
   */
  source: 'file' | 'database';
  
  /**
   * 文件路径（仅文件化记忆）
   */
  filePath?: string;
  
  /**
   * 记忆类型
   */
  type: MemoryType;
  
  /**
   * 记忆层级
   */
  layer: MemoryLayer;
  
  /**
   * 创建时间
   */
  createdAt: Date;
  
  /**
   * 更新时间
   */
  updatedAt: Date;
  
  /**
   * 相关性分数（搜索时使用）
   */
  relevanceScore?: number;
}

/**
 * 集成记忆配置
 */
export interface MemoryIntegrationConfig {
  /**
   * 是否启用文件化记忆系统
   */
  enableMemdir: boolean;
  
  /**
   * 是否启用数据库记忆系统
   */
  enableDatabase: boolean;
  
  /**
   * 记忆搜索优先级
   */
  searchPriority: ('file' | 'database')[];
  
  /**
   * 最大搜索结果数量
   */
  maxSearchResults: number;
  
  /**
   * 是否自动同步
   */
  autoSync: boolean;
  
  /**
   * 同步间隔（毫秒）
   */
  syncInterval: number;
}

/**
 * 记忆集成服务类
 */
export class MemoryIntegrationService {
  private memdirService: MemdirService;
  private memoryScanner: MemoryScanner;
  private memoryCommands: MemoryCommands;
  private config: MemoryIntegrationConfig;
  private databaseMemories: Map<string, Memory> = new Map();
  
  constructor(
    memdirService: MemdirService,
    memoryScanner: MemoryScanner,
    memoryCommands: MemoryCommands,
    config?: Partial<MemoryIntegrationConfig>
  ) {
    this.memdirService = memdirService;
    this.memoryScanner = memoryScanner;
    this.memoryCommands = memoryCommands;
    
    this.config = {
      enableMemdir: true,
      enableDatabase: true,
      searchPriority: ['file', 'database'],
      maxSearchResults: 50,
      autoSync: true,
      syncInterval: 5 * 60 * 1000, // 5分钟
      ...config,
    };
  }

  /**
   * 初始化集成服务
   */
  async initialize(): Promise<void> {
    try {
      // 初始化文件化记忆系统
      if (this.config.enableMemdir) {
        await this.memdirService.initialize();
      }
      
      // 初始化自动同步
      if (this.config.autoSync) {
        this.startAutoSync();
      }
      
      console.log('Memory integration service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize memory integration service:', error);
      throw error;
    }
  }

  /**
   * 搜索集成记忆
   */
  async searchMemories(
    query: string,
    options: {
      limit?: number;
      types?: MemoryType[];
      layers?: MemoryLayer[];
      sources?: ('file' | 'database')[];
    } = {}
  ): Promise<IntegratedMemory[]> {
    const {
      limit = this.config.maxSearchResults,
      types,
      layers,
      sources = this.config.searchPriority,
    } = options;

    const results: IntegratedMemory[] = [];
    
    // 按优先级搜索不同来源的记忆
    for (const source of sources) {
      if (results.length >= limit) break;
      
      switch (source) {
        case 'file':
          if (this.config.enableMemdir) {
            const fileResults = await this.searchFileMemories(query, {
              limit: limit - results.length,
              types,
              layers,
            });
            results.push(...fileResults);
          }
          break;
          
        case 'database':
          if (this.config.enableDatabase) {
            const dbResults = await this.searchDatabaseMemories(query, {
              limit: limit - results.length,
              types,
              layers,
            });
            results.push(...dbResults);
          }
          break;
      }
    }
    
    // 按相关性排序
    return results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  /**
   * 搜索文件化记忆
   */
  private async searchFileMemories(
    query: string,
    options: {
      limit: number;
      types?: MemoryType[];
      layers?: MemoryLayer[];
    }
  ): Promise<IntegratedMemory[]> {
    const { limit, types, layers } = options;
    
    // 获取所有记忆文件
    const memoryFiles = this.memdirService.getAllMemoryFiles();
    
    // 过滤记忆文件
    let filteredFiles = memoryFiles;
    
    if (types && types.length > 0) {
      filteredFiles = filteredFiles.filter(file => types.includes(file.type));
    }
    
    if (layers && layers.length > 0) {
      filteredFiles = filteredFiles.filter(file => layers.includes(file.layer));
    }
    
    // 查找相关记忆
    const relevantMemories = await this.memoryScanner.findRelevantMemories(
      query,
      filteredFiles,
      { limit }
    );
    
    // 转换为集成记忆格式
    return relevantMemories.map(result => ({
      id: `file_${result.memoryFile.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      content: result.memoryFile.content,
      source: 'file',
      filePath: result.memoryFile.path,
      type: result.memoryFile.type,
      layer: result.memoryFile.layer,
      createdAt: result.memoryFile.createdAt,
      updatedAt: result.memoryFile.modifiedAt,
      relevanceScore: result.relevanceScore,
    }));
  }

  /**
   * 搜索数据库记忆
   */
  private async searchDatabaseMemories(
    query: string,
    options: {
      limit: number;
      types?: MemoryType[];
      layers?: MemoryLayer[];
    }
  ): Promise<IntegratedMemory[]> {
    const { limit } = options;
    
    // 简化实现：从内存中的数据库记忆搜索
    const memories = Array.from(this.databaseMemories.values());
    
    // 简单关键词匹配
    const queryKeywords = query.toLowerCase().split(/\s+/);
    
    const results = memories
      .map(memory => {
        const content = memory.content.toLowerCase();
        const score = queryKeywords.reduce((sum, keyword) => {
          return sum + (content.includes(keyword) ? 1 : 0);
        }, 0) / queryKeywords.length;
        
        return {
          memory,
          score,
        };
      })
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    // 转换为集成记忆格式
    return results.map(result => ({
      id: result.memory.id,
      content: result.memory.content,
      source: 'database',
      type: MemoryType.USER, // 简化实现
      layer: MemoryLayer.AUTOMEM, // 简化实现
      createdAt: result.memory.createdAt,
      updatedAt: result.memory.updatedAt,
      relevanceScore: result.score,
    }));
  }

  /**
   * 获取所有集成记忆
   */
  async getAllMemories(): Promise<IntegratedMemory[]> {
    const results: IntegratedMemory[] = [];
    
    // 获取文件化记忆
    if (this.config.enableMemdir) {
      const fileMemories = this.memdirService.getAllMemoryFiles();
      results.push(...fileMemories.map(file => ({
        id: `file_${file.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        content: file.content,
        source: 'file',
        filePath: file.path,
        type: file.type,
        layer: file.layer,
        createdAt: file.createdAt,
        updatedAt: file.modifiedAt,
      })));
    }
    
    // 获取数据库记忆
    if (this.config.enableDatabase) {
      const dbMemories = Array.from(this.databaseMemories.values());
      results.push(...dbMemories.map(memory => ({
        id: memory.id,
        content: memory.content,
        source: 'database',
        type: MemoryType.USER, // 简化实现
        layer: MemoryLayer.AUTOMEM, // 简化实现
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      })));
    }
    
    return results;
  }

  /**
   * 执行记忆命令
   */
  async executeMemoryCommand(
    options: MemoryCommandOptions
  ): Promise<MemoryCommandResult> {
    return await this.memoryCommands.executeMemoryCommand(options);
  }

  /**
   * 添加数据库记忆
   */
  async addDatabaseMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const now = new Date();
    const newMemory: Memory = {
      id: `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content: memory.content,
      metadata: memory.metadata,
      createdAt: now,
      updatedAt: now,
    };
    
    this.databaseMemories.set(newMemory.id, newMemory);
    return newMemory;
  }

  /**
   * 删除数据库记忆
   */
  async deleteDatabaseMemory(id: string): Promise<void> {
    this.databaseMemories.delete(id);
  }

  /**
   * 获取记忆统计信息
   */
  async getMemoryStats(): Promise<{
    totalMemories: number;
    fileMemories: number;
    databaseMemories: number;
    byType: Record<MemoryType, number>;
    byLayer: Record<MemoryLayer, number>;
    totalSize: number;
  }> {
    const allMemories = await this.getAllMemories();
    
    const byType: Record<MemoryType, number> = {
      [MemoryType.USER]: 0,
      [MemoryType.FEEDBACK]: 0,
      [MemoryType.PROJECT]: 0,
      [MemoryType.REFERENCE]: 0,
    };
    
    const byLayer: Record<MemoryLayer, number> = {
      [MemoryLayer.PROJECT]: 0,
      [MemoryLayer.LOCAL]: 0,
      [MemoryLayer.AUTOMEM]: 0,
      [MemoryLayer.TEAMMEM]: 0,
      [MemoryLayer.USER]: 0,
    };
    
    let totalSize = 0;
    
    for (const memory of allMemories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
      byLayer[memory.layer] = (byLayer[memory.layer] || 0) + 1;
      totalSize += memory.content.length;
    }
    
    return {
      totalMemories: allMemories.length,
      fileMemories: allMemories.filter(m => m.source === 'file').length,
      databaseMemories: allMemories.filter(m => m.source === 'database').length,
      byType,
      byLayer,
      totalSize,
    };
  }

  /**
   * 开始自动同步
   */
  private startAutoSync(): void {
    setInterval(async () => {
      try {
        await this.syncMemories();
      } catch (error) {
        console.error('Auto sync failed:', error);
      }
    }, this.config.syncInterval);
  }

  /**
   * 同步记忆系统
   */
  async syncMemories(): Promise<void> {
    if (this.config.enableMemdir) {
      // 重新扫描文件化记忆
      await this.memdirService.rescanMemoryFiles();
    }
    
    // 应用记忆老化
    const allMemories = await this.getAllMemories();
    const fileMemories = allMemories.filter(m => m.source === 'file');
    
    // 转换为MemoryFile格式进行老化处理
    const memoryFiles = fileMemories.map(memory => ({
      path: memory.filePath || '',
      type: memory.type,
      layer: memory.layer,
      content: memory.content,
      size: memory.content.length,
      modifiedAt: memory.updatedAt,
      createdAt: memory.createdAt,
      enabled: true,
    }));
    
    const keptMemories = await this.memoryScanner.applyMemoryAging(memoryFiles);
    
    console.log(`Memory sync completed. Kept ${keptMemories.length} file memories.`);
  }

  /**
   * 导出记忆到文件
   */
  async exportMemoriesToFile(
    filePath: string,
    options: {
      types?: MemoryType[];
      layers?: MemoryLayer[];
      sources?: ('file' | 'database')[];
    } = {}
  ): Promise<void> {
    const memories = await this.getAllMemories();
    
    // 过滤记忆
    let filteredMemories = memories;
    
    if (options.types && options.types.length > 0) {
      filteredMemories = filteredMemories.filter(m => options.types!.includes(m.type));
    }
    
    if (options.layers && options.layers.length > 0) {
      filteredMemories = filteredMemories.filter(m => options.layers!.includes(m.layer));
    }
    
    if (options.sources && options.sources.length > 0) {
      filteredMemories = filteredMemories.filter(m => options.sources!.includes(m.source));
    }
    
    // 生成导出内容
    const exportContent = this.generateExportContent(filteredMemories);
    
    // 写入文件（简化实现）
    console.log(`Exporting ${filteredMemories.length} memories to ${filePath}`);
    console.log('Export content preview:', exportContent.substring(0, 200));
  }

  /**
   * 生成导出内容
   */
  private generateExportContent(memories: IntegratedMemory[]): string {
    let content = '# Memory Export\n\n';
    content += `Exported: ${new Date().toISOString()}\n`;
    content += `Total memories: ${memories.length}\n\n`;
    
    for (const memory of memories) {
      content += `## ${memory.type.toUpperCase()} Memory (${memory.source})\n`;
      content += `ID: ${memory.id}\n`;
      content += `Type: ${memory.type}\n`;
      content += `Layer: ${memory.layer}\n`;
      content += `Created: ${memory.createdAt.toISOString()}\n`;
      content += `Updated: ${memory.updatedAt.toISOString()}\n`;
      
      if (memory.filePath) {
        content += `File: ${memory.filePath}\n`;
      }
      
      content += `\n${memory.content}\n\n---\n\n`;
    }
    
    return content;
  }

  /**
   * 获取配置信息
   */
  getConfig(): MemoryIntegrationConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryIntegrationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}