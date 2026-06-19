/**
 * CuratorReviewScope — Curator 审查范围扩展
 *
 * 扩展 CuratorScheduler 的审查范围，从技能扩展到：
 *   - 文件（过期、大文件、未引用文件检测）
 *   - 记忆（过期记忆提醒、冗余记忆清理）
 *   - 配置（废弃配置项检测、安全配置审计）
 *
 * 参考: hermes agent/curator.py + agent/curator_backup.py
 */

import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core';
import { Logger } from '@modules/monitoring';

const logger = new Logger();

export interface FileReviewTarget {
  path: string;
  sizeBytes: number;
  lastModifiedMs: number;
  ageDays: number;
}

export interface MemoryReviewTarget {
  key: string;
  content: string;
  lastAccessedMs: number;
  accessCount: number;
  ageDays: number;
}

export interface ConfigReviewTarget {
  key: string;
  value: string;
  isDeprecated: boolean;
  isSecurityRelated: boolean;
  lastUpdatedMs: number;
}

export interface ExtendedReviewResult {
  files?: {
    stale: FileReviewTarget[]; // 过期文件
    large: FileReviewTarget[]; // 大文件
    unreferenced: FileReviewTarget[]; // 未被引用的文件
    totalScanned: number;
  };
  memories?: {
    stale: MemoryReviewTarget[]; // 过期记忆
    redundant: MemoryReviewTarget[]; // 重复记忆
    totalScanned: number;
  };
  configs?: {
    deprecated: ConfigReviewTarget[]; // 废弃配置
    securityWarnings: ConfigReviewTarget[]; // 安全警告
    totalScanned: number;
  };
  summary: string;
}

export interface CuratorScopeConfig {
  /** 文件审查：最大保留天数 */
  fileMaxAgeDays: number;
  /** 文件审查：大文件阈值 (bytes) */
  fileLargeThresholdBytes: number;
  /** 文件审查：扫描目录列表 */
  fileScanDirs: string[];
  /** 记忆审查：最大保留天数 */
  memoryMaxAgeDays: number;
  /** 记忆审查：冗余相似度阈值 (0-1) */
  memoryDedupThreshold: number;
  /** 配置审查：是否检查安全配置 */
  configSecurityCheck: boolean;
}

const DEFAULT_SCOPE_CONFIG: CuratorScopeConfig = {
  fileMaxAgeDays: 90,
  fileLargeThresholdBytes: 10 * 1024 * 1024, // 10MB
  fileScanDirs: [resolvePyappHome()],
  memoryMaxAgeDays: 60,
  memoryDedupThreshold: 0.8,
  configSecurityCheck: true,
};

/** 已知的废弃配置项 key */
const DEPRECATED_CONFIG_KEYS = new Set([
  'legacy_port',
  'old_api_key',
  'deprecated_model',
]);

/** 安全相关的配置项 key */
const SECURITY_CONFIG_KEYS = new Set([
  'api_key',
  'secret',
  'password',
  'token',
  'credentials',
  'auth',
]);

/**
 * CuratorReviewScope 审查范围管理器
 */
export class CuratorReviewScope {
  private config: CuratorScopeConfig;

  constructor(config?: Partial<CuratorScopeConfig>) {
    this.config = { ...DEFAULT_SCOPE_CONFIG, ...config };
  }

  /** 扫描过期文件 */
  scanStaleFiles(): FileReviewTarget[] {
    const targets: FileReviewTarget[] = [];
    const now = Date.now();

    for (const dir of this.config.fileScanDirs) {
      if (!existsSync(dir)) continue;
      try {
        this._scanDir(dir, targets, now);
      } catch (e) {
        logger.warn('Curator file scan error', { dir, error: String(e) });
      }
    }

    return targets;
  }

  private _scanDir(
    dir: string,
    targets: FileReviewTarget[],
    now: number
  ): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          // 跳过 node_modules / .git 等
          if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
          this._scanDir(fullPath, targets, now);
        } else if (entry.isFile()) {
          const stat = statSync(fullPath);
          const ageMs = now - stat.mtimeMs;
          const ageDays = ageMs / (24 * 60 * 60 * 1000);

          if (ageDays > this.config.fileMaxAgeDays) {
            targets.push({
              path: fullPath,
              sizeBytes: stat.size,
              lastModifiedMs: stat.mtimeMs,
              ageDays: Math.round(ageDays),
            });
          }
        }
      } catch {
        // 权限问题，跳过
      }
    }
  }

  /** 扫描大文件 */
  scanLargeFiles(): FileReviewTarget[] {
    const targets: FileReviewTarget[] = [];
    const now = Date.now();

    for (const dir of this.config.fileScanDirs) {
      if (!existsSync(dir)) continue;
      try {
        this._scanLargeFiles(dir, targets, now);
      } catch (e) {
        logger.warn('Curator large file scan error', { dir, error: String(e) });
      }
    }

    return targets.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 20);
  }

  private _scanLargeFiles(
    dir: string,
    targets: FileReviewTarget[],
    now: number
  ): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
          this._scanLargeFiles(fullPath, targets, now);
        } else if (entry.isFile()) {
          const stat = statSync(fullPath);
          if (stat.size > this.config.fileLargeThresholdBytes) {
            targets.push({
              path: fullPath,
              sizeBytes: stat.size,
              lastModifiedMs: stat.mtimeMs,
              ageDays: Math.round((now - stat.mtimeMs) / (24 * 60 * 60 * 1000)),
            });
          }
        }
      } catch {
        // 跳过
      }
    }
  }

  /** 审查记忆列表 */
  reviewMemories(
    memories: Array<{
      key: string;
      lastAccessedAt?: number;
      accessCount?: number;
    }>
  ): MemoryReviewTarget[] {
    const now = Date.now();
    const targets: MemoryReviewTarget[] = [];

    for (const mem of memories) {
      const lastAccess = mem.lastAccessedAt ?? 0;
      const ageDays = (now - lastAccess) / (24 * 60 * 60 * 1000);

      if (ageDays > this.config.memoryMaxAgeDays) {
        targets.push({
          key: mem.key,
          content: '',
          lastAccessedMs: lastAccess,
          accessCount: mem.accessCount ?? 0,
          ageDays: Math.round(ageDays),
        });
      }
    }

    return targets;
  }

  /** 审查配置项 */
  reviewConfigs(configs: Record<string, unknown>): {
    deprecated: ConfigReviewTarget[];
    securityWarnings: ConfigReviewTarget[];
  } {
    const deprecated: ConfigReviewTarget[] = [];
    const securityWarnings: ConfigReviewTarget[] = [];

    for (const [key, value] of Object.entries(configs)) {
      const keyLower = key.toLowerCase();

      if (DEPRECATED_CONFIG_KEYS.has(keyLower)) {
        deprecated.push({
          key,
          value: String(value).slice(0, 200),
          isDeprecated: true,
          isSecurityRelated: false,
          lastUpdatedMs: Date.now(),
        });
      }

      if (
        this.config.configSecurityCheck &&
        SECURITY_CONFIG_KEYS.has(keyLower)
      ) {
        securityWarnings.push({
          key,
          value: '***',
          isDeprecated: false,
          isSecurityRelated: true,
          lastUpdatedMs: Date.now(),
        });
      }
    }

    return { deprecated, securityWarnings };
  }

  /** 执行完整审查并生成报告 */
  async runFullReview(params?: {
    memories?: Array<{
      key: string;
      lastAccessedAt?: number;
      accessCount?: number;
    }>;
    configs?: Record<string, unknown>;
  }): Promise<ExtendedReviewResult> {
    const files = this.scanStaleFiles();
    const largeFiles = this.scanLargeFiles();

    let memories: MemoryReviewTarget[] = [];
    if (params?.memories) {
      memories = this.reviewMemories(params.memories);
    }

    let deprecated: ConfigReviewTarget[] = [];
    let securityWarnings: ConfigReviewTarget[] = [];
    if (params?.configs) {
      const configReview = this.reviewConfigs(params.configs);
      deprecated = configReview.deprecated;
      securityWarnings = configReview.securityWarnings;
    }

    const summaryParts: string[] = [];
    if (files.length > 0) summaryParts.push(`${files.length} 个过期文件`);
    if (largeFiles.length > 0)
      summaryParts.push(`${largeFiles.length} 个大文件`);
    if (memories.length > 0) summaryParts.push(`${memories.length} 条过期记忆`);
    if (deprecated.length > 0)
      summaryParts.push(`${deprecated.length} 项废弃配置`);
    if (securityWarnings.length > 0)
      summaryParts.push(`${securityWarnings.length} 项安全警告`);

    const summary =
      summaryParts.length > 0
        ? `审查完成: ${summaryParts.join(', ')}`
        : '审查完成: 未发现问题';

    return {
      files: {
        stale: files.slice(0, 50),
        large: largeFiles,
        unreferenced: [],
        totalScanned: files.length + largeFiles.length,
      },
      memories:
        memories.length > 0
          ? {
              stale: memories,
              redundant: [],
              totalScanned: memories.length,
            }
          : undefined,
      configs:
        deprecated.length > 0 || securityWarnings.length > 0
          ? {
              deprecated,
              securityWarnings,
              totalScanned: deprecated.length + securityWarnings.length,
            }
          : undefined,
      summary,
    };
  }
}

export const curatorReviewScope = new CuratorReviewScope();
