/**
 * 代理内存
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { AgentMemory, AgentMemoryScope } from '../models/types';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from 'fs';
import { join } from 'path';
import {
  encodePayload,
  decodePayload,
} from '@modules/utils/MemoryFileEnvelope';

const logger = getLogger('agent:memory:agentMemory');

/**
 * 内存项接口
 */
export interface MemoryItem {
  value: unknown;
  timestamp: number;
  accessedAt: number;
  scope: AgentMemoryScope;
  tags?: string[];
}

/**
 * 代理内存类
 */
export class AgentMemoryImpl implements AgentMemory {
  private data: Record<string, MemoryItem> = {};
  private memoryPath?: string;
  private scope: AgentMemoryScope;
  private maxAge: number = 30 * 24 * 60 * 60 * 1000; // 默认30天
  private maxSize: number = 1000; // 默认最大内存项数
  private saveTimer?: ReturnType<typeof setTimeout>; // 防抖定时器

  /**
   * 构造函数
   * @param memoryPath 内存存储路径
   * @param scope 内存作用域
   */
  constructor(memoryPath?: string, scope: AgentMemoryScope = 'local') {
    this.memoryPath = memoryPath;
    this.scope = scope;
    this.ensureMemoryPathExists();
    this.load();
    this.cleanupOldMemory();
  }

  /**
   * 确保内存路径存在
   */
  private ensureMemoryPathExists(): void {
    if (this.memoryPath) {
      const dir = join(this.memoryPath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 添加数据到内存
   * @param key 键
   * @param value 值
   * @param tags 标签
   */
  add(key: string, value: unknown, tags?: string[]): void {
    this.data[key] = {
      value,
      timestamp: Date.now(),
      accessedAt: Date.now(),
      scope: this.scope,
      tags,
    };

    this.enforceSizeLimit();
    this.save();
  }

  /**
   * 从内存获取数据
   * @param key 键
   * @returns 值
   */
  get(key: string): unknown {
    const item = this.data[key];
    if (item) {
      // 更新访问时间
      item.accessedAt = Date.now();
      this.save();
      return item.value;
    }
    return undefined;
  }

  /**
   * 从内存删除数据
   * @param key 键
   */
  delete(key: string): void {
    delete this.data[key];
    this.save();
  }

  /**
   * 清空内存
   */
  clear(): void {
    this.data = {};
    this.save();
  }

  /**
   * 获取所有内存数据
   * @returns 所有内存数据
   */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(this.data)) {
      result[key] = item.value;
    }
    return result;
  }

  /**
   * 保存内存到文件（防抖 200ms，避免频繁同步 I/O 阻塞）
   */
  save(): void {
    if (!this.memoryPath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flushSyncSave();
    }, 200);
  }

  /**
   * 立即同步保存（进程退出等关键节点使用）
   * 原子写（tmp + rename）+ 信封格式（checksum 校验 + 可选 gzip 压缩）
   * （对标报告 L1 短板补齐：存储工程化）
   */
  flushSyncSave(): void {
    if (!this.memoryPath) return;
    try {
      const tmpPath = `${this.memoryPath}.tmp`;
      writeFileSync(tmpPath, this.encodeFile(this.data), 'utf-8');
      renameSync(tmpPath, this.memoryPath);
    } catch (error) {
      handleError(error, {
        module: 'agent:memory',
        action: '保存Agent内存到文件',
      });
    }
  }

  /**
   * 编码为信封格式（复用 @modules/utils/MemoryFileEnvelope 统一实现）。
   */
  private encodeFile(data: Record<string, MemoryItem>): string {
    return encodePayload(JSON.stringify(data));
  }

  /**
   * 解码信封格式：复用统一实现，兼容旧明文格式，损坏返回空并告警。
   */
  private decodeFile(raw: string): Record<string, MemoryItem> {
    const result = decodePayload(raw);

    switch (result.status) {
      case 'envelope':
      case 'legacy':
        return JSON.parse(result.payload) as Record<string, MemoryItem>;
      case 'corrupt':
        logger.warn('记忆文件校验失败（checksum 不匹配），可能已损坏', {
          path: this.memoryPath,
        });
        return {};
    }
  }

  /**
   * 从文件加载内存
   */
  load(): void {
    if (this.memoryPath && existsSync(this.memoryPath)) {
      try {
        const raw = readFileSync(this.memoryPath, 'utf-8');
        this.data = this.decodeFile(raw);
      } catch (error) {
        handleError(error, { module: 'agent:memory', action: '加载Agent内存' });
        this.data = {};
      }
    }
  }

  /**
   * 清理旧内存
   */
  private cleanupOldMemory(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of Object.entries(this.data)) {
      if (now - item.timestamp > this.maxAge) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => delete this.data[key]);
    if (keysToDelete.length > 0) {
      this.save();
    }
  }

  /**
   * 强制执行大小限制
   */
  private enforceSizeLimit(): void {
    const entries = Object.entries(this.data);
    if (entries.length > this.maxSize) {
      // 按访问时间排序，删除最久未访问的
      entries.sort((a, b) => a[1].accessedAt - b[1].accessedAt);
      const keysToDelete = entries
        .slice(0, entries.length - this.maxSize)
        .map((entry) => entry[0]);

      keysToDelete.forEach((key) => delete this.data[key]);
    }
  }

  /**
   * 扫描内存
   * @param predicate 过滤函数
   * @returns 匹配的内存项
   */
  scan(
    predicate: (key: string, value: unknown, item: MemoryItem) => boolean
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(this.data)) {
      if (predicate(key, item.value, item)) {
        result[key] = item.value;
      }
    }

    return result;
  }

  /**
   * 按标签搜索内存
   * @param tag 标签
   * @returns 匹配的内存项
   */
  searchByTag(tag: string): Record<string, unknown> {
    return this.scan(
      (key, value, item) => !!(item.tags && item.tags.includes(tag))
    );
  }

  /**
   * 按作用域过滤内存
   * @param scope 内存作用域
   * @returns 匹配的内存项
   */
  filterByScope(scope: AgentMemoryScope): Record<string, unknown> {
    return this.scan((key, value, item) => item.scope === scope);
  }

  /**
   * 获取内存统计信息
   * @returns 统计信息
   */
  getStats(): {
    totalItems: number;
    oldestItem: number | null;
    newestItem: number | null;
    averageAge: number | null;
  } {
    const now = Date.now();
    const items = Object.values(this.data);

    if (items.length === 0) {
      return {
        totalItems: 0,
        oldestItem: null,
        newestItem: null,
        averageAge: null,
      };
    }

    const timestamps = items.map((item) => item.timestamp);
    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);
    const averageAge =
      timestamps.reduce((sum, ts) => sum + (now - ts), 0) / items.length;

    return {
      totalItems: items.length,
      oldestItem: oldest,
      newestItem: newest,
      averageAge,
    };
  }

  /**
   * 设置最大内存年龄
   * @param milliseconds 毫秒数
   */
  setMaxAge(milliseconds: number): void {
    this.maxAge = milliseconds;
    this.cleanupOldMemory();
  }

  /**
   * 设置最大内存大小
   * @param size 最大内存项数
   */
  setMaxSize(size: number): void {
    this.maxSize = size;
    this.enforceSizeLimit();
  }

  /**
   * 获取内存作用域
   * @returns 内存作用域
   */
  getScope(): AgentMemoryScope {
    return this.scope;
  }
}

/**
 * 创建代理内存实例
 * @param memoryPath 内存存储路径
 * @param scope 内存作用域
 * @returns 代理内存实例
 */
export function createAgentMemory(
  memoryPath?: string,
  scope: AgentMemoryScope = 'local'
): AgentMemory {
  return new AgentMemoryImpl(memoryPath, scope);
}

/**
 * 代理内存实例
 */
export const agentMemory = createAgentMemory();
