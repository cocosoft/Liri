/**
 * 文件导出器
 * 提供指标和追踪数据的文件输出
 */

import fs from 'fs';
import path from 'path';
import { resolveLogsDir } from '@openliri/kernel';
import { logForDebugging } from '@modules/utils/debug.js';
import { errorMessage, handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('monitoring:exporters:FileExporter');

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
  /** 定时轮换句柄（BUG-2 修复：可停止、不阻塞退出、实例可回收） */
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  /** 输出目录是否已就绪（构造函数零 I/O，延迟到 start/首次 export） */
  private outputDirReady = false;

  /**
   * 构造函数
   *
   * 零副作用约定：只做字段赋值，不做目录探测/文件 stat/定时器注册。
   * 上述动作由 `start()`（工厂函数会调用）或首次 `export()` 按需完成。
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
  }

  /**
   * 启动定时轮换（显式生命周期入口）
   *
   * BUG-2 修复：构造函数不再注册定时器（零副作用），由工厂函数
   * `getFileExporter()` / `createFileExporter()` 或上层容器显式调用。
   * 幂等：已在运行时直接返回，不重置计时。
   */
  start(): void {
    if (this.rotationTimer) return;
    this.ensureOutputDirOnce();
    this.updateCurrentSize();
    this.startRotation();
  }

  /**
   * 确保输出目录存在（只执行一次；构造函数零 I/O 的落地入口）
   */
  private ensureOutputDirOnce(): void {
    if (this.outputDirReady) return;
    this.ensureOutputDir();
    this.outputDirReady = true;
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

            handleError(err, {
              module: 'monitoring:exporters:FileExporter',
              action: 'ignoreFileDeleteError',
            });
          }
        }
      }
    } catch (err) {
      // 忽略清理错误

      handleError(err, {
        module: 'monitoring:exporters:FileExporter',
        action: 'ignoreCleanupError',
      });
    }
  }

  /**
   * 启动定时轮换
   *
   * BUG-2 修复要点：
   * 1. 句柄存入实例字段，避免「创建有、回收无」；
   * 2. `unref()` 让定时器不阻碍进程退出（Node/Bun 环境有效）；
   * 3. 重复调用不会叠加多个定时器（先停旧的）。
   */
  private startRotation(): void {
    this.stopRotation();
    if (this.config.rotationInterval <= 0) return;

    const timer = setInterval(() => {
      this.rotateFile();
    }, this.config.rotationInterval);

    // Bun/Node 均支持 unref；其它运行时（如浏览器）无此方法
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }

    this.rotationTimer = timer;
  }

  /**
   * 停止定时轮换（幂等）
   */
  stopRotation(): void {
    if (this.rotationTimer !== null) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  /**
   * 停止定时轮换（与 `stopRotation` 同义；生命周期入口统一用 start/stop 命名）
   */
  stop(): void {
    this.stopRotation();
  }

  /**
   * 释放资源：停止定时轮换（供上层容器统一 dispose 调用）
   */
  dispose(): void {
    this.stopRotation();
  }

  /**
   * 导出数据到文件
   * @param data 导出数据
   */
  export(data: FileExportData): void {
    if (!this.config.enabled) {
      return;
    }

    // 构造函数零 I/O：未调用 start() 时，首次导出按需创建目录
    this.ensureOutputDirOnce();

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
    const rotationIntervalChanged =
      config.rotationInterval !== undefined &&
      config.rotationInterval !== this.config.rotationInterval;
    const outputDirChanged =
      config.outputDir !== undefined &&
      config.outputDir !== this.config.outputDir;
    this.config = {
      ...this.config,
      ...config,
    };
    // 输出目录变化 ⇒ 下次 start/export 重新确保目录存在，并切换当前文件到新目录
    if (outputDirChanged) {
      this.outputDirReady = false;
      this.currentFile = this.getCurrentFilePath();
      this.currentSize = 0;
    }
    // 轮换间隔变化 ⇒ 先停旧句柄再按新配置启动，避免旧定时器继续按旧间隔触发
    if (rotationIntervalChanged) {
      this.stopRotation();
      this.startRotation();
    }
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
    // BUG-2 修复：构造函数零定时器副作用，由工厂显式启动（对外语义保持不变）
    fileExporter.start();
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
  const exporter = new FileExporter(config);
  // BUG-2 修复：构造函数零定时器副作用，由工厂显式启动（对外语义保持不变）
  exporter.start();
  return exporter;
}
