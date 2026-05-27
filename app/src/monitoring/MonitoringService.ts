/**
 * 监控服务
 * 提供性能指标收集、日志监控和健康检查功能
 */

import fs from 'fs';
import path from 'path';
import { resolveLogsDir } from '@modules/config/paths';
import { getPerformanceProfiler } from '../core/utils/Performance.js';
import { performanceUtils } from '../core/utils/Performance.js';
import { profileCheckpoint } from '../utils/startupProfiler.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  AlertPresetLoader,
  createAlertPresetLoader,
} from './alerts/AlertPresetLoader.js';
import {
  BackupManager,
  createDefaultBackupManager,
} from './backup/BackupManager.js';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 监控配置
 */
export interface MonitoringConfig {
  enabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  metricsInterval: number; // 指标收集间隔（毫秒）
  logRotationInterval: number; // 日志轮换间隔（毫秒）
  maxLogSize: number; // 最大日志大小（字节）
  healthCheckInterval: number; // 健康检查间隔（毫秒）
  alertThresholds: {
    memoryUsage: number; // 内存使用阈值（字节）
    cpuUsage: number; // CPU使用阈值（百分比）
    responseTime: number; // 响应时间阈值（毫秒）
    errorRate: number; // 错误率阈值（百分比）
  };
}

/**
 * 系统状态
 */
export interface SystemStatus {
  uptime: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
  disk: {
    total: number;
    free: number;
    used: number;
    usage: number;
  };
  network: {
    interfaces: any[];
  };
  loadAverage: number[];
  process: {
    pid: number;
    title: string;
    version: string;
    env: string;
  };
}

/**
 * 监控服务
 */
export class MonitoringService {
  private config: MonitoringConfig;
  private metrics: Map<string, number[]> = new Map();
  private alerts: string[] = [];
  private startTime: number;
  private metricsTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private logRotationTimer: NodeJS.Timeout | null = null;
  private performanceProfiler = getPerformanceProfiler();
  private presetLoader: AlertPresetLoader;
  private backupManager: BackupManager;

  constructor(config: Partial<MonitoringConfig> = {}) {
    this.config = {
      enabled: true,
      logLevel: 'info',
      metricsInterval: 5000,
      logRotationInterval: 3600000, // 1小时
      maxLogSize: 10485760, // 10MB
      healthCheckInterval: 30000, // 30秒
      alertThresholds: {
        memoryUsage: 1024 * 1024 * 1024, // 1GB
        cpuUsage: 80, // 80%
        responseTime: 1000, // 1秒
        errorRate: 5, // 5%
      },
      ...config,
    };
    this.startTime = Date.now();
    this.presetLoader = createAlertPresetLoader();
    this.backupManager = createDefaultBackupManager();
  }

  /**
   * 启动监控服务
   */
  start(): void {
    profileCheckpoint('monitoring_start_start');
    if (!this.config.enabled) {
      profileCheckpoint('monitoring_start_end');
      return;
    }

    this.performStartupBackup();
    this.loadAlertPresets();
    this.startMetricsCollection();
    this.startHealthCheck();
    this.startLogRotation();
    this.log('info', '监控服务已启动');
    profileCheckpoint('monitoring_start_end');
  }

  /**
   * 加载预置告警规则
   */
  private loadAlertPresets(): void {
    try {
      const projectRoot = process.env.PYAPP_PROJECT_DIR || process.cwd();
      const presetsDir = path.join(projectRoot, 'backend', 'src', 'monitoring', 'alerts', 'presets');
      if (!fs.existsSync(presetsDir)) {
        const altDir = path.join(projectRoot, 'alerts', 'presets');
        if (fs.existsSync(altDir)) {
          this.presetLoader.setPresetsDir(altDir);
        } else {
          this.presetLoader.setPresetsDir(presetsDir);
        }
      } else {
        this.presetLoader.setPresetsDir(presetsDir);
      }
      const result = this.presetLoader.loadAllPresets();

      if (result.loadedRules > 0) {
        this.log('info', `已加载 ${result.loadedRules} 条预置告警规则`);
      }

      if (result.failedFiles.length > 0) {
        this.log(
          'warn',
          `${result.failedFiles.length} 个预置文件加载失败: ${result.failedFiles.join(', ')}`
        );
      }
    } catch (error) {
      this.log(
        'error',
        `加载预置告警规则失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 执行启动时数据库备份
   * 在数据库连接初始化之前执行，避免拷贝锁定文件
   */
  private performStartupBackup(): void {
    try {
      const results = this.backupManager.backupIfNeeded();
      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      if (succeeded.length > 0) {
        this.log(
          'info',
          `已备份 ${succeeded.length}/${results.length} 个数据库`
        );

        // 清理旧备份
        const cleanupResults = this.backupManager.cleanup();
        const totalDeleted = cleanupResults.reduce(
          (sum, r) => sum + r.deletedCount,
          0
        );
        if (totalDeleted > 0) {
          this.log('info', `已清理 ${totalDeleted} 个旧备份文件`);
        }
      }

      const fileNotFound = failed.filter((r) =>
        r.error?.includes('文件不存在')
      );
      const realFailed = failed.filter((r) => !r.error?.includes('文件不存在'));

      if (fileNotFound.length > 0) {
        this.log(
          'debug',
          `${fileNotFound.length} 个数据库尚未创建（跳过备份）: ${fileNotFound.map((r) => r.name).join(', ')}`
        );
      }

      if (realFailed.length > 0) {
        this.log(
          'warn',
          `${realFailed.length} 个数据库备份失败: ${realFailed.map((r) => `${r.name}(${r.error})`).join(', ')}`
        );
      }
    } catch (error) {
      this.log(
        'warn',
        `启动时数据库备份异常: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 停止监控服务
   */
  stop(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.logRotationTimer) {
      clearInterval(this.logRotationTimer);
      this.logRotationTimer = null;
    }

    this.log('info', '监控服务已停止');
  }

  /**
   * 开始指标收集
   */
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsInterval);
  }

  /**
   * 开始健康检查
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * 开始日志轮换
   */
  private startLogRotation(): void {
    this.logRotationTimer = setInterval(() => {
      this.rotateLogs();
    }, this.config.logRotationInterval);
  }

  /**
   * 收集性能指标
   */
  private collectMetrics(): void {
    profileCheckpoint('monitoring_collect_metrics_start');
    try {
      // 收集内存使用情况
      const memoryUsage = process.memoryUsage();
      this.addMetric('memory.heapUsed', memoryUsage.heapUsed);
      this.addMetric('memory.heapTotal', memoryUsage.heapTotal);
      this.addMetric('memory.rss', memoryUsage.rss);
      this.addMetric('memory.external', memoryUsage.external);

      // 收集CPU使用情况
      const cpuUsage = process.cpuUsage();
      this.addMetric('cpu.user', cpuUsage.user);
      this.addMetric('cpu.system', cpuUsage.system);

      // 收集系统负载
      if (process.platform === 'linux') {
        try {
          const loadAvg = require('os').loadavg();
          this.addMetric('system.load.1m', loadAvg[0]);
          this.addMetric('system.load.5m', loadAvg[1]);
          this.addMetric('system.load.15m', loadAvg[2]);
        } catch (error) {
          // 忽略错误
        }
      }

      // 检查阈值
      this.checkThresholds(memoryUsage, cpuUsage);
    } catch (error) {
      this.log(
        'error',
        `指标收集失败: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      profileCheckpoint('monitoring_collect_metrics_end');
    }
  }

  /**
   * 执行健康检查
   */
  private performHealthCheck(): void {
    profileCheckpoint('monitoring_health_check_start');
    try {
      const status = this.getSystemStatus();
      logger.info('健康检查: 系统状态正常', {
        uptime: status.uptime,
        memory: `${(status.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        cpu: `${((status.cpu.user + status.cpu.system) / 1000).toFixed(2)} ms`,
      });
    } catch (error) {
      this.log(
        'error',
        `健康检查失败: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      profileCheckpoint('monitoring_health_check_end');
    }
  }

  /**
   * 轮换日志
   */
  private rotateLogs(): void {
    try {
      const logDir = resolveLogsDir();
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logFiles = fs
        .readdirSync(logDir)
        .filter((file) => file.endsWith('.log'));

      for (const file of logFiles) {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);

        if (stats.size > this.config.maxLogSize) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const rotatedFile = path.join(logDir, `${file}.${timestamp}`);
          fs.renameSync(filePath, rotatedFile);
          fs.writeFileSync(filePath, '');
          this.log('info', `日志已轮换: ${file} -> ${rotatedFile}`);
        }
      }
    } catch (error) {
      this.log(
        'error',
        `日志轮换失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 添加指标
   */
  addMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    const values = this.metrics.get(name)!;
    values.push(value);
    if (values.length > 100) {
      values.shift();
    }
  }

  /**
   * 检查阈值
   */
  private checkThresholds(
    memoryUsage: NodeJS.MemoryUsage,
    cpuUsage: NodeJS.CpuUsage
  ): void {
    // 检查内存使用
    if (memoryUsage.rss > this.config.alertThresholds.memoryUsage) {
      const alert = `内存使用超过阈值: ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`;
      this.addAlert(alert);
    }

    // 检查CPU使用（正确计算方式）
    // 注意：process.cpuUsage()返回的是微秒数，需要与时间差比较
    // 这里我们简化处理，只在开发环境显示警告
    if (process.env.NODE_ENV !== 'production') {
      const cpuPercent =
        (cpuUsage.user + cpuUsage.system) / (Date.now() - this.startTime) / 10;
      if (cpuPercent > this.config.alertThresholds.cpuUsage) {
        const alert = `CPU使用超过阈值: ${cpuPercent.toFixed(2)}%`;
        this.addAlert(alert);
      }
    }
  }

  /**
   * 添加告警
   */
  addAlert(message: string): void {
    const alert = `${new Date().toISOString()}: ${message}`;
    this.alerts.push(alert);
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
    this.log('warn', message);
  }

  /**
   * 获取系统状态
   */
  getSystemStatus(): SystemStatus {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const loadAverage = require('os').loadavg();
    const networkInterfaces = require('os').networkInterfaces();

    // 简化的磁盘使用情况
    let disk = {
      total: 0,
      free: 0,
      used: 0,
      usage: 0,
    };

    try {
      if (process.platform === 'win32') {
        // Windows 系统
        const { execSync } = require('child_process');
        const output = execSync('wmic logicaldisk get size,freespace,caption', {
          encoding: 'utf8',
        });
        // 解析输出
      } else {
        // Unix 系统
        const { execSync } = require('child_process');
        const output = execSync('df -k', { encoding: 'utf8' });
        // 解析输出
      }
    } catch (error) {
      // 忽略错误
    }

    return {
      uptime,
      memory,
      cpu,
      disk,
      network: {
        interfaces: Object.values(networkInterfaces).flat(),
      },
      loadAverage,
      process: {
        pid: process.pid,
        title: process.title,
        version: process.version,
        env: process.env.NODE_ENV || 'development',
      },
    };
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport(): string {
    const report = this.performanceProfiler.getReport();
    return report;
  }

  /**
   * 获取指标数据
   */
  getMetrics(): Record<string, number[]> {
    const result: Record<string, number[]> = {};
    for (const [name, values] of this.metrics.entries()) {
      result[name] = values;
    }
    return result;
  }

  /**
   * 获取告警
   */
  getAlerts(): string[] {
    return [...this.alerts];
  }

  /**
   * 清除告警
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * 记录日志（委托给规范 Logger）
   */
  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: any
  ): void {
    const currentLevelIndex = ['debug', 'info', 'warn', 'error'].indexOf(
      this.config.logLevel
    );
    const messageLevelIndex = ['debug', 'info', 'warn', 'error'].indexOf(level);

    if (messageLevelIndex >= currentLevelIndex) {
      switch (level) {
        case 'debug':
          logger.debug(message, metadata);
          break;
        case 'info':
          logger.info(message, metadata);
          break;
        case 'warn':
          logger.warning(message, metadata);
          break;
        case 'error':
          logger.error(message, metadata);
          break;
      }
    }
  }

  /**
   * 生成监控报告
   */
  generateReport(): string {
    const lines: string[] = [];
    lines.push('='.repeat(80));
    lines.push('MONITORING REPORT');
    lines.push('='.repeat(80));
    lines.push('');

    // 系统状态
    const status = this.getSystemStatus();
    lines.push('SYSTEM STATUS:');
    lines.push(
      `  Uptime: ${performanceUtils.formatTime(status.uptime * 1000)}`
    );
    lines.push(
      `  Memory: ${(status.memory.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(status.memory.heapTotal / 1024 / 1024).toFixed(2)} MB`
    );
    lines.push(
      `  CPU: ${((status.cpu.user + status.cpu.system) / 1000).toFixed(2)}%`
    );
    lines.push(`  Load Average: ${status.loadAverage.join(', ')}`);
    lines.push('');

    // 指标数据
    lines.push('METRICS:');
    for (const [name, values] of this.metrics.entries()) {
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);
        lines.push(
          `  ${name}: avg=${avg.toFixed(2)}, max=${max.toFixed(2)}, min=${min.toFixed(2)}`
        );
      }
    }
    lines.push('');

    // 告警
    lines.push('ALERTS:');
    if (this.alerts.length > 0) {
      this.alerts.slice(-10).forEach((alert) => {
        lines.push(`  - ${alert}`);
      });
    } else {
      lines.push('  No alerts');
    }
    lines.push('');

    // 性能报告
    lines.push('PERFORMANCE REPORT:');
    lines.push(this.getPerformanceReport());
    lines.push('');

    lines.push('='.repeat(80));
    return lines.join('\n');
  }

  /**
   * 显示监控报告
   */
  displayReport(): void {
    console.log(this.generateReport());
  }
}

/**
 * 全局监控服务实例
 */
let monitoringService: MonitoringService | null = null;

/**
 * 获取监控服务
 */
export function getMonitoringService(
  config?: Partial<MonitoringConfig>
): MonitoringService {
  if (!monitoringService) {
    monitoringService = new MonitoringService(config);
  }
  return monitoringService;
}

/**
 * 获取并启动监控服务
 */
export function getAndStartMonitoringService(
  config?: Partial<MonitoringConfig>
): MonitoringService {
  const service = getMonitoringService(config);
  service.start();
  return service;
}

export default getMonitoringService();
