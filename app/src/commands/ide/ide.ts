/**
 * IDE 命令实现
 * 检测系统上已安装的 IDE，支持在当前 IDE 中打开项目目录
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { configManager } from '@modules/config';
import type { CommandContext, CommandResult } from '@modules/commands';

import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'commands:ide:ide', level: LogLevel.INFO });

/**
 * IDE 定义接口
 */
interface IDEDefinition {
  name: string;
  command: string;
  alias?: string[];
  commonPaths?: string[];
}

/**
 * IDE 检测结果接口
 */
interface IDEDetection extends IDEDefinition {
  installed: boolean;
  path?: string;
}

const SUPPORTED_IDES: IDEDefinition[] = [
  {
    name: 'VS Code',
    command: 'code',
    alias: ['vscode', 'code'],
    commonPaths: [
      join(
        configManager.env('LOCALAPPDATA') || '',
        'Programs\\Microsoft VS Code\\bin\\code.cmd'
      ),
      join(
        configManager.env('ProgramW6432') || '',
        'Microsoft VS Code\\bin\\code.cmd'
      ),
      join(
        configManager.env('ProgramFiles(x86)') || '',
        'Microsoft VS Code\\bin\\code.cmd'
      ),
    ],
  },
  {
    name: 'Cursor',
    command: 'cursor',
    alias: ['cursor'],
    commonPaths: [
      join(
        configManager.env('LOCALAPPDATA') || '',
        'Programs\\cursor\\Cursor.exe'
      ),
      join(
        configManager.env('USERPROFILE') || '',
        'AppData\\Local\\Programs\\cursor\\Cursor.exe'
      ),
    ],
  },
  {
    name: 'Trae',
    command: 'trae',
    alias: ['trae'],
    commonPaths: [
      join(configManager.env('LOCALAPPDATA') || '', 'Programs\\Trae\\Trae.exe'),
    ],
  },
  {
    name: 'Windsurf',
    command: 'windsurf',
    alias: ['windsurf'],
    commonPaths: [
      join(
        configManager.env('LOCALAPPDATA') || '',
        'Programs\\Windsurf\\Windsurf.exe'
      ),
    ],
  },
  {
    name: 'Zed',
    command: 'zed',
    alias: ['zed'],
    commonPaths: [
      join(configManager.env('LOCALAPPDATA') || '', 'Programs\\Zed\\zed.exe'),
      join(configManager.env('USERPROFILE') || '', '.cargo\\bin\\zed.exe'),
    ],
  },
  {
    name: 'IntelliJ IDEA',
    command: 'idea',
    alias: ['idea', 'intellij'],
    commonPaths: [
      join(
        configManager.env('ProgramW6432') || '',
        'JetBrains\\IntelliJ IDEA\\bin\\idea64.exe'
      ),
      join(
        configManager.env('ProgramFiles(x86)') || '',
        'JetBrains\\IntelliJ IDEA\\bin\\idea64.exe'
      ),
    ],
  },
  {
    name: 'PyCharm',
    command: 'pycharm',
    alias: ['pycharm'],
    commonPaths: [
      join(
        configManager.env('ProgramW6432') || '',
        'JetBrains\\PyCharm\\bin\\pycharm64.exe'
      ),
      join(
        configManager.env('ProgramFiles(x86)') || '',
        'JetBrains\\PyCharm\\bin\\pycharm64.exe'
      ),
    ],
  },
  {
    name: 'WebStorm',
    command: 'webstorm',
    alias: ['webstorm'],
    commonPaths: [
      join(
        configManager.env('ProgramW6432') || '',
        'JetBrains\\WebStorm\\bin\\webstorm64.exe'
      ),
      join(
        configManager.env('ProgramFiles(x86)') || '',
        'JetBrains\\WebStorm\\bin\\webstorm64.exe'
      ),
    ],
  },
];

/**
 * 解析标志参数
 */
function parseFlags(args: string): { showJson: boolean; action: string } {
  const trimmed = args.trim();
  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const cleaned = trimmed.replace(/--json\s*/g, '').trim();
  const parts = cleaned.split(/\s+/);
  const action = parts[0]?.toLowerCase() || '';
  return { showJson, action };
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  return {
    success: true,
    message: `
IDE 命令帮助:

使用 "/ide" 命令检测系统上已安装的 IDE，并在当前 IDE 中打开项目目录。

用法:
  /ide                    - 列出所有已安装的 IDE 及其状态
  /ide open               - 在当前 IDE 中打开项目目录
  /ide --json             - 以 JSON 格式输出 IDE 检测结果
  /ide help               - 显示此帮助

输出内容:
  状态列表 - 8 个 IDE 的安装状态和路径
  JSON 输出 - total / installed / ides 结构化数据

支持的 IDE:
  VS Code (code / vscode), Cursor, Trae, Windsurf,
  Zed, IntelliJ IDEA, PyCharm, WebStorm

检测方式（按优先级）:
  1. 开始菜单扫描 — 扫描 Windows 开始菜单中的快捷方式
  2. PATH 环境变量 — 通过 where 命令查找
  3. 常见安装路径 — 逐一检查可能的安装目录

示例:
  /ide
  /ide open
  /ide --json

别名: /editor
    `.trim(),
  };
}

/**
 * 通过 PATH 检测 IDE 是否安装
 */
function detectByPath(def: IDEDefinition): {
  installed: boolean;
  path?: string;
} {
  try {
    const result = execSync(`where ${def.command}`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 3000,
    }).trim();
    const firstPath = result.split('\n')[0].trim();
    if (firstPath) {
      return { installed: true, path: firstPath };
    }
  } catch (err) {
    // not in PATH

    handleError(err, { module: 'commands:ide:ide', action: 'notInPath' });
  }
  return { installed: false };
}

/**
 * 通过常见安装路径检测 IDE 是否安装
 */
function detectByCommonPaths(def: IDEDefinition): {
  installed: boolean;
  path?: string;
} {
  if (!def.commonPaths) return { installed: false };
  for (const candidatePath of def.commonPaths) {
    try {
      if (existsSync(candidatePath)) {
        return { installed: true, path: candidatePath };
      }
    } catch {
      continue;
    }
  }
  return { installed: false };
}

/**
 * 扫描 Windows 开始菜单程序列表
 */
function scanStartMenuPrograms(): IDEDetection[] {
  const results: IDEDetection[] = [];
  const startMenuDirs = [
    join(
      configManager.env('ProgramData') || '',
      'Microsoft\\Windows\\Start Menu\\Programs'
    ),
    join(
      configManager.env('APPDATA') || '',
      'Microsoft\\Windows\\Start Menu\\Programs'
    ),
  ];

  const knownIDEs: Record<string, { name: string; command: string }> = {
    code: { name: 'VS Code', command: 'code' },
    vscode: { name: 'VS Code', command: 'code' },
    cursor: { name: 'Cursor', command: 'cursor' },
    trae: { name: 'Trae', command: 'trae' },
    windsurf: { name: 'Windsurf', command: 'windsurf' },
    zed: { name: 'Zed', command: 'zed' },
    idea: { name: 'IntelliJ IDEA', command: 'idea' },
    intellij: { name: 'IntelliJ IDEA', command: 'idea' },
    pycharm: { name: 'PyCharm', command: 'pycharm' },
    webstorm: { name: 'WebStorm', command: 'webstorm' },
  };

  for (const dir of startMenuDirs) {
    try {
      const { readdirSync } = require('fs');
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const lower = item.name.toLowerCase();
        for (const [key, ideInfo] of Object.entries(knownIDEs)) {
          if (lower.includes(key)) {
            const fullPath = join(dir, item.name);
            if (!results.some((r) => r.name === ideInfo.name)) {
              results.push({
                name: ideInfo.name,
                command: ideInfo.command,
                installed: true,
                path: fullPath,
              });
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return results;
}

/**
 * 检测所有 IDE 安装状态（三级别检测）
 */
function detectIDEs(): IDEDetection[] {
  const scanResults = scanStartMenuPrograms();

  return SUPPORTED_IDES.map((def) => {
    const fromScan = scanResults.find((r) => r.name === def.name);
    if (fromScan) return fromScan;

    const pathResult = detectByPath(def);
    if (pathResult.installed) {
      return { ...def, ...pathResult };
    }

    const commonResult = detectByCommonPaths(def);
    if (commonResult.installed) {
      return { ...def, ...commonResult };
    }

    return { name: def.name, installed: false, command: def.command };
  });
}

/**
 * 在指定 IDE 中打开项目目录
 */
function openInIDE(
  command: string,
  cwd: string,
  installedPath?: string
): boolean {
  try {
    if (installedPath) {
      execSync(`"${installedPath}" "${cwd}"`, {
        stdio: 'ignore',
        timeout: 5000,
      });
    } else {
      execSync(`${command} "${cwd}"`, {
        stdio: 'ignore',
        timeout: 5000,
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 将 IDE 检测结果转换为 JSON 对象
 */
function idesToJson(ides: IDEDetection[]): Record<string, unknown> {
  return {
    total: ides.length,
    installed: ides.filter((i) => i.installed).length,
    ides: ides.map((ide) => ({
      name: ide.name,
      installed: ide.installed,
      path: ide.path || null,
      command: ide.command,
    })),
  };
}

/**
 * 处理列表子命令
 */
function handleList(showJson: boolean): CommandResult {
  const ides = detectIDEs();
  const installed = ides.filter((i) => i.installed);

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(idesToJson(ides), null, 2),
    };
  }

  const lines: string[] = ['已检测的 IDE:\n'];

  for (const ide of ides) {
    const status = ide.installed ? '✓ 已安装' : '✗ 未安装';
    const pathInfo = ide.path ? ` (${ide.path})` : '';
    lines.push(`  ${status}  ${ide.name}${pathInfo}`);
  }

  if (installed.length === 0) {
    lines.push('\n未检测到已安装的 IDE，请确认已正确安装。');
  } else {
    lines.push(
      `\n共检测到 ${installed.length}/${ides.length} 个已安装的 IDE。`
    );
    lines.push('\n使用 "\\ide open" 在当前 IDE 中打开项目目录。');
  }

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理打开子命令
 */
function handleOpen(context: CommandContext): CommandResult {
  const ides = detectIDEs();
  const installed = ides.filter((i) => i.installed);

  if (installed.length === 0) {
    return { success: false, message: '未检测到已安装的 IDE，无法打开项目。' };
  }

  const cwd = context.cwd || process.cwd();
  const preferred = installed.find((i) => i.command === 'code') || installed[0];

  const opened = openInIDE(preferred.command, cwd, preferred.path);

  if (opened) {
    return {
      success: true,
      message: `已在 ${preferred.name} 中打开项目目录: ${cwd}`,
    };
  }

  return {
    success: false,
    message: `尝试在 ${preferred.name} 中打开项目失败，请确认 IDE 可正常启动。`,
  };
}

const ideCommand = {
  /**
   * 执行 IDE 命令
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    try {
      const { showJson, action } = parseFlags(args);

      if (action === 'help' || action === '-h' || action === '--help') {
        return showHelp();
      }

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_ide_view', { action: action || 'list', showJson });
      } catch (err) {
        // analytics 非关键

        handleError(err, {
          module: 'commands:ide:ide',
          action: 'analyticsNonCritical',
        });
      }

      if (action === 'open') {
        return handleOpen(context);
      }

      if (action === '' || action === 'list') {
        return handleList(showJson);
      }

      return {
        success: false,
        message: `未知子命令: ${action}\n使用 /ide help 查看帮助`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default ideCommand;
