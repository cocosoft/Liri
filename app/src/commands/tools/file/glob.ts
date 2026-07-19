/**
 * Glob 命令实现
 * 匹配文件路径（Glob模式）
 * 对标 CC GlobTool 完整实现
 * 先完整功能映射，再评估修剪
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { getToolManager } from '@modules/tools/ToolManager.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:tools:file:glob',
  level: LogLevel.INFO,
});

interface GlobOptions {
  pattern: string;
  path?: string;
  showJson: boolean;
}

interface GlobOutput {
  durationMs: number;
  numFiles: number;
  filenames: string[];
  truncated: boolean;
}

/**
 * 构建帮助文本
 * 对标 CC GlobTool prompt.ts DESCRIPTION
 */
function buildHelpText(): string {
  return [
    'Glob 命令帮助:',
    '',
    '快速文件模式匹配工具，适用于任何规模的代码库。',
    '',
    '用法:',
    '  /glob <pattern>                            匹配文件路径',
    '  /glob <pattern> --path <dir>               在指定目录下搜索',
    '  /glob <pattern> --json                     以 JSON 格式输出',
    '  /glob help                                 显示此帮助',
    '',
    '参数:',
    '  pattern   Glob 模式，支持通配符',
    '',
    '选项:',
    '  --path <dir>   指定搜索目录（默认：当前工作目录）',
    '  --json         以 JSON 格式输出结果',
    '',
    'Glob 模式说明:',
    '  *       匹配任意字符（不包括路径分隔符）',
    '  **      匹配任意字符（包括路径分隔符，可跨目录）',
    '  ?       匹配单个字符',
    '  [abc]   匹配字符集中的任意一个',
    '  [!abc]  匹配不在字符集中的任意字符',
    '  {a,b}   匹配 a 或 b 两种模式',
    '',
    '示例:',
    '  /glob *.ts',
    '  /glob src/**/*.js',
    '  /glob **/*.{ts,tsx}',
    '  /glob **/*.json --json',
    '  /glob **/*.ts --path src',
    '  /glob tests/**/*.spec.ts',
    '',
    '注意:',
    '  搜索结果限制为 100 条，超过会提示截断',
    '  自动跳过以 "." 开头的隐藏文件和目录',
    '  返回的路径相对于当前工作目录',
  ].join('\n');
}

/**
 * 获取模型提示词（供 AI 理解命令能力）
 * 对标 CC GlobTool.prompt()
 */
function getPromptForCommand(): string {
  return [
    '- Glob: 快速文件模式匹配工具，适用于任何规模的代码库',
    '  - 支持 glob 模式，如 "**/*.js" 或 "src/**/*.ts"',
    '  - 支持指定搜索目录（--path）',
    '  - 返回排序后的文件路径列表',
    '  - 使用此命令查找名称模式匹配的文件',
  ].join('\n');
}

/**
 * 解析参数
 */
function parseGlobArgs(args: string): GlobOptions {
  const trimmed = args.trim();

  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);

  const pathMatch = trimmed.match(/(^|\s)--path\s+(\S+)/);
  const path = pathMatch ? pathMatch[2] : undefined;

  const cleaned = trimmed
    .replace(/--json\s*/g, '')
    .replace(/(^|\s)--path\s+\S+/g, '')
    .trim();

  return { pattern: cleaned, path, showJson };
}

/**
 * 解析工具层输出为 GlobOutput
 */
function parseGlobOutput(data: unknown): GlobOutput | null {
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.filenames)) {
    return {
      durationMs: typeof obj.durationMs === 'number' ? obj.durationMs : 0,
      numFiles:
        typeof obj.numFiles === 'number' ? obj.numFiles : obj.filenames.length,
      filenames: obj.filenames as string[],
      truncated: typeof obj.truncated === 'boolean' ? obj.truncated : false,
    };
  }

  if (Array.isArray(data)) {
    const files = data as string[];
    return {
      durationMs: 0,
      numFiles: files.length,
      filenames: files,
      truncated: files.length >= 100,
    };
  }

  return null;
}

const globCommand = {
  /**
   * 执行 glob 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    if (!args.trim() || args.trim().toLowerCase() === 'help') {
      return { success: true, message: buildHelpText() };
    }

    const options = parseGlobArgs(args);

    if (!options.pattern) {
      return {
        success: false,
        message: `用法: /glob <pattern>\n\n请指定要匹配的 Glob 模式。\n使用 /glob help 查看帮助。`,
      };
    }

    try {
      const { logEvent } = await import('@modules/analytics/index.js');
      logEvent('tengu_glob_command', {
        pattern: options.pattern,
        path: options.path,
      });
    } catch (err) {
      // analytics 非关键

      logger.debug('Operation skipped', {
        context: 'analytics 非关键',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const toolManager = getToolManager();
      const input: Record<string, unknown> = { pattern: options.pattern };
      if (options.path) {
        input.path = options.path;
      }
      const result = await toolManager.executeTool('glob', input, {
        cwd: process.cwd(),
      });

      const output = parseGlobOutput(result.data);

      if (!result.success) {
        if (options.showJson) {
          return {
            success: false,
            message: JSON.stringify(
              {
                success: false,
                pattern: options.pattern,
                path: options.path,
                error: result.error || '匹配失败',
              },
              null,
              2
            ),
          };
        }
        return {
          success: false,
          message: `匹配失败: ${result.error || '未知错误'}`,
        };
      }

      if (!output || output.filenames.length === 0) {
        if (options.showJson) {
          return {
            success: true,
            message: JSON.stringify(
              {
                success: true,
                pattern: options.pattern,
                path: options.path,
                count: 0,
                files: [],
                durationMs: 0,
                truncated: false,
              },
              null,
              2
            ),
          };
        }
        const pathInfo = options.path ? ` (目录: ${options.path})` : '';
        return {
          success: true,
          message: `未找到匹配模式 "${options.pattern}"${pathInfo} 的文件`,
        };
      }

      if (options.showJson) {
        return {
          success: true,
          message: JSON.stringify(
            {
              success: true,
              pattern: options.pattern,
              path: options.path,
              count: output.numFiles,
              files: output.filenames,
              durationMs: output.durationMs,
              truncated: output.truncated,
            },
            null,
            2
          ),
        };
      }

      const resultLines: string[] = [];
      if (output.durationMs > 0) {
        resultLines.push(
          `找到 ${output.numFiles} 个文件 (${output.durationMs}ms):`
        );
      } else {
        resultLines.push(`找到 ${output.numFiles} 个文件:`);
      }
      resultLines.push('---');
      resultLines.push(output.filenames.join('\n'));

      if (output.truncated) {
        resultLines.push('');
        resultLines.push(
          '(结果已截断。请考虑使用更精确的模式或指定搜索目录。)'
        );
      }

      return {
        success: true,
        message: resultLines.join('\n'),
      };
    } catch (error) {
      if (options.showJson) {
        return {
          success: false,
          message: JSON.stringify(
            {
              success: false,
              pattern: options.pattern,
              path: options.path,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          ),
        };
      }
      return {
        success: false,
        message: `匹配文件时出错: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 构建帮助文本
   * 对标 CC GlobTool.prompt()
   */
  buildHelpText,

  /**
   * 获取模型提示词
   * 对标 CC GlobTool.prompt() DESCRIPTION
   */
  getPromptForCommand,
};

export default globCommand;
