/**
 * IDE命令执行逻辑
 * 管理IDE集成
 * 参考CC源码 cc_code/backend/commands/ide/ide.tsx 实现
 */

import type { CommandContext, CommandResult } from '../types/index.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * 支持的IDE类型
 */
const SUPPORTED_IDES = [
  { name: 'VS Code', command: 'code', alias: ['vscode', 'code'] },
  { name: 'Cursor', command: 'cursor', alias: ['cursor'] },
  { name: 'Trae', command: 'trae', alias: ['trae'] },
  { name: 'Windsurf', command: 'windsurf', alias: ['windsurf'] },
  { name: 'Zed', command: 'zed', alias: ['zed'] },
  { name: 'IntelliJ IDEA', command: 'idea', alias: ['idea', 'intellij'] },
  { name: 'PyCharm', command: 'pycharm', alias: ['pycharm'] },
  { name: 'WebStorm', command: 'webstorm', alias: ['webstorm'] },
];

/**
 * 检测已安装的IDE
 */
function detectIDEs(): { name: string; installed: boolean; path?: string }[] {
  return SUPPORTED_IDES.map((ide) => {
    try {
      const path = execSync(`where ${ide.command}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      return { name: ide.name, installed: true, path };
    } catch {
      return { name: ide.name, installed: false };
    }
  });
}

/**
 * 打开当前目录在IDE中
 */
function openInIDE(ideCommand: string, cwd: string): boolean {
  try {
    execSync(`${ide.command} "${cwd}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 执行IDE命令
 */
export async function executeIDE(
  args: string,
  context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseIDEArgs(args);
    const cwd = context.cwd || process.cwd();

    // 如果指定了open，尝试打开IDE
    if (params.action === 'open') {
      const ides = detectIDEs();
      const installedIDEs = ides.filter((i) => i.installed);

      if (installedIDEs.length === 0) {
        return {
          type: 'text',
          success: false,
          message: '未检测到已安装的IDE',
        };
      }

      // 优先使用VS Code
      const preferredIDE =
        installedIDEs.find((i) => i.name === 'VS Code') || installedIDEs[0];

      const success = openInIDE(preferredIDE.name, cwd);

      if (success) {
        return {
          type: 'text',
          success: true,
          message: `已在 ${preferredIDE.name} 中打开当前目录`,
        };
      } else {
        return {
          type: 'text',
          success: false,
          message: `无法打开 ${preferredIDE.name}`,
        };
      }
    }

    // 显示IDE状态
    const ides = detectIDEs();
    const installedCount = ides.filter((i) => i.installed).length;

    const output = ides
      .map((ide) => {
        const status = ide.installed ? '✓ 已安装' : '✗ 未安装';
        const path = ide.path ? ` (${ide.path})` : '';
        return `  ${ide.name}: ${status}${path}`;
      })
      .join('\n');

    return {
      type: 'text',
      success: true,
      message: `IDE集成状态 (${installedCount}/${ides.length} 已安装):\n\n${output}\n\n使用 /ide open 在当前IDE中打开项目`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `IDE命令执行失败: ${errorMessage}`,
    };
  }
}

/**
 * 解析IDE命令参数
 */
function parseIDEArgs(args: string): {
  action?: string;
} {
  const params: {
    action?: string;
  } = {};

  if (!args) return params;

  const parts = args.trim().split(/\s+/);

  for (const part of parts) {
    if (!part.startsWith('-')) {
      params.action = part;
      break;
    }
  }

  return params;
}
