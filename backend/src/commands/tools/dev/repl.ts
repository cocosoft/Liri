/**
 * REPL命令
 * 调用REPLTool来执行交互式代码
 * CC 中 REPL 为架构模式（将 Bash、NotebookEdit 等工具包装到 VM 沙箱），
 * 此处作为用户命令封装，提供多语言代码执行能力
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * 支持的语言列表
 */
const SUPPORTED_LANGUAGES: Record<string, string> = {
  python: 'Python 3',
  javascript: 'Node.js JavaScript',
  typescript: 'TypeScript',
  bash: 'Bash shell',
  powershell: 'PowerShell',
  ruby: 'Ruby',
};

/**
 * 构建帮助文本
 */
function buildHelpText(): string {
  const lines: string[] = [
    `REPL Command Help\n=====================`,
    ``,
    `Execute code in an interactive REPL environment.`,
    ``,
    `Usage:\n`,
    `  /repl_tool <language> <code>`,
    ``,
    `Supported languages:\n`,
  ];

  for (const [lang, desc] of Object.entries(SUPPORTED_LANGUAGES)) {
    lines.push(`  ${lang.padEnd(15)} ${desc}`);
  }

  lines.push(
    ``,
    `Examples:\n`,
    `  /repl_tool python "print('Hello, world!')"`,
    `  /repl_tool javascript "console.log('Hello, world!')"`,
    `  /repl_tool typescript "const x: number = 42; console.log(x);"`,
    `  /repl_tool bash "ls -la"`,
    `  /repl_tool powershell "Get-Process | Select-Object -First 5"`,
    `  /repl_tool ruby "puts 'Hello'"`,
  );

  return lines.join('\n');
}

/**
 * REPL命令
 */
export const replCommand: Command = {
  type: 'action',
  name: 'repl',
  description: '执行交互式代码（支持 Python/JavaScript/TypeScript/Bash/PowerShell/Ruby）',
  aliases: [],
  argumentHint: '<language> <code>',
  whenToUse: '当你需要快速执行一小段代码来测试想法、运行脚本或验证逻辑时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return { success: true, message: buildHelpText() };
      }

      const language = subcommand;
      const code = parts.slice(1).join(' ');

      // 验证语言是否支持
      if (!SUPPORTED_LANGUAGES[language]) {
        const supported = Object.keys(SUPPORTED_LANGUAGES).join(', ');
        return {
          success: false,
          error: `Error: Unsupported language "${language}".\nSupported languages: ${supported}\n\nUsage: /repl_tool <language> <code>\nExample: /repl_tool python "print('Hello')"`,
        };
      }

      if (!code) {
        return {
          success: false,
          error: `Error: Please specify code to execute\nUsage: /repl_tool ${language} <code>\n\nExample:\n  /repl_tool ${language} "your code here"`,
        };
      }

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'repl',
          {
            language: language,
            code: code,
          },
          {},
        );

        const output = result?.output || result?.result || result?.message || '';
        return {
          success: true,
          message: output || 'Code executed successfully (no output)',
        };
      } catch (error) {
        return {
          success: false,
          error: `Error executing ${language} code: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default replCommand;
