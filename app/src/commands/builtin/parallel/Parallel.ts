import type { CommandContext } from '@modules/commands';
import { createToolManager } from '@modules/tools/ToolManager.js';
import { createToolScheduler } from '@modules/tools/scheduler/ToolScheduler.js';
import { getEmptyToolUseContext } from '@modules/tools/types/ToolUseContext.js';
import type { ToolUseContext } from '@modules/tools/types/ToolUseContext.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:parallel:Parallel',
  level: LogLevel.INFO,
});

const toolManager = createToolManager();

/**
 * 解析后的选项
 */
interface ParallelOptions {
  concurrency: number;
  timeout: number;
  showProgress: boolean;
  compact: boolean;
}

/**
 * 并行执行命令实现
 */
const parallelCommand = {
  /**
   * 显示帮助信息
   * @returns 帮助文本
   */
  getHelpText(): string {
    return [
      '用法: /parallel [选项] <工具1> <输入1> ; <工具2> <输入2> ; ...',
      '',
      '并行执行多个工具操作，任务间用分号 ";" 分隔。',
      '',
      '选项:',
      '  -h, --help              显示此帮助信息',
      '  -c, --concurrency <N>   最大并发数（默认: 4，最大: 10）',
      '  -t, --timeout <ms>      每个任务的超时时间（毫秒）',
      '  -p, --progress          显示实时进度',
      '      --compact           紧凑输出模式',
      '',
      '任务格式:',
      '  每个任务由工具名和输入组成，输入可以是:',
      '  - 普通字符串: bash "echo hello"',
      '  - JSON 对象: bash \'{"command":"ls"}\'',
      '',
      '示例:',
      '  /parallel bash "echo hello" ; bash "echo world"',
      '  /parallel -c 2 -t 30000 bash "npm install" ; bash "pip install"',
      '  /parallel --compact bash "echo 1" ; bash "echo 2" ; bash "echo 3"',
      '  /parallel -p bash \'{"command":"ls -la"}\' ; read "file.txt"',
      '',
      '别名: /async, /multi',
    ].join('\n');
  },

  /**
   * 执行并行命令
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 执行结果
   */
  async execute(args: string, context: CommandContext) {
    // 检查帮助标志
    const trimmed = args.trim();
    if (trimmed === '-h' || trimmed === '--help' || trimmed === 'help') {
      return {
        success: true,
        message: this.getHelpText(),
      };
    }

    // 解析选项和任务
    const { options, tasks } = this.parseOptions(toolManager, args);

    if (tasks.length === 0) {
      return {
        success: true,
        message: this.getHelpText(),
      };
    }

    try {
      const scheduler = createToolScheduler(Math.min(options.concurrency, 10));
      const results: Array<{
        toolName: string;
        result?: any;
        error?: string;
        executionTime: number;
      }> = [];
      let completedTasks = 0;
      const totalTasks = tasks.length;

      const toolContext = getEmptyToolUseContext() as ToolUseContext;
      toolContext.options = {
        ...toolContext.options,
        commands: [],
        debug: false,
        mainLoopModel: '',
        tools: [],
        verbose: false,
        thinkingConfig: {},
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: false,
        agentDefinitions: {},
        cwd: context.cwd || process.cwd(),
        environment:
          context.environment || (process.env as Record<string, string>),
      };
      toolContext.messages = [];

      // 创建中止控制器
      const abortController = new AbortController();
      toolContext.abortController = abortController;

      scheduler.setOnTaskComplete((result) => {
        results.push({
          toolName: result.toolName,
          result: result.result,
          executionTime: result.executionTime,
        });
        completedTasks++;

        if (options.showProgress) {
          this.printProgress(completedTasks, totalTasks, result.toolName);
        }
      });

      scheduler.setOnTaskError((error, task) => {
        results.push({
          toolName: task.tool.name,
          error: error.message,
          executionTime: 0,
        });
        completedTasks++;

        if (options.showProgress) {
          this.printProgress(completedTasks, totalTasks, task.tool.name, true);
        }
      });

      // 添加任务
      for (const task of tasks) {
        if (abortController.signal.aborted) {
          break;
        }

        const tool = toolManager.getTool(task.toolName);
        if (!tool) {
          return {
            success: false,
            message: `错误: 工具 "${task.toolName}" 不存在。可用工具: ${toolManager
              .getAllTools()
              .map((t) => t.name)
              .join(', ')}`,
          };
        }

        const input = this.parseInput(task.input);
        scheduler.addTask(tool, input, toolContext, task.priority || 0);
      }

      // 使用 Promise 等待所有任务完成
      const waitForCompletion = new Promise<void>((resolve) => {
        if (completedTasks >= totalTasks) {
          resolve();
          return;
        }

        scheduler.setOnSchedulerComplete(() => {
          resolve();
        });

        // 备选: 如果调度器已经完成但回调没触发
        const checkInterval = setInterval(() => {
          if (completedTasks >= totalTasks) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);

        // 超时保护
        if (options.timeout > 0) {
          setTimeout(() => {
            clearInterval(checkInterval);
            abortController.abort();
            resolve();
          }, options.timeout);
        }
      });

      scheduler.start();
      await waitForCompletion;

      // 生成结果
      return {
        success: true,
        message: this.formatResults(results, options.compact),
      };
    } catch (error) {
      return {
        success: false,
        message: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 打印进度信息
   * @param completed 已完成数
   * @param total 总数
   * @param name 工具名
   * @param isError 是否错误
   */
  printProgress(
    completed: number,
    total: number,
    name: string,
    isError: boolean = false
  ): void {
    const icon = isError ? '✗' : '✓';
    const status = isError ? '失败' : '完成';
    process.stderr.write(
      `\r[${completed}/${total}] ${icon} ${name} ${status}  `
    );
    if (completed === total) {
      process.stderr.write('\n');
    }
  },

  /**
   * 解析选项和任务
   * @param args 命令参数
   * @returns 解析结果
   */
  parseOptions(
    toolManager: any,
    args: string
  ): {
    options: ParallelOptions;
    tasks: Array<{ toolName: string; input: string; priority?: number }>;
  } {
    const options: ParallelOptions = {
      concurrency: 4,
      timeout: 0,
      showProgress: false,
      compact: false,
    };

    const parts = args.split(';');
    const taskParts: string[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // 检查是否是选项
      if (this.isOption(trimmed)) {
        if (trimmed === '-p' || trimmed === '--progress') {
          options.showProgress = true;
        } else if (trimmed === '--compact') {
          options.compact = true;
        } else if (
          trimmed === '-h' ||
          trimmed === '--help' ||
          trimmed === 'help'
        ) {
          // 帮助标志会在上层处理
          continue;
        }
        continue;
      }

      taskParts.push(trimmed);
    }

    // 从第一部分提取全局选项
    const firstPart = taskParts[0] || '';
    const globalOptions = this.extractGlobalOptions(firstPart);
    if (globalOptions) {
      if (globalOptions.concurrency !== undefined)
        options.concurrency = globalOptions.concurrency;
      if (globalOptions.timeout !== undefined)
        options.timeout = globalOptions.timeout;
      if (globalOptions.showProgress) options.showProgress = true;
      if (globalOptions.compact) options.compact = true;
    }

    // 对第一个任务检查是否混有全局选项
    const firstTask = taskParts[0] || '';
    const cleanedFirstTask = this.cleanGlobalOptions(firstTask);

    const tasks: Array<{ toolName: string; input: string; priority?: number }> =
      [];

    for (let i = 0; i < taskParts.length; i++) {
      const taskStr =
        i === 0 && cleanedFirstTask ? cleanedFirstTask : taskParts[i];
      if (!taskStr) continue;

      const parsed = this.splitTask(taskStr);
      if (parsed.length < 2) continue;

      const toolName = parsed[0];
      const input = parsed.slice(1).join(' ');
      tasks.push({ toolName, input });
    }

    return { options, tasks };
  },

  /**
   * 检查字符串是否是选项
   * @param s 字符串
   * @returns 是否是选项
   */
  isOption(s: string): boolean {
    return s.startsWith('-') || s.startsWith('--');
  },

  /**
   * 从字符串中提取全局选项
   * @param s 字符串
   * @returns 提取的选项
   */
  extractGlobalOptions(s: string): Partial<ParallelOptions> | null {
    const options: Partial<ParallelOptions> = {};

    // 匹配 -c N 或 --concurrency N
    const concurrencyMatch = s.match(/(?:-c|--concurrency)\s+(\d+)/);
    if (concurrencyMatch) {
      options.concurrency = parseInt(concurrencyMatch[1], 10);
    }

    // 匹配 -t N 或 --timeout N
    const timeoutMatch = s.match(/(?:-t|--timeout)\s+(\d+)/);
    if (timeoutMatch) {
      options.timeout = parseInt(timeoutMatch[1], 10);
    }

    if (s.includes('-p') || s.includes('--progress')) {
      options.showProgress = true;
    }

    if (s.includes('--compact')) {
      options.compact = true;
    }

    return Object.keys(options).length > 0 ? options : null;
  },

  /**
   * 清理字符串中的全局选项
   * @param s 字符串
   * @returns 清理后的字符串
   */
  cleanGlobalOptions(s: string): string {
    return s
      .replace(/(?:-c|--concurrency)\s+\d+/g, '')
      .replace(/(?:-t|--timeout)\s+\d+/g, '')
      .replace(/-p\b/g, '')
      .replace(/--progress\b/g, '')
      .replace(/--compact\b/g, '')
      .trim();
  },

  /**
   * 解析输入：优先 JSON，失败则作为普通字符串
   * @param input 输入字符串
   * @returns 解析后的输入
   */
  parseInput(input: string): Record<string, unknown> {
    // 尝试 JSON 解析
    try {
      const parsed = JSON.parse(input);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      // JSON 解析失败，作为普通字符串
      return { value: input };
    }
  },

  /**
   * 格式化结果输出
   * @param results 结果列表
   * @param compact 是否紧凑模式
   * @returns 格式化后的文本
   */
  formatResults(
    results: Array<{
      toolName: string;
      result?: any;
      error?: string;
      executionTime: number;
    }>,
    compact: boolean
  ): string {
    if (results.length === 0) {
      return '没有任务被执行。';
    }

    const successCount = results.filter((r) => !r.error).length;
    const failCount = results.filter((r) => r.error).length;

    if (compact) {
      const lines = results.map((r) => {
        if (r.error) {
          return `  ✗ ${r.toolName}: ${r.error}`;
        }
        const data = r.result?.data;
        const summary =
          typeof data === 'object' && data !== null
            ? JSON.stringify(data).substring(0, 80)
            : String(data ?? '').substring(0, 80);
        return `  ✓ ${r.toolName} (${r.executionTime}ms): ${summary}`;
      });

      return [
        `并行执行结果: ${successCount}成功, ${failCount}失败`,
        ...lines,
      ].join('\n');
    }

    const blocks = results.map((r) => {
      if (r.error) {
        return [`工具: ${r.toolName}`, `状态: 失败`, `错误: ${r.error}`].join(
          '\n'
        );
      }

      const data = r.result?.data;
      const dataStr =
        typeof data === 'object' && data !== null
          ? JSON.stringify(data, null, 2)
          : String(data ?? '无输出');

      return [
        `工具: ${r.toolName}`,
        `状态: 成功`,
        `执行时间: ${r.executionTime}ms`,
        `结果: ${dataStr}`,
      ].join('\n');
    });

    return [
      `并行执行结果 (${results.length}个任务, ${successCount}成功, ${failCount}失败):`,
      '',
      ...blocks.map((b) => `---\n${b}`),
    ].join('\n');
  },

  /**
   * 分割任务字符串（支持引号）
   * @param taskString 任务字符串
   * @returns 分割后的部分
   */
  splitTask(taskString: string): string[] {
    const parts: string[] = [];
    let currentPart = '';
    let inQuotes = false;
    let quoteChar = '';

    for (const char of taskString) {
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
      } else if (char === ' ' && !inQuotes) {
        if (currentPart) {
          parts.push(currentPart);
          currentPart = '';
        }
      } else {
        currentPart += char;
      }
    }

    if (currentPart) {
      parts.push(currentPart);
    }

    return parts;
  },
};

export { parallelCommand };
export default parallelCommand;
