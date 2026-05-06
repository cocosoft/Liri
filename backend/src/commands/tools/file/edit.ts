/**
 * 文件编辑命令
 * 基于CC源码 cc_code/backend/tools/FileEditTool 优化实现
 */
import type { Command } from '../../types/index.js';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * 编辑文件命令
 */
export const editCommand: Command = {
  type: 'action',
  name: 'edit',
  description: '编辑文件内容（SearchReplace模式）',
  aliases: [],
  argumentHint: '<file_path> <old_string> <new_string> [-a]',
  whenToUse: '当你需要编辑文件内容时，使用 old_string 定位并替换为新内容',
  load: async () => ({
    execute: async (args: string) => {
      const trimmed = args.trim();

      if (!trimmed) {
        return {
          success: false,
          error: `Usage: /edit <file_path> <old_string> <new_string> [-a]\n\n` +
            `Edit a file by replacing old_string with new_string (SearchReplace模式).\n\n` +
            `参数:\n` +
            `  file_path   文件路径\n` +
            `  old_string  要替换的旧文本（首个匹配，请确保唯一性）\n` +
            `  new_string  替换后的新文本\n` +
            `  -a, --all   替换所有匹配项（可选）\n\n` +
            `示例:\n` +
            `  /edit test.txt Hello Hi\n` +
            `  /edit src/app.ts "oldFunction()" "newFunction()"\n` +
            `  /edit config.json "localhost" "127.0.0.1" -a`,
        };
      }

      // 检测 -a / --all 标志
      const useReplaceAll = /\s+-a\b/.test(trimmed) || /\s+--all\b/.test(trimmed);
      const cleanArgs = useReplaceAll
        ? trimmed.replace(/\s+-a\b/, '').replace(/\s+--all\b/, '')
        : trimmed;

      const parts = cleanArgs.split(/\s+/);

      if (parts.length < 3) {
        return {
          success: false,
          error: `参数不足。用法: /edit <file_path> <old_string> <new_string> [-a]\n\n` +
            `示例:\n` +
            `  /edit test.txt Hello Hi\n` +
            `  /edit src/app.ts oldFunc newFunc\n` +
            `  /edit config.json localhost 127.0.0.1 -a`,
        };
      }

      const filePath = parts[0];
      const oldString = parts[1];
      const newString = parts.slice(2).join(' ');

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'file_edit',
          {
            file_path: filePath,
            old_string: oldString,
            new_string: newString,
            replace_all: useReplaceAll,
          },
          { cwd: process.cwd() }
        );

        if (!result.success) {
          return {
            success: false,
            error: `编辑失败: ${result.error || '未知错误'}`,
          };
        }

        const replaceNote = useReplaceAll ? ' (已替换所有匹配项)' : '';
        return {
          success: true,
          message: `Successfully edited ${filePath}${replaceNote}`,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error editing file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default editCommand;
