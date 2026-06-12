/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * FileStatsService — 文件统计缓存服务
 *
 * 职责：对 FileRegistry.getStats() 增加 TTL 缓存，
 *       并提供按 source / store_zone 聚合的统计查询，
 *       避免高频访问时反复 COUNT/SUM 扫描 files 表。
 *
 * 使用方式：
 *   const svc = FileStatsService.getInstance();
 *   const stats = await svc.getStats();
 *   const bySource = await svc.getStatsBySource();
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { FileRegistry } from './FileRegistry';
import { FILES_TABLE } from './fileSchema';
import type { FileStats } from './types';

const logger = new Logger({ level: LogLevel.INFO });

/** 缓存默认 TTL（毫秒） */
const DEFAULT_TTL_MS = 60_000; // 1 分钟

/** 缓存条目接口 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * FileStatsService — 单例，提供带缓存的统计查询
 */
export class FileStatsService {
  private static instance: FileStatsService;

  private registry: FileRegistry;
  private ttlMs: number;

  /** 概览缓存 */
  private statsCache: CacheEntry<FileStats> | null = null;
  /** 按 source 聚合缓存 */
  private bySourceCache: CacheEntry<Record<string, number>> | null = null;
  /** 按 store_zone 聚合缓存 */
  private byZoneCache: CacheEntry<Record<string, { count: number; size: number }>> | null = null;

  private constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.registry = FileRegistry.getInstance();
    this.ttlMs = ttlMs;
  }

  /**
   * 获取单例实例
   */
  static getInstance(ttlMs?: number): FileStatsService {
    if (!FileStatsService.instance) {
      FileStatsService.instance = new FileStatsService(ttlMs);
    }
    return FileStatsService.instance;
  }

  /**
   * 获取文件统计概览（带缓存）
   */
  async getStats(): Promise<FileStats> {
    if (this.statsCache && Date.now() < this.statsCache.expiresAt) {
      return this.statsCache.data;
    }

    const data = await this.registry.getStats();
    this.statsCache = { data, expiresAt: Date.now() + this.ttlMs };
    return data;
  }

  /**
   * 按 source 分组统计文件数量（带缓存）
   */
  async getStatsBySource(): Promise<Record<string, number>> {
    if (this.bySourceCache && Date.now() < this.bySourceCache.expiresAt) {
      return this.bySourceCache.data;
    }

    const rows = await this.registry.query<{ source: string; count: number }>(
      `SELECT source, COUNT(*) as count FROM ${FILES_TABLE} WHERE is_deleted = 0 GROUP BY source ORDER BY count DESC`
    );

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.source] = row.count;
    }

    this.bySourceCache = { data: result, expiresAt: Date.now() + this.ttlMs };
    return result;
  }

  /**
   * 按 store_zone 分组统计（带缓存）
   */
  async getStatsByZone(): Promise<Record<string, { count: number; size: number }>> {
    if (this.byZoneCache && Date.now() < this.byZoneCache.expiresAt) {
      return this.byZoneCache.data;
    }

    const rows = await this.registry.query<{ store_zone: string; count: number; size: number }>(
      `SELECT store_zone, COUNT(*) as count, COALESCE(SUM(size), 0) as size FROM ${FILES_TABLE} WHERE is_deleted = 0 GROUP BY store_zone`
    );

    const result: Record<string, { count: number; size: number }> = {};
    for (const row of rows) {
      result[row.store_zone] = { count: row.count, size: row.size };
    }

    this.byZoneCache = { data: result, expiresAt: Date.now() + this.ttlMs };
    return result;
  }

  /**
   * 强制刷新所有缓存
   */
  invalidate(): void {
    this.statsCache = null;
    this.bySourceCache = null;
    this.byZoneCache = null;
  }
}
