/**
 * 文件导出器
 * 提供指标和追踪数据的文件输出
 */

import fs from 'fs';
import path from 'path';
import { resolveLogsDir } from '@modules/core';
import { logForDebugging } from '@modules/utils/debug.js';
import { errorMessage } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'monitoring:exporters:FileExporter', level: LogLevel.INFO });

/**
 * 导出数据
 */
export interface FileExportData {
  timestamp: number;
  type: 'metric' | 'trace' | 'log' | 'event';
  name: string;
  value: unknown;
  attributes?: Record<string, unknown>;
}

/**
 * 文件导出器配置
 */
export interface FileExporterConfig {
  enabled: boolean;
  outputDir: string;
  maxFileSize: number; // 最大文件大小（字节）
  maxFiles: number; // 最大文件数量
  rotationInterval: number; // 轮换间隔（毫秒）
}

/**
 * 文件导出器
 */
export class FileExporter {
  private config: FileExporterConfig;
  private currentFile: string;
  private currentSize: number;
  private fileIndex: number;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<FileExporterConfig>) {
    this.config = {
      enabled: true,
      outputDir: path.join(resolveLogsDir(), 'telemetry'),
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      rotationInterval: 3600000, // 1小时
      ...config,
    };

    this.currentFile = this.getCurrentFilePath();
    this.currentSize = 0;
    this.fileIndex = 0;

    // 确保输出目录存在
    this.ensureOutputDir();

    // 初始化当前文件大小
    this.updateCurrentSize();

    // 启动定时轮换
    this.startRotation();
  }

  /**
   * 确保输出目录存在
   */
  private ensureOutputDir(): void {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  /**
   * 获取当前文件路径
   * @returns 文件路径
   */
  private getCurrentFilePath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(
      this.config.outputDir,
      `telemetry-${timestamp}-${this.fileIndex}.jsonl`
    );
  }

  /**
   * 更新当前文件大小
   */
  private updateCurrentSize(): void {
    try {
      if (fs.existsSync(this.currentFile)) {
        const stats = fs.statSync(this.currentFile);
        this.currentSize = stats.size;
      } else {
        this.currentSize = 0;
      }
    } catch {
      this.currentSize = 0;
    }
  }

  /**
   * 轮换文件
   */
  private rotateFile(): void {
    this.fileIndex++;
    this.currentFile = this.getCurrentFilePath();
    this.currentSize = 0;

    // 清理旧文件
    this.cleanupOldFiles();
  }

  /**
   * 清理旧文件
   */
  private cleanupOldFiles(): void {
    try {
      const files = fs
        .readdirSync(this.config.outputDir)
        .filter(
          (file) => file.startsWith('telemetry-') && file.endsWith('.jsonl')
        )
        .map((file) => ({
          name: file,
          path: path.join(this.config.outputDir, file),
          mtime: fs.statSync(path.join(this.config.outputDir, file)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // 删除超出最大数量的旧文件
      if (files.length > this.config.maxFiles) {
        for (const file of files.slice(this.config.maxFiles)) {
          try {
            fs.unlinkSync(file.path);
          } catch (err) {

            // 忽略删除错误

            logger.debug("Operation skipped", { context: "忽略删除错误", error: err instanceof Error ? err.message : String(err) });

          }
        }
      }
    } catch (err) {

      // 忽略清理错误

      logger.debug("Operation skipped", { context: "忽略清理错误", error: err instanceof Error ? err.message : String(err) });

    }
  }

  /**
   * 启动定时轮换
   */
  private startRotation(): void {
    if (this.config.rotationInterval > 0) {
      setInterval(() => {
        this.rotateFile();
      }, this.config.rotationInterval);
    }
  }

  /**
   * 导出数据到文件
   * @param data 导出数据
   */
  export(data: FileExportData): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      const line = JSON.stringify(data) + '\n';
      const lineSize = Buffer.byteLength(line, 'utf8');

      // 检查是否需要轮换
      if (this.currentSize + lineSize > this.config.maxFileSize) {
        this.rotateFile();
      }

      // 写入文件
      fs.appendFileSync(this.currentFile, line);
      this.currentSize += lineSize;
    } catch (error) {
      logForDebugging(`文件导出失败: ${errorMessage(error)}`, {
        level: 'error',
      });
    }
  }

  /**
   * 导出指标
   * @param name 指标名称
   * @param value 指标值
   * @param attributes 属性
   */
  exportMetric(
    name: string,
    value: unknown,
    attributes?: Record<string, unknown>
  ): void {
    this.export({
      timestamp: Date.now(),
      type: 'metric',
      name,
      value,
      attributes,
    });
  }

  /**
   * 导出追踪
   * @param name 追踪名称
   * @param value 追踪值
   * @param attributes 属性
   */
  exportTrace(
    name: string,
    value: unknown,
    attributes?: Record<string, unknown>
  ): void {
    this.export({
      timestamp: Date.now(),
      type: 'trace',
      name,
      value,
      attributes,
    });
  }

  /**
   * 导出日志
   * @param name 日志名称
   * @param value 日志值
   * @param attributes 属性
   */
  exportLog(
    name: string,
    value: unknown,
    attributes?: Record<string, unknown>
  ): void {
    this.export({
      timestamp: Date.now(),
      type: 'log',
      name,
      value,
      attributes,
    });
  }

  /**
   * 导出事件
   * @param name 事件名称
   * @param value 事件值
   * @param attributes 属性
   */
  exportEvent(
    name: string,
    value: unknown,
    attributes?: Record<string, unknown>
  ): void {
    this.export({
      timestamp: Date.now(),
      type: 'event',
      name,
      value,
      attributes,
    });
  }

  /**
   * 设置配置
   * @param config 配置
   */
  setConfig(config: Partial<FileExporterConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取配置
   * @returns 配置
   */
  getConfig(): FileExporterConfig {
    return { ...this.config };
  }
}

/**
 * 全局文件导出器实例
 */
let fileExporter: FileExporter | null = null;

/**
 * 获取文件导出器实例
 * @returns 文件导出器实例
 */
export function getFileExporter(): FileExporter {
  if (!fileExporter) {
    fileExporter = new FileExporter();
  }
  return fileExporter;
}

/**
 * 创建文件导出器实例
 * @param config 配置
 * @returns 文件导出器实例
 */
export function createFileExporter(
  config?: Partial<FileExporterConfig>
): FileExporter {
  return new FileExporter(config);
}
