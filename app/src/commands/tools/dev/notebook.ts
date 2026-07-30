/**
 * Notebook命令
 * 调用NotebookToolAdapter来创建、编辑和管理Jupyter笔记本
 * 对标 CC 源码 reference/cc_code/tools/NotebookEditTool.ts
 */

import type { Command } from '@modules/commands';
import { getToolManager } from '@modules/tools/ToolManager.js';
import { feature } from '@modules/core/featureFlags.js';
import { notebookManager } from '@modules/tools/notebook/NotebookManager.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:tools:dev:notebook',
  level: LogLevel.INFO,
});

const SUBCOMMANDS = new Set([
  'create',
  'open',
  'save',
  'add-code',
  'add-md',
  'execute',
  'export',
  'list',
  'read',
  'help',
]);

/** 兼容旧命令名映射 */
const ALIAS_MAP: Record<string, { action: string; hint: string }> = {
  add: { action: 'add-code', hint: '使用 add-code 或 add-md 替代 add' },
  run: { action: 'execute', hint: '使用 execute 替代 run' },
  replace: { action: 'open', hint: '编辑单元格请使用 open + add-code/add-md' },
  insert: { action: 'open', hint: '插入单元格请使用 open + add-code/add-md' },
  delete: { action: 'open', hint: '删除操作暂不支持，请使用 open + 手动编辑' },
};

function hasJsonFlag(args: string): boolean {
  return /--json|-j\b/.test(args);
}

function stripFlags(args: string): string {
  return args.replace(/--json|-j\b/g, '').trim();
}

/**
 * 调用 NotebookToolAdapter
 */
async function callAdapter(
  action: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const toolManager = getToolManager();
    const result = await toolManager.executeTool(
      'notebook',
      { action, ...params },
      {}
    );

    if (result.success === false) {
      return { success: false, error: result.error || '操作失败' };
    }

    const output =
      result.output ||
      ((result.data as Record<string, unknown>)?.message as string) ||
      '';
    return { success: true, message: output };
  } catch (error) {
    return {
      success: false,
      error: `Notebook 操作失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 list 子命令（直接访问 NotebookManager）
 */
function handleList(): { success: boolean; message?: string; error?: string } {
  try {
    const notebooks = notebookManager.getNotebooks();
    if (notebooks.length === 0) {
      return { success: true, message: '当前没有打开的 Notebook' };
    }
    const lines = notebooks.map(
      (nb, i) =>
        `  ${i + 1}. ${nb.name} (ID: ${nb.id})${nb.path ? ` | ${nb.path}` : ''} | 单元格: ${nb.cells.length}`
    );
    return {
      success: true,
      message: `Notebook 列表 (${notebooks.length} 个):\n${lines.join('\n')}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `获取列表失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 read 子命令
 */
function handleRead(idOrPath: string): {
  success: boolean;
  message?: string;
  error?: string;
} {
  try {
    let notebook = notebookManager.getNotebook(idOrPath);
    if (!notebook) {
      try {
        notebook = notebookManager.openNotebook(idOrPath);
      } catch {
        return { success: false, error: `Notebook 未找到: ${idOrPath}` };
      }
    }
    const lines: string[] = [
      `Notebook: ${notebook.name}`,
      `  ID: ${notebook.id}`,
      `  路径: ${notebook.path || '(未保存)'}`,
      `  版本: ${notebook.version}`,
      `  单元格数: ${notebook.cells.length}`,
      `  创建时间: ${notebook.createdAt.toISOString()}`,
      `  更新时间: ${notebook.updatedAt.toISOString()}`,
      '',
    ];
    notebook.cells.forEach((cell, i) => {
      const icon = cell.type === 'code' ? '[▶]' : '[📝]';
      lines.push(`${icon} 单元格 ${i + 1} (ID: ${cell.id})`);
      if (cell.type === 'code') {
        const codeCell = cell as any;
        lines.push(`  语言: ${codeCell.language || 'python'}`);
        const preview = (codeCell.code || '')
          .substring(0, 120)
          .replace(/\n/g, '↵');
        lines.push(
          `  代码: ${preview}${(codeCell.code || '').length > 120 ? '…' : ''}`
        );
      } else {
        const mdCell = cell as unknown as { content?: string };
        const preview = (mdCell.content || '')
          .substring(0, 120)
          .replace(/\n/g, '↵');
        lines.push(
          `  内容: ${preview}${(mdCell.content || '').length > 120 ? '…' : ''}`
        );
      }
      lines.push('');
    });
    return { success: true, message: lines.join('\n') };
  } catch (error) {
    return {
      success: false,
      error: `读取失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 构建帮助文本（CC风格）
 */
function buildHelpText(): string {
  return [
    'Notebook Command Help',
    '========================',
    '',
    'Usage:',
    '  /notebook create <name>                    - 创建新 Notebook',
    '  /notebook open <path>                      - 从 .ipynb 文件打开',
    '  /notebook save <id>                        - 保存 Notebook 到磁盘',
    '  /notebook add-code <id> <code> [lang]      - 添加代码单元格',
    '  /notebook add-md <id> <content>            - 添加 Markdown 单元格',
    '  /notebook execute <cellId>                 - 执行代码单元格',
    '  /notebook export <id> <format>             - 导出 (html|pdf|markdown)',
    '  /notebook list                             - 列出所有打开的 Notebook',
    '  /notebook read <id|path>                   - 查看 Notebook 内容',
    '  /notebook help                             - 显示此帮助',
    '',
    'Options:',
    '  --json, -j   以 JSON 格式输出',
    '',
    'Supported Operations:',
    '  create     创建新的 Notebook 实例',
    '  open       从 .ipynb 文件加载 Notebook',
    '  save       将 Notebook 保存到文件系统',
    '  add-code   在 Notebook 末尾添加代码单元格',
    '  add-md     在 Notebook 末尾添加 Markdown 单元格',
    '  execute    执行指定代码单元格（通过 REPL）',
    '  export     导出为 HTML / PDF / Markdown',
    '  list       显示所有打开的 Notebook',
    '  read       显示 Notebook 的结构和内容预览',
    '',
    'Cell ID Format:',
    '  单元格 ID 格式为 cell-{timestamp}-{random}（如 cell-1700000000-a1b2c3d4e）',
    '  可通过 /notebook read <id> 查看所有单元格的 ID',
    '',
    'Examples:',
    '  /notebook create "数据分析"',
    '  /notebook open ./my_notebook.ipynb',
    '  /notebook add-code <notebookId> "print(\\"hello\\")" python',
    '  /notebook add-md <notebookId> "# Section 1\\nThis is markdown"',
    '  /notebook execute <cellId>',
    '  /notebook export <notebookId> markdown',
    '  /notebook list',
    '  /notebook list --json',
    '  /notebook read <notebookId>',
    '',
    'Scenarios:',
    '  • 数据探索: create "EDA" → add-code <id> "import pandas as pd" python → add-md <id> "## 数据概况"',
    '  • 快速原型: open prototype.ipynb → execute <cellId> → 查看输出结果',
    '  • 报告生成: create "报告" → add-md <id> "# 分析结论" → export <id> html',
    '  • 批量执行: open notebook.ipynb → 按顺序 execute 各个代码单元格',
    '  • 代码迁移: open legacy.ipynb → read → add-code <id> "重构代码" python → save <id>',
    '',
    'Best Practices:',
    '  1. 创建后先用 add-md 添加说明单元格，再添加代码单元格',
    '  2. 执行前使用 read 确认单元格内容',
    '  3. 导出时 markdown 格式最通用，html 格式保留样式',
    '  4. 使用有意义的 Notebook 名称便于管理',
    '  5. 定期 save 避免数据丢失',
    '  6. 执行代码单元格前确保依赖环境已安装',
  ].join('\n');
}

/**
 * 获取模型提示词
 */
function getPromptForCommand(): string {
  return [
    '- Notebook: 创建、编辑和管理 Jupyter 笔记本',
    '  - create <name>: 创建新 Notebook',
    '  - open <path>: 从 .ipynb 文件加载',
    '  - save <id>: 保存到磁盘',
    '  - add-code <id> <code> [lang]: 添加代码单元格',
    '  - add-md <id> <content>: 添加 Markdown 单元格',
    '  - execute <cellId>: 执行代码单元格（通过 REPL）',
    '  - export <id> <format>: 导出为 html/pdf/markdown',
    '  - list: 列出所有打开的 Notebook',
    '  - read <id|path>: 查看 Notebook 内容结构',
  ].join('\n');
}

/**
 * Notebook命令
 */
export const notebookCommand: Command = {
  type: 'action',
  name: 'notebook',
  description:
    '创建、编辑和管理Jupyter笔记本（create/open/save/add-code/add-md/execute/export/list/read）',
  aliases: [],
  argumentHint:
    '[create|open|save|add-code|add-md|execute|export|list|read|help] [args]',
  whenToUse:
    '当你需要创建、编辑或管理Jupyter笔记本时，例如创建数据分析Notebook、添加代码单元格、执行代码、导出为不同格式',

  load: async () => ({
    execute: async (
      args: string
    ): Promise<{
      success: boolean;
      message?: string;
      error?: string;
      data?: unknown;
    }> => {
      if (!feature('NOTEBOOK')) {
        return {
          success: false,
          error:
            'Notebook 功能未启用。请在 featureFlags.ts 中设置 NOTEBOOK: true',
        };
      }

      const isJson = hasJsonFlag(args);
      const cleanArgs = stripFlags(args);
      const parts = cleanArgs.split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return { success: true, message: buildHelpText() };
      }

      // 处理旧命令别名
      if (ALIAS_MAP[subcommand]) {
        const { action, hint } = ALIAS_MAP[subcommand];
        return {
          success: false,
          error: `不支持的子命令 "${subcommand}" — ${hint}\n使用 /notebook help 查看支持的命令`,
        };
      }

      if (!SUBCOMMANDS.has(subcommand)) {
        return {
          success: false,
          error: `未知子命令: ${subcommand}\n使用 /notebook help 查看支持的命令`,
        };
      }

      let result:
        | { success: boolean; message?: string; error?: string }
        | undefined;

      switch (subcommand) {
        case 'create': {
          const name = parts.slice(1).join(' ');
          if (!name) {
            return {
              success: false,
              error: '请指定 Notebook 名称\n用法: /notebook create <name>',
            };
          }
          result = await callAdapter('create', { name });
          break;
        }

        case 'open': {
          const path = parts[1];
          if (!path) {
            return {
              success: false,
              error: '请指定 Notebook 路径\n用法: /notebook open <path>',
            };
          }
          result = await callAdapter('open', { path });
          break;
        }

        case 'save': {
          const id = parts[1];
          if (!id) {
            return {
              success: false,
              error: '请指定 Notebook ID\n用法: /notebook save <id>',
            };
          }
          result = await callAdapter('save', { notebookId: id });
          break;
        }

        case 'add-code': {
          const id = parts[1];
          const code = parts.slice(2).join(' ');
          const langIndex = code.lastIndexOf(' ');
          const language =
            langIndex > 0 ? code.substring(langIndex + 1).trim() : 'python';
          const codeContent =
            langIndex > 0 ? code.substring(0, langIndex).trim() : code;

          if (!id || !codeContent) {
            return {
              success: false,
              error:
                '请指定 Notebook ID 和代码内容\n用法: /notebook add-code <id> <code> [language]',
            };
          }
          result = await callAdapter('addCodeCell', {
            notebookId: id,
            code: codeContent,
            language,
          });
          break;
        }

        case 'add-md': {
          const id = parts[1];
          const content = parts.slice(2).join(' ');
          if (!id || !content) {
            return {
              success: false,
              error:
                '请指定 Notebook ID 和 Markdown 内容\n用法: /notebook add-md <id> <content>',
            };
          }
          result = await callAdapter('addMarkdownCell', {
            notebookId: id,
            content,
          });
          break;
        }

        case 'execute': {
          const cellId = parts[1];
          if (!cellId) {
            return {
              success: false,
              error: '请指定 Cell ID\n用法: /notebook execute <cellId>',
            };
          }
          result = await callAdapter('executeCell', { cellId });
          break;
        }

        case 'export': {
          const id = parts[1];
          const format = parts[2];
          if (!id || !format) {
            return {
              success: false,
              error:
                '请指定 Notebook ID 和导出格式\n用法: /notebook export <id> <format>',
            };
          }
          if (!['html', 'pdf', 'markdown'].includes(format)) {
            return {
              success: false,
              error: `不支持的导出格式: ${format}（支持: html, pdf, markdown）`,
            };
          }
          result = await callAdapter('export', { notebookId: id, format });
          break;
        }

        case 'list': {
          result = handleList();
          break;
        }

        case 'read': {
          const idOrPath = parts.slice(1).join(' ');
          if (!idOrPath) {
            return {
              success: false,
              error:
                '请指定 Notebook ID 或路径\n用法: /notebook read <id|path>',
            };
          }
          result = handleRead(idOrPath);
          break;
        }
      }

      if (!result) {
        return {
          success: false,
          error: `内部错误: 未处理的子命令 "${subcommand}"`,
        };
      }

      if (isJson) {
        return {
          success: result.success,
          data: {
            subcommand,
            message: result.message,
            error: result.error,
          },
        };
      }

      return result;
    },
  }),
};

export { buildHelpText, getPromptForCommand };

export default notebookCommand;
