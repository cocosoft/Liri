/**
 * LSP命令
 * 调用LSPTool来执行语言服务器协议操作
 * 对标 CC 源码 cc_code/backend/tools/LSPTool/LSPTool.ts
 */

import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * LSP操作定义：操作名、参数说明、示例
 */
const LSP_OPERATIONS: Record<string, { hint: string; example: string }> = {
  completion:        { hint: '<file> <line> <col>',          example: 'completion src/index.ts 10 5' },
  definition:        { hint: '<file> <line> <col>',          example: 'definition src/index.ts 5 10' },
  references:        { hint: '<file> <line> <col>',          example: 'references src/index.ts 5 10' },
  hover:             { hint: '<file> <line> <col>',          example: 'hover src/index.ts 5 10' },
  goToImplementation: { hint: '<file> <line> <col>',         example: 'goToImplementation src/index.ts 5 10' },
  documentSymbol:    { hint: '<file>',                       example: 'documentSymbol src/index.ts' },
  workspaceSymbol:   { hint: '<query>',                      example: 'workspaceSymbol UserService' },
  prepareCallHierarchy: { hint: '<file> <line> <col>',       example: 'prepareCallHierarchy src/index.ts 5 10' },
  incomingCalls:     { hint: '<file> <line> <col>',          example: 'incomingCalls src/index.ts 5 10' },
  outgoingCalls:     { hint: '<file> <line> <col>',          example: 'outgoingCalls src/index.ts 5 10' },
};

/**
 * 构建帮助文本
 */
function buildHelpText(): string {
  const lines: string[] = [
    `LSP Command Help\n=====================\n`,
    `Usage:\n`,
  ];

  for (const [op, info] of Object.entries(LSP_OPERATIONS)) {
    lines.push(`  /lsp ${op} ${info.hint}`);
  }

  lines.push(
    ``,
    `Note: line and col are 1-based (human-friendly) coordinates.`,
    ``,
    `Examples:\n`,
  );

  for (const info of Object.values(LSP_OPERATIONS)) {
    lines.push(`  /lsp ${info.example}`);
  }

  return lines.join('\n');
}

/**
 * 执行LSP操作（需要文件位置的操作）
 */
async function executeFileBasedOperation(
  toolManager: ReturnType<typeof getToolManager>,
  operation: string,
  file: string,
  line: number,
  col: number,
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!file) {
    return {
      success: false,
      error: `Error: Please specify file path\nUsage: /lsp ${operation} <file> <line> <col>`,
    };
  }

  if (isNaN(line) || isNaN(col)) {
    return {
      success: false,
      error: `Error: line and col must be numbers\nUsage: /lsp ${operation} <file> <line> <col>`,
    };
  }

  try {
    // CC LSPTool 使用 1-based 输入，内部转换为 LSP 的 0-based 协议
    const result = await toolManager.executeTool(
      'lsp',
      {
        action: operation,
        file: file,
        line: line,
        col: col,
      },
      {},
    );

    const count = Array.isArray(result) ? result.length
      : result && typeof result === 'object' && 'resultCount' in result ? (result as any).resultCount
      : 0;

    const summary = count > 0 ? ` (${count} results)` : '';
    return {
      success: true,
      message: `${operation} result:${summary}\n${JSON.stringify(result, null, 2)}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error executing LSP ${operation}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * LSP命令
 */
export const lspCommand: Command = {
  type: 'action',
  name: 'lsp',
  description: '执行语言服务器协议操作（定义跳转、引用查找、悬停提示、代码补全、实现查找、符号搜索、调用层次等）',
  aliases: [],
  argumentHint: '[operation] [args]',
  whenToUse: '当你需要代码智能提示、定义跳转、引用查找、实现查找、文档符号、工作区符号搜索或调用层次分析时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return { success: true, message: buildHelpText() };
      }

      // 文件位置类操作需要 <file> <line> <col>
      const fileBasedOps = new Set([
        'completion', 'definition', 'references', 'hover',
        'goToImplementation', 'prepareCallHierarchy',
        'incomingCalls', 'outgoingCalls',
      ]);

      if (fileBasedOps.has(subcommand)) {
        const file = parts[1];
        const line = parseInt(parts[2], 10);
        const col = parseInt(parts[3], 10);
        return await executeFileBasedOperation(getToolManager(), subcommand, file, line, col);
      }

      // documentSymbol: 需要文件路径
      if (subcommand === 'documentSymbol') {
        const file = parts[1];
        if (!file) {
          return {
            success: false,
            error: 'Error: Please specify file path\nUsage: /lsp documentSymbol <file>',
          };
        }
        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool('lsp', { action: 'documentSymbol', file }, {});
          const count = Array.isArray(result) ? result.length : 0;
          return {
            success: true,
            message: `documentSymbol result (${count} symbols):\n${JSON.stringify(result, null, 2)}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error executing LSP documentSymbol: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      // workspaceSymbol: 需要查询词
      if (subcommand === 'workspaceSymbol') {
        const query = parts.slice(1).join(' ');
        if (!query) {
          return {
            success: false,
            error: 'Error: Please specify search query\nUsage: /lsp workspaceSymbol <query>',
          };
        }
        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool('lsp', { action: 'workspaceSymbol', query }, {});
          const count = Array.isArray(result) ? result.length : 0;
          return {
            success: true,
            message: `workspaceSymbol "${query}" result (${count} symbols):\n${JSON.stringify(result, null, 2)}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error executing LSP workspaceSymbol: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: `Error: Unknown operation: ${subcommand}\n\nUse /lsp help to see all available operations.`,
      };
    },
  }),
};

export default lspCommand;
