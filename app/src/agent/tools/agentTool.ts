/**
 * 代理工具基类
 */

import { AgentTool } from '../models/types';

/**
 * 代理工具基类
 */
export abstract class BaseAgentTool implements AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;

  /**
   * 构造函数
   * @param name 工具名称
   * @param description 工具描述
   * @param parameters 工具参数
   */
  constructor(
    name: string,
    description: string,
    parameters: Record<string, unknown>
  ) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
  }

  /**
   * 执行工具
   * @param params 工具参数
   * @returns 执行结果
   */
  abstract execute(
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}

/**
 * 文件读取工具
 */
export class FileReadTool extends BaseAgentTool {
  constructor() {
    super('file_read', '读取文件内容', {
      path: {
        type: 'string',
        description: '文件路径',
        required: true,
      },
    });
  }

  async execute(
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const { path } = params;
    const fs = require('fs');

    try {
      const content = fs.readFileSync(path, 'utf-8');
      return {
        success: true,
        content,
        path,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        path,
      };
    }
  }
}

/**
 * 文件写入工具
 */
export class FileWriteTool extends BaseAgentTool {
  constructor() {
    super('file_write', '写入文件内容', {
      path: {
        type: 'string',
        description: '文件路径',
        required: true,
      },
      content: {
        type: 'string',
        description: '文件内容',
        required: true,
      },
      overwrite: {
        type: 'boolean',
        description: '是否覆盖现有文件',
        required: false,
        default: false,
      },
    });
  }

  async execute(
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const { path, content, overwrite = false } = params;
    const fs = require('fs');
    const pathModule = require('path');

    try {
      // 确保目录存在
      const dir = pathModule.dirname(path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 检查文件是否存在
      if (fs.existsSync(path) && !overwrite) {
        return {
          success: false,
          error: '文件已存在，请设置 overwrite 为 true',
          path,
        };
      }

      fs.writeFileSync(path, content, 'utf-8');
      return {
        success: true,
        path,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        path,
      };
    }
  }
}

/**
 * 命令执行工具
 */
export class CommandTool extends BaseAgentTool {
  constructor() {
    super('command', '执行命令行命令', {
      command: {
        type: 'string',
        description: '要执行的命令',
        required: true,
      },
      cwd: {
        type: 'string',
        description: '工作目录',
        required: false,
      },
    });
  }

  async execute(
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const { command, cwd } = params;
    const { exec } = require('child_process');

    return new Promise((resolve) => {
      exec(
        command,
        { cwd },
        (error: unknown, stdout: unknown, stderr: unknown) => {
          if (error) {
            resolve({
              success: false,
              error: (error as { message: string }).message,
              stdout,
              stderr,
            });
          } else {
            resolve({
              success: true,
              stdout,
              stderr,
            });
          }
        }
      );
    });
  }
}

/**
 * 工具工厂
 */
export class ToolFactory {
  /**
   * 创建默认工具列表
   * @returns 工具列表
   */
  static createDefaultTools(): AgentTool[] {
    return [new FileReadTool(), new FileWriteTool(), new CommandTool()];
  }

  /**
   * 创建文件读取工具
   * @returns 文件读取工具
   */
  static createFileReadTool(): AgentTool {
    return new FileReadTool();
  }

  /**
   * 创建文件写入工具
   * @returns 文件写入工具
   */
  static createFileWriteTool(): AgentTool {
    return new FileWriteTool();
  }

  /**
   * 创建命令执行工具
   * @returns 命令执行工具
   */
  static createCommandTool(): AgentTool {
    return new CommandTool();
  }
}
