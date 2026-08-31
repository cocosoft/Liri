/**
 * 代理工具基类
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { AgentTool } from '../models/types';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent:tools:agentTool');

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
    const filePath = path as string;

    try {
      const content = readFileSync(filePath, 'utf-8');
      return {
        success: true,
        content,
        path: filePath,
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
    const filePath = path as string;
    const fileContent = content as string;
    const shouldOverwrite = overwrite === true;

    try {
      // 确保目录存在
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // 检查文件是否存在
      if (existsSync(filePath) && !shouldOverwrite) {
        return {
          success: false,
          error: '文件已存在，请设置 overwrite 为 true',
          path: filePath,
        };
      }

      writeFileSync(filePath, fileContent, 'utf-8');
      return {
        success: true,
        path: filePath,
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

  // E2：最小危险命令拦截（agent 模块独立工具无权限系统，静态 deny 兜底）
  private static readonly DENY_PATTERNS = [
    /\brm\s+(-[a-zA-Z]*[rf]|--recursive)(\s|$)/i,
    /\bsudo\b/i,
    /\bcurl\b.*\|\s*(ba)?sh\b/i,
    /\bwget\b.*\|\s*(ba)?sh\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\s+-[a-z]*f/i,
    /\brm\s+-rf\s+\/(\s|$)/,
    /\bFormat-Volume\b/i,
    /\bRemove-Item\b.*-Recurse/i,
  ];

  async execute(
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const { command, cwd } = params;
    const cmd = String(command ?? '');

    // E2：拒绝危险命令（避免无权限系统的 agent 工具执行破坏性操作）
    for (const pattern of CommandTool.DENY_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          success: false,
          error: `危险命令已被拦截（匹配 ${pattern}）。如确需执行，请使用主工具系统的 bash 工具（带权限审批）。`,
        };
      }
    }

    const { exec } = require('child_process');

    return new Promise((resolve) => {
      exec(cmd, { cwd }, (error: unknown, stdout: unknown, stderr: unknown) => {
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
      });
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
