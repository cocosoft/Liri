/**
 * Write 命令实现
 * 写入内容到文件
 * 对标 CC FileWriteTool 完整实现
 * 先完整功能映射，再评估修剪
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

interface FileWriteResult {
  type: 'create' | 'update';
  filePath: string;
  sizeBytes: number;
  linesWritten: number;
}

interface WriteOptions {
  showJson: boolean;
  append: boolean;
  filePath: string;
  content: string;
}

/**
 * 构建帮助文本
 * 对标 CC FileWriteTool.prompt()
 */
function buildHelpText(): string {
  return [
    'Write 命令帮助:',
    '',
    '将内容写入到本地文件系统。',
    '',
    '用法:',
    '  /write <file_path> <content>             写入内容到文件（覆盖）',
    '  /write <file_path> <content> --append    追加内容到文件末尾',
    '  /write --json <file_path> <content>      以 JSON 格式输出结果',
    '  /write help                              显示此帮助',
    '',
    '参数:',
    '  file_path  目标文件路径（可包含目录，会自动创建）',
    '  content    要写入的文本内容',
    '',
    '选项:',
    '  --json     以 JSON 格式输出结果',
    '  --append   追加模式，不覆盖现有内容',
    '',
    '示例:',
    '  /write test.txt Hello, world!',
    '  /write src/config.json {"key": "value"}',
    '  /write notes.txt "Another line" --append',
    '  /write output.txt "Line 1" --append --json',
    '',
    '注意:',
    '  如果文件已存在，写入前请先读取文件内容确认',
    '  优先使用 /edit 命令编辑现有文件，避免不必要的新建文件',
  ].join('\n');
}

/**
 * 获取模型提示词（供 AI 理解命令能力）
 * 对标 CC FileWriteTool.prompt()
 */
function getPromptForCommand(): string {
  return [
    '- Write: 将内容写入文件',
    '  - 支持覆盖写入和追加模式（--append）',
    '  - 自动创建不存在的目录',
    '  - 返回 create/update 类型、文件大小、行数',
    '  - 如果是现有文件，必须先读取再写入',
    '  - 优先使用 Edit 编辑现有文件，而非 Write 新建文件',
  ].join('\n');
}

/**
 * 解析参数
 */
function parseFlags(args: string): WriteOptions {
  const trimmed = args.trim();
  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const append = /(^|\s)--append(\s|$)/.test(trimmed);
  const cleaned = trimmed
    .replace(/--json\s*/g, '')
    .replace(/--append\s*/g, '')
    .trim();

  const firstSpace = cleaned.indexOf(' ');
  if (firstSpace === -1) {
    return { showJson, append, filePath: '', content: '' };
  }

  const filePath = cleaned.substring(0, firstSpace);
  const content = cleaned.substring(firstSpace + 1);

  return { showJson, append, filePath, content };
}

/**
 * 解析写入工具输出
 */
function parseWriteOutput(data: unknown): FileWriteResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (
    d.type &&
    (d.type === 'create' || d.type === 'update') &&
    typeof d.filePath === 'string'
  ) {
    return {
      type: d.type as 'create' | 'update',
      filePath: d.filePath as string,
      sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : 0,
      linesWritten: typeof d.linesWritten === 'number' ? d.linesWritten : 0,
    };
  }
  return null;
}

const writeCommand = {
  /**
   * 执行 write 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    if (!args.trim() || args.trim().toLowerCase() === 'help') {
      return { success: true, message: buildHelpText() };
    }

    const options = parseFlags(args);

    try {
      const { logEvent } = await import('@modules/analytics/index.js');
      logEvent('tengu_write_command', {
        append: options.append,
        hasContent: options.content.length > 0,
      });
    } catch {
      // analytics 非关键
    }

    if (!options.filePath) {
      return {
        success: false,
        message: `用法: /write <file_path> <content>\n\n请指定要写入的文件路径和内容。\n使用 /write help 查看帮助。`,
      };
    }

    if (!options.content) {
      return {
        success: false,
        message: `用法: /write <file_path> <content>\n\n请指定要写入的内容。\n使用 /write help 查看帮助。`,
      };
    }

    try {
      const toolManager = getToolManager();
      const result = await toolManager.executeTool(
        'file_write',
        {
          file_path: options.filePath,
          content: options.content,
          append: options.append,
        },
        {}
      );

      const writeResult = parseWriteOutput(result.data);

      if (options.showJson) {
        const jsonOutput: Record<string, unknown> = {
          success: result.success,
          filePath: options.filePath,
          mode: options.append ? 'append' : 'write',
          error: result.error || null,
        };
        if (writeResult) {
          jsonOutput.type = writeResult.type;
          jsonOutput.sizeBytes = writeResult.sizeBytes;
          jsonOutput.linesWritten = writeResult.linesWritten;
        }
        return {
          success: result.success,
          message: JSON.stringify(jsonOutput, null, 2),
        };
      }

      if (!result.success) {
        return {
          success: false,
          message: `写入失败: ${result.error || '未知错误'}`,
        };
      }

      const modeText = options.append ? '已追加到' : '已写入';

      if (writeResult) {
        const typeText =
          writeResult.type === 'create' ? '新建文件' : '更新文件';
        return {
          success: true,
          message: `${modeText} ${options.filePath} (${typeText}, ${writeResult.linesWritten} 行, ${writeResult.sizeBytes} 字节)`,
        };
      }

      return {
        success: true,
        message: `${modeText} ${options.filePath}`,
      };
    } catch (error) {
      if (options.showJson) {
        return {
          success: false,
          message: JSON.stringify(
            {
              success: false,
              filePath: options.filePath,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          ),
        };
      }
      return {
        success: false,
        message: `写入文件时出错: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  buildHelpText,
  getPromptForCommand,
};

export default writeCommand;
