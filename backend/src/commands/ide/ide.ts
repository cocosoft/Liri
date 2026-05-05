/**
 * IDE命令执行逻辑
 * 管理IDE集成
 */

import type { CommandContext, CommandResult } from '../types/index.js';
import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * IDE配置
 */
interface IDEDefinition {
  name: string;
  command: string;
  alias: string[];
  /** Windows下可能的安装路径模式 */
  commonPaths?: string[];
}

/**
 * IDE检测结果
 */
interface IDEDetection {
  name: string;
  installed: boolean;
  path?: string;
  command: string;
}

/**
 * 支持的IDE类型
 */
const SUPPORTED_IDES: IDEDefinition[] = [
  {
    name: 'VS Code',
    command: 'code',
    alias: ['vscode', 'code'],
    commonPaths: [
      join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      join('D:', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      join('C:', 'Program Files', 'Microsoft VS Code', 'bin', 'code.cmd'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    ],
  },
  {
    name: 'Cursor',
    command: 'cursor',
    alias: ['cursor'],
    commonPaths: [
      join(homedir(), 'AppData', 'Local', 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      join(homedir(), 'AppData', 'Local', 'cursor', 'Cursor.exe'),
      join(process.env.USERPROFILE || homedir(), 'scoop', 'apps', 'cursor', 'current', 'cursor.exe'),
    ],
  },
  {
    name: 'Trae',
    command: 'trae',
    alias: ['trae'],
    commonPaths: [
      join(homedir(), 'AppData', 'Local', 'Programs', 'Trae', 'bin', 'trae.cmd'),
      join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Trae', 'bin', 'trae.cmd'),
    ],
  },
  {
    name: 'Windsurf',
    command: 'windsurf',
    alias: ['windsurf'],
    commonPaths: [
      join(homedir(), 'AppData', 'Local', 'Programs', 'Windsurf', 'resources', 'app', 'bin', 'windsurf.cmd'),
      join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Windsurf', 'bin', 'windsurf.cmd'),
    ],
  },
  {
    name: 'Zed',
    command: 'zed',
    alias: ['zed'],
    commonPaths: [
      join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Zed', 'zed.exe'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'Zed', 'zed.exe'),
    ],
  },
  {
    name: 'IntelliJ IDEA',
    command: 'idea',
    alias: ['idea', 'intellij'],
    commonPaths: [
      join('C:', 'Program Files', 'JetBrains', 'IntelliJ IDEA', 'bin', 'idea64.exe'),
      join('C:', 'Program Files', 'JetBrains', 'IntelliJ IDEA Community Edition', 'bin', 'idea64.exe'),
      join(homedir(), 'AppData', 'Local', 'JetBrains', 'IntelliJ IDEA', 'bin', 'idea64.exe'),
    ],
  },
  {
    name: 'PyCharm',
    command: 'pycharm',
    alias: ['pycharm'],
    commonPaths: [
      join('C:', 'Program Files', 'JetBrains', 'PyCharm', 'bin', 'pycharm64.exe'),
      join('C:', 'Program Files', 'JetBrains', 'PyCharm Community Edition', 'bin', 'pycharm64.exe'),
      join(homedir(), 'AppData', 'Local', 'JetBrains', 'PyCharm', 'bin', 'pycharm64.exe'),
    ],
  },
  {
    name: 'WebStorm',
    command: 'webstorm',
    alias: ['webstorm'],
    commonPaths: [
      join('C:', 'Program Files', 'JetBrains', 'WebStorm', 'bin', 'webstorm64.exe'),
      join(homedir(), 'AppData', 'Local', 'JetBrains', 'WebStorm', 'bin', 'webstorm64.exe'),
    ],
  },
];

/**
 * 通过 PATH 环境变量检测IDE是否已安装
 */
function detectByPath(def: IDEDefinition): { installed: boolean; path?: string } {
  try {
    const result = execSync(`where ${def.command}`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 3000,
    }).trim();
    // where命令可能返回多行，取第一行
    const firstPath = result.split('\n')[0].trim();
    if (firstPath) {
      return { installed: true, path: firstPath };
    }
  } catch {
    // 不在PATH中，继续 fallback 检测
  }
  return { installed: false };
}

/**
 * 通过常见的安装路径检测IDE是否已安装
 */
function detectByCommonPaths(def: IDEDefinition): { installed: boolean; path?: string } {
  if (!def.commonPaths) {
    return { installed: false };
  }

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
 * 在 Windows 上扫描开始菜单目录中的 IDE 快捷方式
 */
function scanStartMenuPrograms(): IDEDetection[] {
  const results: IDEDetection[] = [];
  const startMenuPaths = [
    join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];

  for (const startMenuPath of startMenuPaths) {
    try {
      if (!existsSync(startMenuPath)) continue;

      const entries = readdirSync(startMenuPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.name.toLowerCase().endsWith('.lnk')) continue;

        const entryName = entry.name.replace(/\.lnk$/i, '').toLowerCase();

        for (const def of SUPPORTED_IDES) {
          if (results.some(r => r.name === def.name)) continue;

          if (def.alias.some(a => entryName.includes(a))) {
            results.push({
              name: def.name,
              installed: true,
              path: join(startMenuPath, entry.name),
              command: def.command,
            });
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
 * 检测所有已安装的IDE
 */
function detectIDEs(): IDEDetection[] {
  const scanResults = scanStartMenuPrograms();

  return SUPPORTED_IDES.map((def) => {
    // 1. 先检查是否已通过开始菜单扫描找到
    const fromScan = scanResults.find(r => r.name === def.name);
    if (fromScan) {
      return fromScan;
    }

    // 2. 通过 PATH 检测
    const pathResult = detectByPath(def);
    if (pathResult.installed) {
      return {
        name: def.name,
        installed: true,
        path: pathResult.path,
        command: def.command,
      };
    }

    // 3. 通过常见安装路径检测
    const commonResult = detectByCommonPaths(def);
    if (commonResult.installed) {
      return {
        name: def.name,
        installed: true,
        path: commonResult.path,
        command: def.command,
      };
    }

    return {
      name: def.name,
      installed: false,
      command: def.command,
    };
  });
}

/**
 * 在IDE中打开目录
 */
function openInIDE(command: string, cwd: string, installedPath?: string): boolean {
  try {
    const cmd = installedPath || command;
    execSync(`"${cmd}" "${cwd}"`, {
      stdio: 'pipe',
      timeout: 10000,
    });
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

      const preferredIDE = installedIDEs.find((i) => i.name === 'VS Code') || installedIDEs[0];
      const success = openInIDE(preferredIDE.command, cwd, preferredIDE.path);

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
