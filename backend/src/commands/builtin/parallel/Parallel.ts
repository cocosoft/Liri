import type { CommandContext } from '../../types/index.js';
import { createToolManager } from '../../../tools/ToolManager.js';
import { createToolScheduler } from '../../../tools/scheduler/ToolScheduler.js';
import { getEmptyToolUseContext } from '../../../tools/types/ToolUseContext.js';
import type { ToolUseContext } from '../../../tools/types/ToolUseContext.js';

const toolManager = createToolManager();

const parallelCommand = {
  async call(args: string, context: CommandContext) {
    // 解析参数
    const tasks = this.parseTasks(args);

    if (tasks.length === 0) {
      return {
        type: 'text' as const,
        value:
          '用法: /parallel <工具1> <输入1> ; <工具2> <输入2> ; ...\n\n示例: /parallel bash "echo hello" ; bash "echo world"',
      };
    }

    try {
      // 创建调度器
      const scheduler = createToolScheduler(Math.min(tasks.length, 4));
      const results: any[] = [];
      let completedTasks = 0;

      // 创建工具执行上下文
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

      // 设置回调
      scheduler.setOnTaskComplete((result) => {
        results.push({
          taskId: result.taskId,
          toolName: result.toolName,
          result: result.result,
          executionTime: result.executionTime,
        });
        completedTasks++;
      });

      scheduler.setOnTaskError((error, task) => {
        results.push({
          taskId: task.id,
          toolName: task.tool.name,
          error: error.message,
        });
        completedTasks++;
      });

      // 添加任务
      for (const task of tasks) {
        const tool = toolManager.getTool(task.toolName);
        if (!tool) {
          return {
            type: 'text' as const,
            value: `错误: 工具 ${task.toolName} 不存在`,
          };
        }

        try {
          const input = JSON.parse(task.input);
          scheduler.addTask(tool, input, toolContext);
        } catch (error) {
          return {
            type: 'text' as const,
            value: `错误: 输入格式无效: ${task.input}`,
          };
        }
      }

      // 开始执行
      scheduler.start();

      // 等待所有任务完成
      while (completedTasks < tasks.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 生成结果
      let resultText = `并行执行结果:\n\n`;
      for (const result of results) {
        resultText += `工具: ${result.toolName}\n`;
        if (result.error) {
          resultText += `错误: ${result.error}\n`;
        } else {
          resultText += `执行时间: ${result.executionTime}ms\n`;
          resultText += `结果: ${JSON.stringify(result.result.data)}\n`;
        }
        resultText += `\n`;
      }

      return {
        type: 'text' as const,
        value: resultText,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 解析任务参数
   * @param args 命令参数
   * @returns 任务列表
   */
  parseTasks(args: string): Array<{ toolName: string; input: string }> {
    const tasks: Array<{ toolName: string; input: string }> = [];
    const taskStrings = args.split(';');

    for (const taskString of taskStrings) {
      const trimmedTask = taskString.trim();
      if (!trimmedTask) continue;

      // 解析工具名称和输入
      const parts = this.splitTask(trimmedTask);
      if (parts.length < 2) continue;

      const toolName = parts[0];
      const input = parts.slice(1).join(' ');

      tasks.push({ toolName, input });
    }

    return tasks;
  },

  /**
   * 分割任务字符串
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

export default parallelCommand;
