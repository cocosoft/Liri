//
/**
 * 实时终端输出处理器
 * 支持远程会话的实时输出和交互
 */

import {
  TerminalComponents,
  type TableColumn,
  type TableRow,
} from '../ui/TerminalComponents.js';
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ui:RealtimeTerminalOutput',
  level: LogLevel.INFO,
});

/**
 * 终端输出配置
 */
export interface TerminalOutputConfig {
  maxBufferSize?: number;
  enableTimestamp?: boolean;
  enableColors?: boolean;
  autoScroll?: boolean;
}

/**
 * 终端输出行
 */
export interface TerminalOutputLine {
  timestamp: number;
  content: string;
  type: 'stdout' | 'stderr' | 'system' | 'prompt';
  color?: string;
}

/**
 * 实时终端输出处理器
 */
export class RealtimeTerminalOutput {
  private config: TerminalOutputConfig;
  private buffer: TerminalOutputLine[] = [];
  private onOutputCallback: ((line: TerminalOutputLine) => void) | null = null;
  private isPaused: boolean = false;

  constructor(config?: TerminalOutputConfig) {
    this.config = {
      maxBufferSize: 1000,
      enableTimestamp: false,
      enableColors: true,
      autoScroll: true,
      ...config,
    };
  }

  /**
   * 添加输出行
   */
  addLine(content: string, type: TerminalOutputLine['type'] = 'stdout'): void {
    if (this.isPaused) {
      return;
    }

    const line: TerminalOutputLine = {
      timestamp: Date.now(),
      content,
      type,
    };

    this.buffer.push(line);

    // 限制缓冲区大小
    if (this.buffer.length > (this.config.maxBufferSize ?? 1000)) {
      this.buffer.shift();
    }

    // 触发回调
    if (this.onOutputCallback) {
      this.onOutputCallback(line);
    }

    // 输出到终端
    this.printLine(line);
  }

  /**
   * 打印单行
   */
  private printLine(line: TerminalOutputLine): void {
    let content = line.content;

    // 添加时间戳
    if (this.config.enableTimestamp) {
      const time = new Date(line.timestamp).toLocaleTimeString();
      content = `[${time}] ${content}`;
    }

    // 根据类型选择颜色
    switch (line.type) {
      case 'stderr':
        TerminalComponents.printError(content);
        break;
      case 'system':
        TerminalComponents.printInfo(content);
        break;
      case 'prompt':
        TerminalComponents.printSuccess(content);
        break;
      default:
        console.log(content);
    }
  }

  /**
   * 添加标准输出
   */
  stdout(content: string): void {
    this.addLine(content, 'stdout');
  }

  /**
   * 添加错误输出
   */
  stderr(content: string): void {
    this.addLine(content, 'stderr');
  }

  /**
   * 添加系统消息
   */
  system(content: string): void {
    this.addLine(content, 'system');
  }

  /**
   * 添加提示符
   */
  prompt(content: string): void {
    this.addLine(content, 'prompt');
  }

  /**
   * 设置输出回调
   */
  onOutput(callback: (line: TerminalOutputLine) => void): void {
    this.onOutputCallback = callback;
  }

  /**
   * 暂停输出
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * 恢复输出
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * 清除缓冲区
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * 获取缓冲区内容
   */
  getBuffer(): TerminalOutputLine[] {
    return [...this.buffer];
  }

  /**
   * 获取缓冲区文本
   */
  getBufferText(): string {
    return this.buffer.map((line) => line.content).join('\n');
  }

  /**
   * 显示进度条
   */
  showProgress(
    label: string,
    current: number,
    total: number,
    options?: { width?: number }
  ): void {
    TerminalComponents.printProgressBar(current, total, options);
  }

  /**
   * 显示旋转动画
   */
  async showSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
    return TerminalComponents.printSpinner(message, task) as Promise<T>;
  }

  /**
   * 显示表格
   */
  showTable(
    headers: string[],
    rows: string[][],
    options?: { maxWidth?: number }
  ): void {
    const columns: TableColumn[] = headers.map((h) => ({
      header: h,
      width: Math.max(h.length, 10),
    }));
    const tableRows: TableRow[] = rows.map((r) => ({ cells: r }));
    TerminalComponents.printTable(columns, tableRows, options);
  }

  /**
   * 显示列表
   */
  showList(
    items: string[],
    options?: { bullet?: string; indent?: number }
  ): void {
    TerminalComponents.printList(items, options);
  }

  /**
   * 显示步骤
   */
  showSteps(
    steps: Array<{
      title: string;
      description?: string;
      status?: 'pending' | 'active' | 'completed' | 'error';
    }>
  ): void {
    TerminalComponents.printSteps(steps);
  }

  /**
   * 显示框
   */
  showBox(
    content: string,
    options?: { padding?: number; borderColor?: string }
  ): void {
    (
      TerminalComponents as unknown as {
        printBox: (
          content: string[],
          options?: Record<string, unknown>
        ) => void;
      }
    ).printBox([content], options);
  }

  /**
   * 显示分隔线
   */
  showDivider(): void {
    TerminalComponents.printDivider();
  }

  /**
   * 显示标题
   */
  showHeader(title: string): void {
    TerminalComponents.printHeader(title);
  }

  /**
   * 显示键值对
   */
  showKeyValue(
    pairs: Array<[string, string]>,
    options?: { keyColor?: string; valueColor?: string; indent?: number }
  ): void {
    (
      TerminalComponents as unknown as {
        printKeyValue: (
          pairs: Array<[string, string]>,
          options?: Record<string, unknown>
        ) => void;
      }
    ).printKeyValue(pairs, options);
  }

  /**
   * 显示徽章
   */
  showBadge(text: string, color: string): void {
    (
      TerminalComponents as unknown as {
        printBadge: (text: string, options: Record<string, unknown>) => void;
      }
    ).printBadge(text, { color });
  }
}

/**
 * 创建实时终端输出处理器
 */
export function createRealtimeTerminalOutput(
  config?: TerminalOutputConfig
): RealtimeTerminalOutput {
  return new RealtimeTerminalOutput(config);
}
