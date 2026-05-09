/**
 * 记忆命令系统实现（基于CC源码）
 * 支持 /memory 命令、记忆文件选择器、自动记忆更新
 */

import { join } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  MemoryFile,
  MemoryType,
  MemoryLayer,
  MemdirService,
} from './MemdirService';
import type { MemoryScanner, RelevantMemoryResult } from './MemoryScanner';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 记忆命令选项（来自CC源码）
 */
export interface MemoryCommandOptions {
  /**
   * 是否编辑记忆文件
   */
  edit?: boolean;

  /**
   * 是否显示记忆文件选择器
   */
  showPicker?: boolean;

  /**
   * 是否自动更新记忆
   */
  autoUpdate?: boolean;

  /**
   * 查询关键词
   */
  query?: string;

  /**
   * 记忆类型过滤
   */
  type?: MemoryType;

  /**
   * 记忆层级过滤
   */
  layer?: MemoryLayer;

  /**
   * 结果数量限制
   */
  limit?: number;
}

/**
 * 记忆命令结果（来自CC源码）
 */
export interface MemoryCommandResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 相关记忆结果
   */
  relevantMemories?: RelevantMemoryResult[];

  /**
   * 记忆文件路径
   */
  memoryFilePaths?: string[];

  /**
   * 编辑的文件路径
   */
  editedFilePath?: string;

  /**
   * 统计信息
   */
  stats?: {
    totalMemories: number;
    relevantMemories: number;
    memoryLayers: Record<MemoryLayer, number>;
    memoryTypes: Record<MemoryType, number>;
  };
}

/**
 * 自动记忆配置（来自CC源码）
 */
export interface AutoMemoryConfig {
  /**
   * 是否启用自动记忆
   */
  enabled: boolean;

  /**
   * 自动记忆更新间隔（毫秒）
   */
  updateInterval: number;

  /**
   * 最小内容长度
   */
  minContentLength: number;

  /**
   * 最大内容长度
   */
  maxContentLength: number;

  /**
   * 自动记忆目录
   */
  autoMemDir: string;

  /**
   * 是否启用AutoDream
   */
  enableAutoDream: boolean;

  /**
   * AutoDream更新间隔
   */
  autoDreamInterval: number;
}

/**
 * 记忆命令系统类（基于CC源码实现）
 */
export class MemoryCommands {
  private memdirService: MemdirService;
  private memoryScanner: MemoryScanner;
  private autoMemoryConfig: AutoMemoryConfig;

  constructor(
    memdirService: MemdirService,
    memoryScanner: MemoryScanner,
    config?: Partial<AutoMemoryConfig>
  ) {
    this.memdirService = memdirService;
    this.memoryScanner = memoryScanner;

    this.autoMemoryConfig = {
      enabled: true,
      updateInterval: 24 * 60 * 60 * 1000, // 24小时
      minContentLength: 100,
      maxContentLength: 10000,
      autoMemDir: join(homedir(), '.claude', 'memory'),
      enableAutoDream: true,
      autoDreamInterval: 7 * 24 * 60 * 60 * 1000, // 7天
      ...config,
    };
  }

  /**
   * 执行 /memory 命令（来自CC源码）
   */
  async executeMemoryCommand(
    options: MemoryCommandOptions = {}
  ): Promise<MemoryCommandResult> {
    try {
      // 初始化记忆系统
      await this.memdirService.initialize();

      // 获取所有记忆文件
      const memoryFiles = this.memdirService.getAllMemoryFiles();

      if (options.edit) {
        return await this.handleEditMemory(options);
      }

      if (options.showPicker) {
        return await this.handleShowPicker(memoryFiles, options);
      }

      if (options.query) {
        return await this.handleSearchMemory(memoryFiles, options);
      }

      // 默认行为：显示记忆统计信息
      return await this.handleShowStats(memoryFiles);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 处理记忆编辑（来自CC源码）
   */
  private async handleEditMemory(
    options: MemoryCommandOptions
  ): Promise<MemoryCommandResult> {
    // 创建或编辑记忆文件
    const memoryFilePath = await this.createOrEditMemoryFile(options);

    return {
      success: true,
      editedFilePath: memoryFilePath,
    };
  }

  /**
   * 处理记忆文件选择器（来自CC源码）
   */
  private async handleShowPicker(
    memoryFiles: MemoryFile[],
    options: MemoryCommandOptions
  ): Promise<MemoryCommandResult> {
    // 过滤记忆文件
    const filteredFiles = this.filterMemoryFiles(memoryFiles, options);

    // 显示选择器UI（简化实现）
    const filePaths = filteredFiles.map((file) => file.path);

    return {
      success: true,
      memoryFilePaths: filePaths,
      stats: {
        totalMemories: memoryFiles.length,
        relevantMemories: filteredFiles.length,
        memoryLayers: this.countByLayer(filteredFiles),
        memoryTypes: this.countByType(filteredFiles),
      },
    };
  }

  /**
   * 处理记忆搜索（来自CC源码）
   */
  private async handleSearchMemory(
    memoryFiles: MemoryFile[],
    options: MemoryCommandOptions
  ): Promise<MemoryCommandResult> {
    if (!options.query) {
      return {
        success: false,
        error: 'Query parameter is required for search',
      };
    }

    // 查找相关记忆
    const relevantMemories = await this.memoryScanner.findRelevantMemories(
      options.query,
      memoryFiles,
      {
        limit: options.limit,
      }
    );

    return {
      success: true,
      relevantMemories,
      stats: {
        totalMemories: memoryFiles.length,
        relevantMemories: relevantMemories.length,
        memoryLayers: this.countByLayer(memoryFiles),
        memoryTypes: this.countByType(memoryFiles),
      },
    };
  }

  /**
   * 处理统计信息显示（来自CC源码）
   */
  private async handleShowStats(
    memoryFiles: MemoryFile[]
  ): Promise<MemoryCommandResult> {
    return {
      success: true,
      stats: {
        totalMemories: memoryFiles.length,
        relevantMemories: 0,
        memoryLayers: this.countByLayer(memoryFiles),
        memoryTypes: this.countByType(memoryFiles),
      },
    };
  }

  /**
   * 创建或编辑记忆文件（来自CC源码）
   */
  private async createOrEditMemoryFile(
    options: MemoryCommandOptions
  ): Promise<string> {
    const fileName = this.generateMemoryFileName(options);
    const filePath = join(this.autoMemoryConfig.autoMemDir, fileName);

    // 确保目录存在
    await mkdir(this.autoMemoryConfig.autoMemDir, { recursive: true });

    // 如果文件不存在，创建默认内容
    if (!existsSync(filePath)) {
      const defaultContent = this.generateDefaultMemoryContent(options);
      await writeFile(filePath, defaultContent, 'utf-8');
    }

    return filePath;
  }

  /**
   * 生成记忆文件名（来自CC源码）
   */
  private generateMemoryFileName(options: MemoryCommandOptions): string {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const type = options.type || MemoryType.USER;

    return `${timestamp}_${type}.md`;
  }

  /**
   * 生成默认记忆内容（来自CC源码）
   */
  private generateDefaultMemoryContent(options: MemoryCommandOptions): string {
    const type = options.type || MemoryType.USER;
    const timestamp = new Date().toISOString();

    return `# ${type.charAt(0).toUpperCase() + type.slice(1)} Memory

Created: ${timestamp}
Type: ${type}

## Summary

Add your memory content here...

## Context

- Related to: ${options.query || 'general'}
- Tags: [${type}]

---

*This memory file was automatically generated.*
`;
  }

  /**
   * 过滤记忆文件（来自CC源码）
   */
  private filterMemoryFiles(
    memoryFiles: MemoryFile[],
    options: MemoryCommandOptions
  ): MemoryFile[] {
    let filtered = memoryFiles;

    if (options.type) {
      filtered = filtered.filter((file) => file.type === options.type);
    }

    if (options.layer) {
      filtered = filtered.filter((file) => file.layer === options.layer);
    }

    if (options.query) {
      // 简单关键词过滤
      const query = options.query.toLowerCase();
      filtered = filtered.filter(
        (file) =>
          file.content.toLowerCase().includes(query) ||
          file.path.toLowerCase().includes(query)
      );
    }

    return filtered;
  }

  /**
   * 按层级统计（来自CC源码）
   */
  private countByLayer(memoryFiles: MemoryFile[]): Record<MemoryLayer, number> {
    const counts: Record<MemoryLayer, number> = {
      [MemoryLayer.PROJECT]: 0,
      [MemoryLayer.LOCAL]: 0,
      [MemoryLayer.AUTOMEM]: 0,
      [MemoryLayer.TEAMMEM]: 0,
      [MemoryLayer.USER]: 0,
    };

    for (const file of memoryFiles) {
      counts[file.layer] = (counts[file.layer] || 0) + 1;
    }

    return counts;
  }

  /**
   * 按类型统计（来自CC源码）
   */
  private countByType(memoryFiles: MemoryFile[]): Record<MemoryType, number> {
    const counts: Record<MemoryType, number> = {
      [MemoryType.USER]: 0,
      [MemoryType.FEEDBACK]: 0,
      [MemoryType.PROJECT]: 0,
      [MemoryType.REFERENCE]: 0,
    };

    for (const file of memoryFiles) {
      counts[file.type] = (counts[file.type] || 0) + 1;
    }

    return counts;
  }

  /**
   * 自动更新记忆（来自CC源码）
   */
  async autoUpdateMemories(): Promise<void> {
    if (!this.autoMemoryConfig.enabled) {
      return;
    }

    try {
      // 重新扫描记忆文件
      await this.memdirService.rescanMemoryFiles();

      // 应用记忆老化
      const memoryFiles = this.memdirService.getAllMemoryFiles();
      const keptMemories =
        await this.memoryScanner.applyMemoryAging(memoryFiles);

      logger.info(
        'Auto memory update completed',
        `Kept ${keptMemories.length} memories.`
      );
    } catch (error) {
      logger.error(
        'Auto memory update failed',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 启用AutoDream（来自CC源码）
   */
  async enableAutoDream(): Promise<void> {
    if (!this.autoMemoryConfig.enableAutoDream) {
      return;
    }

    // 简化实现：定期优化记忆文件
    setInterval(async () => {
      await this.autoUpdateMemories();
    }, this.autoMemoryConfig.autoDreamInterval);

    logger.info('AutoDream enabled');
  }

  /**
   * 获取配置信息
   */
  getConfig(): AutoMemoryConfig {
    return { ...this.autoMemoryConfig };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutoMemoryConfig>): void {
    this.autoMemoryConfig = { ...this.autoMemoryConfig, ...config };
  }
}
