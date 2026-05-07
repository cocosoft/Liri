/**
 * Edit 命令实现
 * 编辑文件内容（SearchReplace模式）
 * 对标 CC FileEditTool 完整实现
 * 先完整功能映射，再评估修剪
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

interface EditOptions {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
  showJson: boolean;
  dryRun: boolean;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface EditOutput {
  filePath?: string;
  oldString?: string;
  newString?: string;
  originalFile?: string;
  structuredPatch?: Hunk[];
  replaceAll?: boolean;
  gitDiff?: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  };
}

/**
 * 构建帮助文本
 * 对标 CC FileEditTool.prompt()
 */
function buildHelpText(): string {
  return [
    'Edit 命令帮助:',
    '',
    '对文件执行精确的字符串替换编辑。',
    '',
    '用法:',
    '  /edit <file_path> <old_string> <new_string>           替换首个匹配项',
    '  /edit <file_path> <old_string> <new_string> --all     替换所有匹配项',
    '  /edit <file_path> <old_string> <new_string> --dry-run 预览更改',
    '  /edit --json <file_path> <old_string> <new_string>    JSON 格式输出',
    '  /edit help                                            显示此帮助',
    '',
    '参数:',
    '  file_path    文件路径（支持相对路径和绝对路径）',
    '  old_string   要替换的旧文本（必须在文件中唯一出现，除非使用 --all）',
    '  new_string   替换后的新文本（必须与 old_string 不同）',
    '',
    '选项:',
    '  --all / -a      替换所有匹配项（默认只替换第一个）',
    '  --dry-run / -n  预览更改但不实际应用',
    '  --json          以 JSON 格式输出结果',
    '',
    '示例:',
    '  /edit test.txt Hello Hi',
    '  /edit src/app.ts "oldFunction()" "newFunction()"',
    '  /edit config.json "localhost" "127.0.0.1" --all',
    '  /edit package.json "1.0.0" "1.0.1" --dry-run',
    '  /edit data.txt "foo" "bar" --json',
    '',
    '注意:',
    '  最大支持 1 GiB 的文件编辑',
    '  如果文件已被意外修改，请先重新读取再编辑',
  ].join('\n');
}

/**
 * 获取模型提示词（供 AI 理解命令能力）
 * 对标 CC FileEditTool.prompt()
 */
function getPromptForCommand(): string {
  return [
    '- Edit: 对文件执行精确的字符串替换',
    '  - 使用 SearchReplace 模式替换文件中的文本',
    '  - 支持 --all 全局替换所有匹配项',
    '  - 支持 --dry-run 预览更改',
    '  - 要求 old_string 在文件中唯一出现',
    '  - 优先使用该命令编辑现有文件，而非创建新文件',
  ].join('\n');
}

/**
 * 解析编辑参数
 */
function parseEditArgs(args: string): EditOptions {
  const trimmed = args.trim();

  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const replaceAll = /(^|\s)--all(\s|$)/.test(trimmed) || /(^|\s)-a(\s|$)/.test(trimmed);
  const dryRun = /(^|\s)--dry-run(\s|$)/.test(trimmed) || /(^|\s)-n(\s|$)/.test(trimmed);

  const cleaned = trimmed
    .replace(/--json\s*/g, '')
    .replace(/--all\s*/g, '')
    .replace(/\s+-a\b/g, '')
    .replace(/--dry-run\s*/g, '')
    .replace(/\s+-n\b/g, '')
    .trim();

  const parts = cleaned.split(/\s+/);

  if (parts.length < 3) {
    return { showJson, replaceAll, dryRun, filePath: '', oldString: '', newString: '' };
  }

  const filePath = parts[0];
  const oldString = parts[1];
  const newString = parts.slice(2).join(' ');

  return { showJson, replaceAll, dryRun, filePath, oldString, newString };
}

/**
 * 解析编辑输出
 */
function parseEditOutput(data: unknown): EditOutput {
  if (!data || typeof data !== 'object') return {};
  return data as EditOutput;
}

/**
 * 格式化补丁信息
 */
function formatPatch(hunks: Hunk[]): string {
  return hunks.map(h => {
    const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
    return [header, ...h.lines].join('\n');
  }).join('\n');
}

const editCommand = {
  /**
   * 执行 edit 命令
   */
  async execute(args: string, _context: CommandContext): Promise<CommandResult> {
    if (!args.trim() || args.trim().toLowerCase() === 'help') {
      return { success: true, message: buildHelpText() };
    }

    const options = parseEditArgs(args);

    if (!options.filePath) {
      return {
        success: false,
        message: `用法: /edit <file_path> <old_string> <new_string> [--all]\n\n请指定文件路径。\n使用 /edit help 查看帮助。`,
      };
    }

    if (!options.oldString) {
      return {
        success: false,
        message: `用法: /edit <file_path> <old_string> <new_string> [--all]\n\n请指定要替换的旧文本。\n使用 /edit help 查看帮助。`,
      };
    }

    if (!options.newString) {
      return {
        success: false,
        message: `用法: /edit <file_path> <old_string> <new_string> [--all]\n\n请指定替换后的新文本。\n使用 /edit help 查看帮助。`,
      };
    }

    if (options.oldString === options.newString) {
      return {
        success: false,
        message: 'old_string 和 new_string 相同，无需更改。',
      };
    }

    try {
      const { logEvent } = await import('@modules/analytics/index.js');
      logEvent('tengu_edit_command', {
        replaceAll: options.replaceAll,
        dryRun: options.dryRun,
        hasContent: options.newString.length > 0,
      });
    } catch {
      // analytics 非关键
    }

    try {
      const toolManager = getToolManager();
      const result = await toolManager.executeTool(
        'file_edit',
        {
          file_path: options.filePath,
          old_string: options.oldString,
          new_string: options.newString,
          replace_all: options.replaceAll,
          dry_run: options.dryRun,
        },
        { cwd: process.cwd() }
      );

      const output = parseEditOutput(result.data);

      if (!result.success) {
        if (options.showJson) {
          return {
            success: false,
            message: JSON.stringify({
              success: false,
              filePath: options.filePath,
              error: result.error || '编辑失败',
            }, null, 2),
          };
        }
        return {
          success: false,
          message: `编辑失败: ${result.error || '未知错误'}`,
        };
      }

      if (options.showJson) {
        return {
          success: true,
          message: JSON.stringify({
            success: true,
            filePath: options.filePath,
            oldString: options.oldString,
            newString: options.newString,
            replaceAll: options.replaceAll,
            dryRun: options.dryRun,
            structuredPatch: output.structuredPatch,
            gitDiff: output.gitDiff,
            message: options.dryRun
              ? `Dry-run: 预览 ${options.filePath} 的更改`
              : `已成功编辑 ${options.filePath}${options.replaceAll ? ' (已替换所有匹配项)' : ''}`,
          }, null, 2),
        };
      }

      const resultParts: string[] = [];
      const mode = options.replaceAll ? ' (已替换所有匹配项)' : '';

      if (options.dryRun) {
        resultParts.push(`[DRY-RUN] 预览 ${options.filePath} 的更改:`);
        resultParts.push(`  替换: "${options.oldString}" → "${options.newString}"`);
      } else {
        resultParts.push(`已成功编辑 ${options.filePath}${mode}`);
      }

      if (output.structuredPatch && output.structuredPatch.length > 0) {
        resultParts.push('');
        resultParts.push('变更内容:');
        resultParts.push(formatPatch(output.structuredPatch));
      }

      if (output.gitDiff) {
        resultParts.push('');
        resultParts.push(`Git diff: +${output.gitDiff.additions} -${output.gitDiff.deletions} (${output.gitDiff.status})`);
        if (output.gitDiff.patch) {
          resultParts.push('');
          resultParts.push(output.gitDiff.patch);
        }
      }

      return {
        success: true,
        message: resultParts.join('\n'),
      };
    } catch (error) {
      if (options.showJson) {
        return {
          success: false,
          message: JSON.stringify({
            success: false,
            filePath: options.filePath,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        };
      }
      return {
        success: false,
        message: `编辑文件时出错: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  buildHelpText,
  getPromptForCommand,
};

export default editCommand;
