/**
 * Notebook命令
 * 调用NotebookTool来编辑Jupyter笔记本
 * 对标 CC 源码 cc_code/backend/tools/NotebookEditTool/NotebookEditTool.ts
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * 构建帮助文本
 */
function buildHelpText(): string {
  return [
    `Notebook Command Help\n========================\n`,
    `Usage:\n`,
    `  /notebook create <name>                     - Create a new notebook`,
    `  /notebook open <path>                       - Open an existing notebook`,
    `  /notebook add <cell_type> <content>         - Add a cell to notebook`,
    `  /notebook run <path>                        - Run a notebook`,
    `  /notebook save <path>                       - Save a notebook`,
    `  /notebook replace <path> <cell_id> <source> - Replace a cell's source`,
    `  /notebook insert <path> <cell_id> <type> <source> - Insert a new cell`,
    `  /notebook delete <path> <cell_id>           - Delete a cell`,
    ``,
    `Parameters:`,
    `  <cell_type>  - 'code' or 'markdown'`,
    `  <cell_id>    - Cell ID (e.g. 'cell_xxx') or 0-based index (e.g. 'cell-0')`,
    `  <source>     - New source code/content for the cell`,
    ``,
    `Note: cell_id supports both actual cell UUID and 0-based index format (cell-N).`,
    ``,
    `Examples:\n`,
    `  /notebook create "My Notebook"`,
    `  /notebook open notebook.ipynb`,
    `  /notebook add code "print('Hello')"`,
    `  /notebook replace notebook.ipynb cell-0 "print('Modified')"`,
    `  /notebook insert notebook.ipynb cell-0 markdown "## New Section"`,
    `  /notebook delete notebook.ipynb cell-2`,
  ].join('\n');
}

/**
 * 执行Notebook工具调用
 */
async function executeNotebookAction(
  action: string,
  params: Record<string, any>,
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const toolManager = getToolManager();
    const result = await toolManager.executeTool('notebook', { action, ...params }, {});

    return {
      success: true,
      message: result.message || result.path
        ? `Notebook ${action}成功: ${result.path || result.message || ''}`
        : `Notebook ${action}成功`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error executing notebook ${action}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 解析 cell_id: 支持 cell-0 (0-based index) 格式或 UUID 格式
 */
function parseCellId(cellId: string): number | undefined {
  const match = cellId.match(/^cell-(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  // UUID格式（如 a1b2c3d4-e5f6-...）返回 undefined，交给后端处理
  return undefined;
}

/**
 * Notebook命令
 */
export const notebookCommand: Command = {
  type: 'action',
  name: 'notebook',
  description: '编辑Jupyter笔记本（创建/打开/添加/编辑/删除/运行/保存）',
  aliases: [],
  argumentHint: '[create|open|add|replace|insert|delete|run|save|help] [args]',
  whenToUse: '当你需要创建、编辑或运行Jupyter笔记本时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return { success: true, message: buildHelpText() };
      }

      // create <name>
      if (subcommand === 'create') {
        const name = parts.slice(1).join(' ');
        if (!name) {
          return {
            success: false,
            error: 'Error: Please specify notebook name\nUsage: /notebook create <name>',
          };
        }
        return await executeNotebookAction('create', { name });
      }

      // open <path>
      if (subcommand === 'open') {
        const path = parts[1];
        if (!path) {
          return {
            success: false,
            error: 'Error: Please specify notebook path\nUsage: /notebook open <path>',
          };
        }
        return await executeNotebookAction('open', { path });
      }

      // add <cell_type> <content>
      if (subcommand === 'add') {
        const cellType = parts[1];
        const content = parts.slice(2).join(' ');
        if (!cellType || !content) {
          return {
            success: false,
            error: 'Error: Please specify cell type and content\nUsage: /notebook add <cell_type> <content>',
          };
        }
        return await executeNotebookAction('add', { cell_type: cellType, content });
      }

      // replace <path> <cell_id> <source>
      if (subcommand === 'replace') {
        const path = parts[1];
        const cellId = parts[2];
        const source = parts.slice(3).join(' ');

        if (!path || !cellId || !source) {
          return {
            success: false,
            error: 'Error: Please specify path, cell_id and source\nUsage: /notebook replace <path> <cell_id> <source>',
          };
        }

        const params: Record<string, any> = {
          notebook_path: path,
          cell_id: cellId,
          new_source: source,
          edit_mode: 'replace',
        };

        // 如果是 cell-N 格式，转换为 cell_number
        const cellIndex = parseCellId(cellId);
        if (cellIndex !== undefined) {
          params.cell_number = cellIndex;
          delete params.cell_id;
        }

        return await executeNotebookAction('replace', params);
      }

      // insert <path> <cell_id> <cell_type> <source>
      if (subcommand === 'insert') {
        const path = parts[1];
        const cellId = parts[2];
        const cellType = parts[3];
        const source = parts.slice(4).join(' ');

        if (!path || !cellId || !source) {
          return {
            success: false,
            error: 'Error: Please specify path, cell_id, cell_type and source\nUsage: /notebook insert <path> <cell_id> <type> <source>',
          };
        }

        const params: Record<string, any> = {
          notebook_path: path,
          cell_id: cellId,
          new_source: source,
          edit_mode: 'insert',
          cell_type: cellType || 'code',
        };

        const cellIndex = parseCellId(cellId);
        if (cellIndex !== undefined) {
          params.cell_number = cellIndex;
          delete params.cell_id;
        }

        return await executeNotebookAction('insert', params);
      }

      // delete <path> <cell_id>
      if (subcommand === 'delete') {
        const path = parts[1];
        const cellId = parts[2];

        if (!path || !cellId) {
          return {
            success: false,
            error: 'Error: Please specify path and cell_id\nUsage: /notebook delete <path> <cell_id>',
          };
        }

        const params: Record<string, any> = {
          notebook_path: path,
          cell_id: cellId,
          edit_mode: 'delete',
        };

        const cellIndex = parseCellId(cellId);
        if (cellIndex !== undefined) {
          params.cell_number = cellIndex;
          delete params.cell_id;
        }

        return await executeNotebookAction('delete', params);
      }

      // run <path>
      if (subcommand === 'run') {
        const path = parts[1];
        if (!path) {
          return {
            success: false,
            error: 'Error: Please specify notebook path\nUsage: /notebook run <path>',
          };
        }
        return await executeNotebookAction('run', { path });
      }

      // save <path>
      if (subcommand === 'save') {
        const path = parts[1];
        if (!path) {
          return {
            success: false,
            error: 'Error: Please specify notebook path\nUsage: /notebook save <path>',
          };
        }
        return await executeNotebookAction('save', { path });
      }

      return {
        success: false,
        error: `Error: Unknown subcommand: ${subcommand}\n\nUse /notebook help for help`,
      };
    },
  }),
};

export default notebookCommand;
