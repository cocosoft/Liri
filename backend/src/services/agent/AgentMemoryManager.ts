//
/**
 * Agent内存管理器
 * 实现高级内存管理功能
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/utils/log';
import { AgentMemoryScope, getAgentMemoryDir, getAgentMemoryEntrypoint } from './agentMemory';

/**
 * 确保内存目录存在
 */
function ensureMemoryDirExists(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 内存条目
 */
export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  tags?: string[];
  source?: string;
}

/**
 * 内存扫描结果
 */
export interface MemoryScanResult {
  entries: MemoryEntry[];
  totalSize: number;
  oldestEntry: MemoryEntry | null;
  newestEntry: MemoryEntry | null;
}

/**
 * Agent内存管理器
 */
export class AgentMemoryManager {
  private memoryCache: Map<string, { entries: MemoryEntry[]; timestamp: number }> = new Map();

  /**
   * 扫描Agent内存
   */
  async scanMemory(agentType: string, scope: AgentMemoryScope): Promise<MemoryScanResult> {
    const cacheKey = `memory_${agentType}_${scope}`;
    const memoryDir = getAgentMemoryDir(agentType, scope);

    // 检查缓存
    const cached = this.memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) { // 1分钟缓存
      return this.buildScanResult(cached.entries);
    }

    try {
      await ensureMemoryDirExists(memoryDir);
      
      const entries: MemoryEntry[] = [];
      let totalSize = 0;

      // 读取主内存文件
      const mainMemoryPath = getAgentMemoryEntrypoint(agentType, scope);
      if (fs.existsSync(mainMemoryPath)) {
        const content = fs.readFileSync(mainMemoryPath, 'utf8');
        totalSize += content.length;
        
        // 解析内存内容
        const mainEntry: MemoryEntry = {
          id: 'main',
          content,
          timestamp: fs.statSync(mainMemoryPath).mtimeMs,
          source: 'main'
        };
        entries.push(mainEntry);
      }

      // 读取额外的内存文件（如果有）
      const files = fs.readdirSync(memoryDir);
      for (const file of files) {
        if (file !== 'MEMORY.md' && file.endsWith('.md')) {
          const filePath = path.join(memoryDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            totalSize += content.length;
            
            const entry: MemoryEntry = {
              id: path.basename(file, '.md'),
              content,
              timestamp: fs.statSync(filePath).mtimeMs,
              source: 'file'
            };
            entries.push(entry);
          } catch (error) {
            logger.debug(`Failed to read memory file ${file}:`, error as Record<string, any>);
          }
        }
      }

      // 按时间戳排序
      entries.sort((a, b) => a.timestamp - b.timestamp);

      // 更新缓存
      this.memoryCache.set(cacheKey, {
        entries,
        timestamp: Date.now()
      });

      return this.buildScanResult(entries);
    } catch (error) {
      logger.error(`Failed to scan memory for agent ${agentType}:`, error as Error);
      return {
        entries: [],
        totalSize: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }
  }

  /**
   * 构建扫描结果
   */
  private buildScanResult(entries: MemoryEntry[]): MemoryScanResult {
    let totalSize = 0;
    entries.forEach(entry => {
      totalSize += entry.content.length;
    });

    return {
      entries,
      totalSize,
      oldestEntry: entries.length > 0 ? entries[0] : null,
      newestEntry: entries.length > 0 ? entries[entries.length - 1] : null
    };
  }

  /**
   * 管理内存年龄
   */
  async manageMemoryAge(agentType: string, scope: AgentMemoryScope, maxAgeMs: number): Promise<number> {
    try {
      const scanResult = await this.scanMemory(agentType, scope);
      const memoryDir = getAgentMemoryDir(agentType, scope);
      let deletedCount = 0;

      for (const entry of scanResult.entries) {
        if (entry.id === 'main') continue; // 保留主内存文件
        
        if (Date.now() - entry.timestamp > maxAgeMs) {
          const filePath = path.join(memoryDir, `${entry.id}.md`);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      }

      // 清除缓存
      const cacheKey = `memory_${agentType}_${scope}`;
      this.memoryCache.delete(cacheKey);

      return deletedCount;
    } catch (error) {
      logger.error(`Failed to manage memory age for agent ${agentType}:`, error as Error);
      return 0;
    }
  }

  /**
   * 优化内存使用
   */
  async optimizeMemory(agentType: string, scope: AgentMemoryScope, maxSizeBytes: number): Promise<boolean> {
    try {
      const scanResult = await this.scanMemory(agentType, scope);
      const memoryDir = getAgentMemoryDir(agentType, scope);

      if (scanResult.totalSize <= maxSizeBytes) {
        return true; // 内存使用在限制范围内
      }

      // 按时间戳排序，删除最旧的文件
      const sortedEntries = [...scanResult.entries].sort((a, b) => a.timestamp - b.timestamp);
      let currentSize = scanResult.totalSize;
      let deletedCount = 0;

      for (const entry of sortedEntries) {
        if (entry.id === 'main') continue; // 保留主内存文件
        
        const filePath = path.join(memoryDir, `${entry.id}.md`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          currentSize -= entry.content.length;
          deletedCount++;
          
          if (currentSize <= maxSizeBytes) {
            break;
          }
        }
      }

      // 清除缓存
      const cacheKey = `memory_${agentType}_${scope}`;
      this.memoryCache.delete(cacheKey);

      return true;
    } catch (error) {
      logger.error(`Failed to optimize memory for agent ${agentType}:`, error as Error);
      return false;
    }
  }

  /**
   * 清理内存
   */
  async cleanMemory(agentType: string, scope: AgentMemoryScope): Promise<boolean> {
    try {
      const memoryDir = getAgentMemoryDir(agentType, scope);
      
      if (!fs.existsSync(memoryDir)) {
        return true;
      }

      const files = fs.readdirSync(memoryDir);
      for (const file of files) {
        if (file !== 'MEMORY.md') { // 保留主内存文件
          const filePath = path.join(memoryDir, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      }

      // 清除缓存
      const cacheKey = `memory_${agentType}_${scope}`;
      this.memoryCache.delete(cacheKey);

      return true;
    } catch (error) {
      logger.error(`Failed to clean memory for agent ${agentType}:`, error as Error);
      return false;
    }
  }

  /**
   * 获取内存统计信息
   */
  async getMemoryStats(agentType: string, scope: AgentMemoryScope): Promise<{
    totalEntries: number;
    totalSize: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  }> {
    try {
      const scanResult = await this.scanMemory(agentType, scope);
      
      return {
        totalEntries: scanResult.entries.length,
        totalSize: scanResult.totalSize,
        oldestTimestamp: scanResult.oldestEntry?.timestamp || null,
        newestTimestamp: scanResult.newestEntry?.timestamp || null
      };
    } catch (error) {
      logger.error(`Failed to get memory stats for agent ${agentType}:`, error as Error);
      return {
        totalEntries: 0,
        totalSize: 0,
        oldestTimestamp: null,
        newestTimestamp: null
      };
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.memoryCache.clear();
  }
}

// 单例实例
export const agentMemoryManager = new AgentMemoryManager();
