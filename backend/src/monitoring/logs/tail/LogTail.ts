/**
 * LogTail 日志实时追踪
 * 对标 CC 的日志追踪功能
 */
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

/**
 * 追踪选项
 */
export interface TailOptions {
  lines?: number;
  follow?: boolean;
  filter?: string;
  level?: string;
  interval?: number;
}

/**
 * 日志行
 */
export interface LogLine {
  content: string;
  timestamp: Date;
  lineNumber: number;
  parsed?: Record<string, unknown>;
}

/**
 * 日志追踪器
 */
export class LogTail extends EventEmitter {
  private filePath: string;
  private watcher: fs.FSWatcher | null = null;
  private fileSize: number = 0;
  private isWatching: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  /**
   * 读取最近的行
   */
  readRecent(options: TailOptions = {}): LogLine[] {
    const lines = options.lines || 50;

    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = fs.readFileSync(this.filePath, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    const sliced = allLines.slice(-lines);

    return sliced
      .map((line, index) => ({
        content: line,
        timestamp: new Date(),
        lineNumber: allLines.indexOf(line) + 1,
        parsed: this.tryParse(line),
      }))
      .filter((log) => this.matchesFilter(log, options));
  }

  /**
   * 开始追踪
   */
  start(options: TailOptions = {}): void {
    if (this.isWatching) return;

    this.isWatching = true;

    if (fs.existsSync(this.filePath)) {
      this.fileSize = fs.statSync(this.filePath).size;
    }

    const interval = options.interval || 1000;

    try {
      if (options.follow) {
        this.watcher = fs.watch(this.filePath, (eventType) => {
          if (eventType === 'change') {
            this.readNewLines(options);
          }
        });
      }
    } catch {
      this.intervalId = setInterval(() => {
        this.readNewLines(options);
      }, interval);
    }
  }

  /**
   * 停止追踪
   */
  stop(): void {
    this.isWatching = false;

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 读取新增行
   */
  private readNewLines(options: TailOptions): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const stats = fs.statSync(this.filePath);

      if (stats.size < this.fileSize) {
        this.fileSize = 0;
      }

      if (stats.size === this.fileSize) return;

      const fd = fs.openSync(this.filePath, 'r');
      const buffer = Buffer.alloc(stats.size - this.fileSize);

      fs.readSync(fd, buffer, 0, buffer.length, this.fileSize);
      fs.closeSync(fd);

      this.fileSize = stats.size;

      const newContent = buffer.toString('utf-8');
      const lines = newContent.split('\n').filter(Boolean);

      for (const line of lines) {
        const logLine: LogLine = {
          content: line,
          timestamp: new Date(),
          lineNumber: -1,
          parsed: this.tryParse(line),
        };

        if (this.matchesFilter(logLine, options)) {
          this.emit('line', logLine);
        }
      }
    } catch {}
  }

  /**
   * 过滤匹配
   */
  private matchesFilter(log: LogLine, options: TailOptions): boolean {
    if (
      options.filter &&
      !log.content.toLowerCase().includes(options.filter.toLowerCase())
    ) {
      return false;
    }

    if (options.level && log.parsed) {
      const logLevel = log.parsed.level || log.parsed.severity;
      if (typeof logLevel === 'string' && logLevel !== options.level) {
        return false;
      }
    }

    return true;
  }

  /**
   * 尝试解析 JSON 日志
   */
  private tryParse(line: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  }
}
