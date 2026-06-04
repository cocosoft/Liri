/**
 * LSP命令
 * 调用LSPTool适配器来执行语言服务器协议操作
 */

import { readFileSync, existsSync } from 'fs';
import { extname, resolve } from 'path';
import { resolveProjectRoot } from '@modules/core/paths';
import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';
import { feature } from '@modules/core/featureFlags.js';

/**
 * 文件扩展名到语言的映射
 */
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
};

/**
 * 用户可见操作名 → 适配器 action 名
 */
const OPERATION_MAP: Record<string, string> = {
  definition: 'definition',
  references: 'references',
  hover: 'hover',
  completion: 'completions',
  documentSymbol: 'documentSymbol',
  workspaceSymbol: 'workspaceSymbol',
  implementation: 'implementation',
  callHierarchy: 'callHierarchy',
  diagnostics: 'diagnostics',
  format: 'format',
  rename: 'rename',
  typeDefinition: 'typeDefinition',
};

/**
 * 需要文件位置的类操作（需 file + line + col）
 */
const FILE_POSITION_OPS = new Set([
  'definition',
  'references',
  'hover',
  'completion',
  'implementation',
  'callHierarchy',
  'rename',
  'typeDefinition',
]);

/**
 * 仅需文件路径的操作
 */
const FILE_ONLY_OPS = new Set(['documentSymbol', 'diagnostics', 'format']);

/**
 * 需要查询词的操作
 */
const QUERY_OPS = new Set(['workspaceSymbol']);

/**
 * 语言检测
 */
function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || 'typescript';
}

function hasJsonFlag(parts: string[]): boolean {
  return parts.includes('--json') || parts.includes('-j');
}

function stripFlags(parts: string[]): string[] {
  return parts.filter((p) => !p.startsWith('-'));
}

function getPromptForCommand(): string {
  return [
    '- LSP: 执行语言服务器协议操作，提供代码智能功能',
    '  - 定义跳转: /lsp definition <file> <line> <col>',
    '  - 引用查找: /lsp references <file> <line> <col>',
    '  - 悬停提示: /lsp hover <file> <line> <col>',
    '  - 代码补全: /lsp completion <file> <line> <col>',
    '  - 实现查找: /lsp implementation <file> <line> <col>',
    '  - 类型定义: /lsp typeDefinition <file> <line> <col>',
    '  - 调用层次: /lsp callHierarchy <file> <line> <col>',
    '  - 符号重命名: /lsp rename <file> <line> <col> <newName>',
    '  - 文档符号: /lsp documentSymbol <file>',
    '  - 代码诊断: /lsp diagnostics <file>',
    '  - 格式化: /lsp format <file>',
    '  - 符号搜索: /lsp workspaceSymbol <query>',
    '  - 输出格式: 添加 --json 或 -j 获取JSON格式输出',
    '  - 使用 1-based 行/列坐标',
  ].join('\n');
}

/**
 * 构建帮助文本（CC风格）
 */
function buildHelpText(): string {
  return `LSP Command Help
=====================

Usage:
  /lsp definition <file> <line> <col> [--json|-j]     - 跳转到定义
  /lsp references <file> <line> <col> [--json|-j]      - 查找引用
  /lsp hover <file> <line> <col> [--json|-j]           - 悬停提示
  /lsp completion <file> <line> <col> [--json|-j]      - 代码补全
  /lsp implementation <file> <line> <col> [--json|-j]  - 查找实现
  /lsp typeDefinition <file> <line> <col> [--json|-j]   - 类型定义
  /lsp callHierarchy <file> <line> <col> [--json|-j]   - 调用层次分析
  /lsp rename <file> <line> <col> <newName>            - 符号重命名
  /lsp documentSymbol <file> [--json|-j]               - 文档符号列表
  /lsp diagnostics <file> [--json|-j]                  - 代码诊断信息
  /lsp format <file> [--json|-j]                       - 格式化代码
  /lsp workspaceSymbol <query> [--json|-j]             - 工作区符号搜索
  /lsp help                                             - 显示此帮助

Note: line 和 col 使用 1-based 坐标（与编辑器显示一致）。

Operations:
  definition        查找符号的定义位置
  references        查找符号的所有引用
  hover             获取鼠标悬停时的类型信息与文档
  completion        获取当前位置的代码补全建议
  implementation    查找接口或抽象方法的实现位置
  typeDefinition    查找类型的定义位置
  callHierarchy     分析函数的调用层次结构
  rename            重命名符号（更新所有引用）
  documentSymbol    列出文件中的所有符号
  diagnostics       获取文件的诊断信息（错误、警告）
  format            格式化代码文件
  workspaceSymbol   在整个工作区中搜索符号

Examples:
  /lsp definition src/index.ts 10 5
  /lsp references src/utils.ts 25 8
  /lsp hover src/components/App.tsx 15 3
  /lsp completion src/api/service.ts 42 10
  /lsp implementation src/types/Service.ts 8 4
  /lsp typeDefinition src/models/User.ts 12 6
  /lsp callHierarchy src/services/AuthService.ts 30 2
  /lsp rename src/utils/helpers.ts 18 5 "newFunctionName"
  /lsp documentSymbol src/index.ts
  /lsp diagnostics src/app.ts
  /lsp format src/utils.ts
  /lsp workspaceSymbol UserService
  /lsp list --json

Scenarios:
  • 查看函数定义:
    /lsp definition src/services/AuthService.ts 42 5

  • 查找所有引用（重构前检查影响范围）:
    /lsp references src/utils/formatDate.ts 10 3

  • 查看类型信息:
    /lsp hover src/models/User.ts 25 8

  • 查看调用层级（了解函数被谁调用）:
    /lsp callHierarchy src/services/orderService.ts 15 2

  • 重命名符号:
    /lsp rename src/shared/types.ts 8 4 "NewTypeName"

  • 检查文件错误:
    /lsp diagnostics src/app.ts

Best Practices:
  • 定义跳转时确保光标位置在符号名上
  • 重构前先用 references 检查所有引用
  • 使用 callHierarchy 分析函数的上下游调用关系
  • rename 操作会自动更新所有引用位置
  • 需要先启用 LSP 功能（设置 FEATURE_FLAGS.LSP = true）`;
}

/**
 * 读取文件内容并检测语言
 */
function readFileContent(
  filePath: string
):
  | { content: string; language: string; absolutePath: string }
  | { error: string } {
  const absolutePath = resolve(resolveProjectRoot(), filePath);

  if (!existsSync(absolutePath)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    const language = detectLanguage(absolutePath);
    return { content, language, absolutePath };
  } catch (error) {
    return {
      error: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 执行需要文件位置的操作
 */
async function executePositionOperation(
  toolManager: ReturnType<typeof getToolManager>,
  operation: string,
  file: string,
  line: number,
  col: number,
  extraParams: Record<string, unknown> = {}
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

  const fileInfo = readFileContent(file);
  if ('error' in fileInfo) {
    return { success: false, error: fileInfo.error };
  }

  const adapterAction = OPERATION_MAP[operation];

  try {
    const result = await toolManager.executeTool(
      'lsp',
      {
        action: adapterAction,
        document: fileInfo.content,
        language: fileInfo.language,
        position: { line: line, character: col },
        ...extraParams,
      },
      {}
    );

    return {
      success: true,
      message: `${operation} result:\n${JSON.stringify(result, null, 2)}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error executing LSP ${operation}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 执行仅需文件路径的操作
 */
async function executeFileOnlyOperation(
  toolManager: ReturnType<typeof getToolManager>,
  operation: string,
  file: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!file) {
    return {
      success: false,
      error: `Error: Please specify file path\nUsage: /lsp ${operation} <file>`,
    };
  }

  const fileInfo = readFileContent(file);
  if ('error' in fileInfo) {
    return { success: false, error: fileInfo.error };
  }

  const adapterAction = OPERATION_MAP[operation];

  try {
    const result = await toolManager.executeTool(
      'lsp',
      {
        action: adapterAction,
        document: fileInfo.content,
        language: fileInfo.language,
      },
      {}
    );

    return {
      success: true,
      message: `${operation} result:\n${JSON.stringify(result, null, 2)}`,
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
  description:
    '执行语言服务器协议操作（定义跳转、引用查找、悬停提示、代码补全、实现查找、符号搜索、调用层次等）',
  aliases: [],
  argumentHint: '[operation] [args]',
  whenToUse:
    '当你需要代码智能提示、定义跳转、引用查找、实现查找、文档符号、工作区符号搜索或调用层次分析时',
  load: async () => ({
    execute: async (args: string) => {
      if (!feature('LSP')) {
        return {
          success: true,
          message:
            'LSP 功能未启用。请在 featureFlags.ts 中设置 LSP: true 以启用语言服务器协议支持。',
        };
      }

      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return { success: true, message: buildHelpText() };
      }

      // 验证操作名是否合法
      if (!OPERATION_MAP[subcommand]) {
        const validOps = Object.keys(OPERATION_MAP).join(', ');
        return {
          success: false,
          error: `Error: Unknown operation "${subcommand}".\nValid operations: ${validOps}\n\nUse /lsp help for details.`,
        };
      }

      const toolManager = getToolManager();

      // 文件位置类操作
      if (FILE_POSITION_OPS.has(subcommand)) {
        const stripped = stripFlags(parts.slice(1));
        const file = stripped[0];
        const line = parseInt(stripped[1], 10);
        const col = parseInt(stripped[2], 10);
        const newName =
          subcommand === 'rename' ? stripped.slice(3).join(' ') : undefined;

        if (subcommand === 'rename' && !newName) {
          return {
            success: false,
            error:
              'Error: Please specify new name\nUsage: /lsp rename <file> <line> <col> <newName>',
          };
        }

        return await executePositionOperation(
          toolManager,
          subcommand,
          file,
          line,
          col,
          subcommand === 'rename' ? { newName } : {}
        );
      }

      // 仅文件路径操作
      if (FILE_ONLY_OPS.has(subcommand)) {
        const stripped = stripFlags(parts.slice(1));
        const file = stripped[0];
        return await executeFileOnlyOperation(toolManager, subcommand, file);
      }

      // 查询类操作
      if (QUERY_OPS.has(subcommand)) {
        const stripped = stripFlags(parts.slice(1));
        const query = stripped.join(' ');

        if (!query) {
          return {
            success: false,
            error:
              'Error: Please specify search query\nUsage: /lsp workspaceSymbol <query>',
          };
        }

        try {
          const result = await toolManager.executeTool(
            'lsp',
            {
              action: 'workspaceSymbol',
              query,
            },
            {}
          );

          return {
            success: true,
            message: `workspaceSymbol "${query}" result:\n${JSON.stringify(result, null, 2)}`,
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
        error: `Error: Unknown operation "${subcommand}"\n\nUse /lsp help to see all available operations.`,
      };
    },
  }),
};

export { getPromptForCommand };

export default lspCommand;
