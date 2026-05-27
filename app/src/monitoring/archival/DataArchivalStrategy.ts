/**
 * 监控数据归档策略
 * 将内存中的监控数据定期持久化到磁盘，支持压缩和保留策略
 * 归档目录: backend/data/monitoring/archives/（第二层，不跟踪）
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join, resolve, basename } from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { StructuredLogger } from '../logs/StructuredLogger';
import type { StructuredLogEntry } from '../logs/StructuredLogger';
import { getMetricsService } from '../metrics/MetricsService';
import { getAlertManager, AlertLevel } from '../alerts/AlertManager';
import type { AlertNotification } from '../alerts/AlertManager';
import { IncidentManager } from '../incidents/IncidentManager';
import type { Incident } from '../incidents/IncidentManager';
import { getPerformanceAnalyzer } from '../performance/PerformanceAnalyzer';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 可归档的监控数据类型
 */
export enum ArchiveDataType {
  LOGS = 'logs',
  METRICS = 'metrics',
  ALERTS = 'alerts',
  INCIDENTS = 'incidents',
  PERFORMANCE = 'performance',
}

/**
 * 归档元数据
 */
export interface ArchiveMetadata {
  dataType: ArchiveDataType;
  archivedAt: string;
  entryCount: number;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
}

/**
 * 归档文件信息
 */
export interface ArchiveFileInfo {
  filePath: string;
  fileName: string;
  dataType: ArchiveDataType;
  archivedAt: Date;
  size: number;
  compressed: boolean;
  metadata?: ArchiveMetadata;
}

/**
 * 归档结果
 */
export interface ArchiveResult {
  dataType: ArchiveDataType;
  filePath: string;
  entryCount: number;
  size: number;
  success: boolean;
  error?: string;
}

/**
 * 清理结果
 */
export interface CleanupResult {
  dataType: ArchiveDataType;
  deletedCount: number;
  freedBytes: number;
  remainingCount: number;
}

/**
 * 不同类型的保留策略（毫秒）
 */
export interface RetentionPolicies {
  logs: number;
  metrics: number;
  alerts: number;
  incidents: number;
  performance: number;
}

/**
 * 归档策略配置
 */
export interface ArchivalConfig {
  /** 归档根目录 */
  archiveDir: string;
  /** 各类型数据的保留策略 */
  retentionPolicies: RetentionPolicies;
  /** 归档间隔（毫秒） */
  intervalMs: number;
  /** 是否启用自动归档 */
  enabled: boolean;
  /** 是否压缩旧归档 */
  compressEnabled: boolean;
  /** 压缩阈值（毫秒，归档距今超过此时间则压缩） */
  compressAfterMs: number;
}

/** 默认归档目录 */
const DEFAULT_ARCHIVE_DIR = join('data', 'monitoring', 'archives');

/** 默认归档间隔（1小时） */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** 默认各类型保留时长 */
const DEFAULT_RETENTION: RetentionPolicies = {
  logs: 7 * 24 * 60 * 60 * 1000,
  metrics: 30 * 24 * 60 * 60 * 1000,
  alerts: 90 * 24 * 60 * 60 * 1000,
  incidents: 365 * 24 * 60 * 60 * 1000,
  performance: 30 * 24 * 60 * 60 * 1000,
};

/** 默认压缩阈值（24小时前的归档自动压缩） */
const DEFAULT_COMPRESS_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * 监控数据归档策略
 * 使用策略模式，每种数据类型可独立归档
 */
export class DataArchivalStrategy {
  private config: ArchivalConfig;

  constructor(config?: Partial<ArchivalConfig>) {
    this.config = {
      archiveDir: config?.archiveDir ?? DEFAULT_ARCHIVE_DIR,
      retentionPolicies: { ...DEFAULT_RETENTION, ...config?.retentionPolicies },
      intervalMs: config?.intervalMs ?? DEFAULT_INTERVAL_MS,
      enabled: config?.enabled ?? true,
      compressEnabled: config?.compressEnabled ?? true,
      compressAfterMs: config?.compressAfterMs ?? DEFAULT_COMPRESS_AFTER_MS,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ArchivalConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      retentionPolicies: {
        ...this.config.retentionPolicies,
        ...config.retentionPolicies,
      },
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ArchivalConfig {
    return {
      ...this.config,
      retentionPolicies: { ...this.config.retentionPolicies },
    };
  }

  /**
   * 归档结构化日志（来自 StructuredLogger.MODULE_LOG_MEMORY）
   */
  archiveLogs(): ArchiveResult {
    return this.snapshotData(ArchiveDataType.LOGS, () => {
      const logs = StructuredLogger.queryLogs();
      return { entries: logs, count: logs.length };
    });
  }

  /**
   * 归档指标数据（来自 MetricsService）
   */
  archiveMetrics(): ArchiveResult {
    return this.snapshotData(ArchiveDataType.METRICS, () => {
      const metricsService = getMetricsService();
      const allMetrics = metricsService.getAllMetrics();
      const entries: Record<string, unknown>[] = [];

      for (const [key, metric] of allMetrics.entries()) {
        if (typeof metric.get === 'function') {
          entries.push({ key, value: metric.get() });
        }
      }
      return { entries, count: entries.length };
    });
  }

  /**
   * 归档告警数据（来自 AlertManager）
   */
  archiveAlerts(): ArchiveResult {
    return this.snapshotData(ArchiveDataType.ALERTS, () => {
      const alertManager = getAlertManager();
      const alerts = alertManager.getAlerts();
      return { entries: alerts, count: alerts.length };
    });
  }

  /**
   * 归档事件数据（来自 IncidentManager）
   */
  archiveIncidents(incidentManager: IncidentManager): ArchiveResult {
    return this.snapshotData(ArchiveDataType.INCIDENTS, () => {
      const incidents = incidentManager.listIncidents();
      return { entries: incidents, count: incidents.length };
    });
  }

  /**
   * 归档性能数据（来自 PerformanceAnalyzer）
   */
  archivePerformance(): ArchiveResult {
    return this.snapshotData(ArchiveDataType.PERFORMANCE, () => {
      const analyzer = getPerformanceAnalyzer();
      const snapshot = analyzer.getSnapshot();
      return { entries: [snapshot], count: 1 };
    });
  }

  /**
   * 归档所有支持的监控数据类型
   */
  archiveAll(incidentManager?: IncidentManager): ArchiveResult[] {
    const results: ArchiveResult[] = [];

    results.push(this.archiveLogs());
    results.push(this.archiveMetrics());
    results.push(this.archiveAlerts());

    if (incidentManager) {
      results.push(this.archiveIncidents(incidentManager));
    }

    results.push(this.archivePerformance());

    return results;
  }

  /**
   * 查询归档文件列表
   * @param dataType 数据类型（可选，不传则查询所有类型）
   */
  listArchives(dataType?: ArchiveDataType): ArchiveFileInfo[] {
    const types = dataType ? [dataType] : Object.values(ArchiveDataType);
    const results: ArchiveFileInfo[] = [];

    for (const dt of types) {
      const dir = this.getDataTypeDir(dt);
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir);
      for (const file of files) {
        const filePath = join(dir, file);
        try {
          const stats = statSync(filePath);
          if (!stats.isFile()) continue;

          const compressed = file.endsWith('.gz');
          results.push({
            filePath,
            fileName: file,
            dataType: dt,
            archivedAt: stats.mtime,
            size: stats.size,
            compressed,
          });
        } catch {
          continue;
        }
      }
    }

    results.sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());
    return results;
  }

  /**
   * 读取归档数据
   * @param filePath 归档文件路径
   */
  async readArchive<T = unknown>(filePath: string): Promise<T[]> {
    if (!existsSync(filePath)) {
      logger.warn(`归档文件不存在: ${filePath}`);
      return [];
    }

    try {
      let data: string;

      if (filePath.endsWith('.gz')) {
        const chunks: Buffer[] = [];
        const gunzip = createGunzip();
        const readStream = createReadStream(filePath);
        const gunzipStream = readStream.pipe(gunzip);

        for await (const chunk of gunzipStream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        data = Buffer.concat(chunks).toString('utf-8');
      } else {
        data = readFileSync(filePath, 'utf-8');
      }

      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      logger.error(
        `读取归档文件失败: ${filePath}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  /**
   * 按保留策略清理过期归档文件
   */
  cleanupByRetention(): CleanupResult[] {
    const results: CleanupResult[] = [];

    for (const dt of Object.values(ArchiveDataType)) {
      const retentionMs = this.config.retentionPolicies[dt];
      if (!retentionMs || retentionMs <= 0) continue;

      const result = this.cleanupDataType(dt, retentionMs);
      results.push(result);
    }

    return results;
  }

  /**
   * 压缩旧归档文件（超过 compressAfterMs 的 .json 文件压缩为 .json.gz）
   */
  async compressOldArchives(): Promise<ArchiveResult[]> {
    const results: ArchiveResult[] = [];
    const now = Date.now();

    for (const dt of Object.values(ArchiveDataType)) {
      const dir = this.getDataTypeDir(dt);
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(dir, file);
        try {
          const stats = statSync(filePath);
          if (now - stats.mtimeMs < this.config.compressAfterMs) continue;

          const gzPath = filePath + '.gz';
          if (existsSync(gzPath)) {
            unlinkSync(filePath);
            continue;
          }

          await pipeline(
            createReadStream(filePath),
            createGzip(),
            createWriteStream(gzPath)
          );

          const originalSize = stats.size;
          const gzStats = statSync(gzPath);
          unlinkSync(filePath);

          logger.info(`已压缩归档: ${file} -> ${file}.gz`, {
            dataType: dt,
            originalSize,
            compressedSize: gzStats.size,
            ratio: `${((gzStats.size / originalSize) * 100).toFixed(1)}%`,
          });

          results.push({
            dataType: dt,
            filePath: gzPath,
            entryCount: 0,
            size: gzStats.size,
            success: true,
          });
        } catch (error) {
          logger.warn(`压缩归档失败: ${file}`, {
            dataType: dt,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return results;
  }

  /**
   * 执行完整的归档维护周期
   * 包含：归档当前数据 → 压缩旧文件 → 清理过期文件
   */
  async runMaintenanceCycle(incidentManager?: IncidentManager): Promise<{
    archives: ArchiveResult[];
    compressions: ArchiveResult[];
    cleanups: CleanupResult[];
  }> {
    const archives = this.archiveAll(incidentManager);
    const compressions = await this.compressOldArchives();
    const cleanups = this.cleanupByRetention();

    logger.info('归档维护周期完成', {
      archived: archives.filter((a) => a.success).length,
      compressed: compressions.length,
      cleaned: cleanups.reduce((s, c) => s + c.deletedCount, 0),
    });

    return { archives, compressions, cleanups };
  }

  /**
   * 快照内存数据到归档文件
   */
  private snapshotData(
    dataType: ArchiveDataType,
    collector: () => { entries: unknown[]; count: number }
  ): ArchiveResult {
    if (!this.config.enabled) {
      return {
        dataType,
        filePath: '',
        entryCount: 0,
        size: 0,
        success: false,
        error: '归档已禁用',
      };
    }

    try {
      const { entries, count } = collector();
      if (count === 0) {
        return {
          dataType,
          filePath: '',
          entryCount: 0,
          size: 0,
          success: true,
        };
      }

      const dir = this.getDataTypeDir(dataType);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${dataType}-${timestamp}.json`;
      const filePath = join(dir, fileName);

      const content = JSON.stringify(entries, null, 2);
      writeFileSync(filePath, content, 'utf-8');
      const stats = statSync(filePath);

      logger.info(`归档完成: ${dataType}`, {
        filePath,
        count,
        size: stats.size,
      });

      return {
        dataType,
        filePath,
        entryCount: count,
        size: stats.size,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `归档失败: ${dataType}`,
        error instanceof Error ? error : new Error(message)
      );
      return {
        dataType,
        filePath: '',
        entryCount: 0,
        size: 0,
        success: false,
        error: message,
      };
    }
  }

  /**
   * 清理指定类型的过期归档
   */
  private cleanupDataType(
    dataType: ArchiveDataType,
    retentionMs: number
  ): CleanupResult {
    const dir = this.getDataTypeDir(dataType);
    if (!existsSync(dir)) {
      return { dataType, deletedCount: 0, freedBytes: 0, remainingCount: 0 };
    }

    const now = Date.now();
    const files = readdirSync(dir);
    let deletedCount = 0;
    let freedBytes = 0;
    let remainingCount = 0;

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const stats = statSync(filePath);
        if (!stats.isFile()) continue;

        if (now - stats.mtimeMs >= retentionMs) {
          freedBytes += stats.size;
          unlinkSync(filePath);
          deletedCount++;
        } else {
          remainingCount++;
        }
      } catch {
        remainingCount++;
      }
    }

    if (deletedCount > 0) {
      logger.info(`已清理过期归档: ${dataType}`, {
        deletedCount,
        freedBytes,
        remainingCount,
      });
    }

    return { dataType, deletedCount, freedBytes, remainingCount };
  }

  /**
   * 获取指定数据类型的归档子目录
   */
  getDataTypeDir(dataType: ArchiveDataType): string {
    return join(resolve(this.config.archiveDir), dataType);
  }

  /**
   * 获取归档根目录
   */
  getArchiveDir(): string {
    return resolve(this.config.archiveDir);
  }
}
