/**
 * 依赖检查器
 *
 * 统一检测运行时所需的外部命令和依赖：
 * - 外部命令：PowerShell、git、where/which 等
 * - 平台感知：自动适配 Windows/macOS/Linux 的命令检测方式
 * - 分"必需"与"可选"两级，不阻断启动
 */

import { spawnSync } from 'child_process';

/**
 * 外部命令检查项
 */
export interface ExternalCommandCheck {
  /** 命令名称 */
  command: string;
  /** 显示名称（中文） */
  displayName: string;
  /** 是否必需 */
  required: boolean;
  /** 是否找到 */
  found: boolean;
  /** 用途说明 */
  purpose: string;
  /** 安装指引 */
  installHint: string;
  /** 版本信息（可选） */
  version?: string;
}

/**
 * 依赖检查整体状态
 */
export type DependencyStatus = 'healthy' | 'warning';

/**
 * 依赖检查结果
 */
export interface DependenciesCheckResult {
  status: DependencyStatus;
  items: ExternalCommandCheck[];
  suggestions: string[];
}

const isWindows = process.platform === 'win32';

/**
 * 使用系统命令检测目标命令是否存在
 * Windows 使用 `where`，Unix 使用 `which`
 */
function checkCommandExists(cmd: string): { found: boolean; version?: string } {
  const searchCmd = isWindows ? 'where' : 'which';
  const searchResult = spawnSync(searchCmd, [cmd], {
    stdio: 'ignore',
    timeout: 3000,
  });
  if (searchResult.error || searchResult.status !== 0) {
    return { found: false };
  }

  // 获取版本信息
  const versionArgs = ['--version'];
  const versionResult = spawnSync(cmd, versionArgs, {
    encoding: 'utf-8',
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const version = versionResult.status === 0 ? versionResult.stdout?.trim() || versionResult.stderr?.trim() : undefined;

  return { found: true, version };
}

/**
 * 获取平台预定义的外部命令检查清单
 */
function getCommandList(): Omit<ExternalCommandCheck, 'found' | 'version'>[] {
  const list: Omit<ExternalCommandCheck, 'found' | 'version'>[] = [
    {
      command: 'git',
      displayName: 'Git',
      required: false,
      purpose: 'Git 操作（提交、分支、日志等）',
      installHint: '从 https://git-scm.com/downloads 下载安装',
    },
    {
      command: isWindows ? 'where' : 'which',
      displayName: isWindows ? 'where' : 'which',
      required: false,
      purpose: '外部命令检测工具',
      installHint: isWindows ? 'Windows 系统自带' : 'Unix 系统自带',
    },
  ];

  if (isWindows) {
    list.push({
      command: 'powershell',
      displayName: 'PowerShell',
      required: false,
      purpose: 'PowerShell 工具执行',
      installHint: 'Windows 系统自带，可通过 https://github.com/PowerShell/PowerShell 更新',
    });
  }

  return list;
}

/**
 * 检查外部命令是否可用
 */
export async function checkExternalCommands(): Promise<DependenciesCheckResult> {
  const items: ExternalCommandCheck[] = [];
  const suggestions: string[] = [];

  const commandList = getCommandList();

  for (const cmdDef of commandList) {
    const { found, version } = checkCommandExists(cmdDef.command);
    items.push({ ...cmdDef, found, version });

    if (!found && cmdDef.required) {
      suggestions.push(`缺少必需命令 ${cmdDef.command}（${cmdDef.purpose}）：${cmdDef.installHint}`);
    } else if (!found) {
      suggestions.push(`可选命令 ${cmdDef.command}（${cmdDef.purpose}）未安装，${cmdDef.installHint}；不影响核心功能`);
    }
  }

  const hasCritical = items.some((i) => !i.found && i.required);
  const status: DependencyStatus = hasCritical ? 'warning' : 'healthy';

  return { status, items, suggestions };
}

/**
 * 格式化外部命令检查结果为健康检查项文本
 */
export function formatExternalCommands(items: ExternalCommandCheck[]): string {
  const parts: string[] = [];
  for (const item of items) {
    const icon = item.found ? '✅' : '⚠️';
    const tag = item.required ? '[必需]' : '[可选]';
    const ver = item.version ? ` (${item.version})` : '';
    parts.push(`  ${icon} ${tag} ${item.displayName}: ${item.found ? `已找到${ver}` : `未找到 — ${item.installHint}`}`);
  }
  return parts.join('\n');
}
