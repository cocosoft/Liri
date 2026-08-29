/**
 * Bash命令
 * 对标CC源码实现，支持超时、工作目录、环境变量等高级参数
 */

import type { Command, CommandImplementation } from '@modules/commands';
import { getToolManager } from '@modules/tools';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:tools:system:bash');

/**
 * 解析后的Bash命令选项
 */
interface BashParsedArgs {
  command: string;
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * 构建帮助文本
 * @returns 完整帮助信息
 */
function buildHelpText(): string {
  return [
    '用法: /bash [选项] <command>',
    '',
    '执行bash命令，支持安全检查、超时控制、工作目录和环境变量等选项。',
    '',
    '选项:',
    '  -h, --help                   显示此帮助信息',
    '  --timeout <ms>               执行超时时间（毫秒，默认60000，最大300000）',
    '  --cwd <path>                 指定工作目录（默认当前目录）',
    '  --env <key=value>            设置环境变量（可重复使用）',
    '',
    '安全检查说明:',
    '  系统会对命令进行多层安全检查，包括：',
    '  - 危险命令检测（rm -rf /, sudo, 系统管理命令等）',
    '  - 危险模式检测（命令替换、eval调用等）',
    '  - AST级安全分析（解析命令结构检测风险）',
    '  - 敏感路径保护（禁止操作系统关键目录）',
    '  被拦截的命令会返回详细的安全检查失败信息。',
    '',
    '退出码:',
    '  0   - 命令执行成功',
    '  非0 - 命令执行失败（具体含义取决于执行的命令）',
    '',
    '输出说明:',
    '  stdout  - 命令的标准输出',
    '  stderr  - 命令的错误输出',
    '  当命令执行失败时，会同时显示退出码和错误信息。',
    '',
    '示例:',
    '  /bash ls -la',
    '  /bash --timeout 10000 npm install',
    '  /bash --cwd /home/project git status',
    '  /bash --env NODE_ENV=production npm run build',
    '  /bash --env VAR1=val1 --env VAR2=val2 echo \$VAR1',
    '  /bash --timeout 30000 --cwd /app --env DEBUG=true node server.js',
    '',
    '别名: /sh, /shell',
  ].join('\n');
}

/**
 * 解析命令行参数，提取选项和命令
 * @param args 原始参数字符串
 * @returns 解析后的选项和执行命令
 */
function parseBashArgs(args: string): BashParsedArgs {
  let timeout: number | undefined;
  let cwd: string | undefined;
  const env: Record<string, string> = {};
  const tokens: string[] = [];
  let i = 0;

  const parts = args.trim().split(/\s+/);
  while (i < parts.length) {
    const part = parts[i];
    if (part === '--help' || part === '-h') {
      return { command: '' };
    } else if (part === '--timeout' && i + 1 < parts.length) {
      const val = parseInt(parts[i + 1], 10);
      if (!isNaN(val) && val > 0) {
        timeout = Math.min(val, 300000);
      }
      i += 2;
    } else if (part === '--cwd' && i + 1 < parts.length) {
      cwd = parts[i + 1];
      i += 2;
    } else if (part === '--env' && i + 1 < parts.length) {
      const envPair = parts[i + 1];
      const eqIdx = envPair.indexOf('=');
      if (eqIdx > 0) {
        const key = envPair.substring(0, eqIdx);
        const value = envPair.substring(eqIdx + 1);
        if (key) {
          env[key] = value;
        }
      }
      i += 2;
    } else {
      tokens.push(part);
      i++;
    }
  }

  return {
    command: tokens.join(' '),
    timeout,
    cwd,
    env: Object.keys(env).length > 0 ? env : undefined,
  };
}

/**
 * Bash命令实现
 */
const bashImplementation: CommandImplementation = {
  execute: async (args: string) => {
    if (!args.trim()) {
      return {
        success: false,
        error: buildHelpText(),
      };
    }

    const parsed = parseBashArgs(args);

    // 处理 --help / -h
    if (!parsed.command && (args.includes('--help') || args.includes('-h'))) {
      return {
        success: true,
        message: buildHelpText(),
      };
    }

    if (!parsed.command) {
      return {
        success: false,
        error:
          '错误: 未指定要执行的命令\n用法: /bash [选项] <command>\n使用 /bash --help 查看详细帮助',
      };
    }

    try {
      const toolManager = getToolManager();
      const toolInput: Record<string, unknown> = {
        command: parsed.command,
      };

      if (parsed.timeout !== undefined) {
        toolInput.timeout = parsed.timeout;
      }
      if (parsed.cwd !== undefined) {
        toolInput.cwd = parsed.cwd;
      }
      if (parsed.env !== undefined) {
        toolInput.env = parsed.env;
      }

      const result = await toolManager.executeTool('bash', toolInput, {});

      const parts: string[] = [];

      // 优先使用工具返回的结构化数据
      const data = result.data as Record<string, unknown> | undefined;
      if (data) {
        if (typeof data === 'object') {
          parts.push((data.output as string) || '');
          if (data.errorOutput) {
            parts.push(`[stderr] ${data.errorOutput as string}`);
          }
          if (data.exitCode !== undefined && data.exitCode !== 0) {
            parts.push(`[exit code: ${String(data.exitCode)}]`);
          }
          if (data.executionTime !== undefined) {
            parts.push(`(完成耗时: ${String(data.executionTime)}ms)`);
          }
        } else if (typeof data === 'string') {
          parts.push(data as string);
        }
      }

      if (result.output) {
        parts.push(result.output);
      }
      if (result.errorOutput) {
        parts.push(`[stderr] ${result.errorOutput}`);
      }

      const message = parts.join('\n');

      return {
        success: true,
        message: message || '命令执行成功（无输出）',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // 尝试从错误中提取结构化信息
      if (
        errorMsg.includes('stdout') ||
        errorMsg.includes('stderr') ||
        errorMsg.includes('exit code')
      ) {
        return {
          success: false,
          error: errorMsg,
        };
      }
      return {
        success: false,
        error: `命令执行失败: ${errorMsg}`,
      };
    }
  },
};

/**
 * Bash命令
 */
export const bashCommand: Command = {
  type: 'action',
  name: 'bash',
  description: '执行bash命令，支持超时、工作目录和环境变量',
  aliases: ['sh', 'shell'],
  argumentHint: '[--timeout <ms>] [--cwd <path>] [--env <key=value>] <command>',
  whenToUse: '当你需要执行bash命令时',
  getPromptForCommand: (_args: string) =>
    Promise.resolve([
      {
        type: 'text',
        text: [
          '# Bash命令使用指南',
          '',
          '/bash 命令用于执行shell命令，支持以下选项：',
          '',
          '| 选项 | 说明 |',
          '|------|------|',
          '| `--timeout <ms>` | 执行超时时间（默认60000，最大300000） |',
          '| `--cwd <path>` | 指定工作目录 |',
          '| `--env <key=value>` | 设置环境变量（可重复使用） |',
          '',
          '示例：',
          '- `/bash ls -la`',
          '- `/bash --timeout 10000 npm install`',
          '- `/bash --cwd /app --env NODE_ENV=production npm run build`',
        ].join('\n'),
      },
    ]),
  load: async () => bashImplementation,
};

export default bashCommand;
