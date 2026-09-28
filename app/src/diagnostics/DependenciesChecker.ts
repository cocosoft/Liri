/**
 * 依赖检查器
 *
 * 统一检测运行时所需的外部命令和依赖：
 * - 外部命令：PowerShell、git、where/which 等
 * - 平台感知：自动适配 Windows/macOS/Linux 的命令检测方式
 * - 分"必需"与"可选"两级，不阻断启动
 */

import { accessSync, constants, statSync } from 'fs';
import { join } from 'path';
import { configManager } from '@modules/config';
import { execFileNoThrow } from '@modules/utils/execFileNoThrow';

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
 * 在 `PATH` 中定位可执行文件（**零子进程**）
 *
 * - Windows：按 `PATHEXT`（缺省 `.COM;.EXE;.BAT;.CMD`）逐扩展名匹配（NTFS 大小写不敏感）；
 * - Unix：`<dir>/<cmd>` 且具备执行权限（`X_OK`）。
 *
 * 与 `where`/`which` 的等价性：三者同为"在 PATH 中找可执行文件"；差异仅在 `where` 会额外
 * 搜当前目录、部分 `which` 会解析 shell 别名 —— 对"该命令是否可用"的判定无影响。
 */
function findExecutableInPath(cmd: string): string | null {
  // `PATH` / `PATHEXT` 经统一出入口读取（R05-012，不直引 `process.env`）
  const dirs = (configManager.env('PATH') ?? '')
    .split(isWindows ? ';' : ':')
    .map((d) => d.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);

  if (isWindows) {
    const hasExt = /\.[a-z0-9]+$/i.test(cmd);
    const exts = (configManager.env('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter(Boolean);
    const names = hasExt ? [cmd] : exts.map((ext) => `${cmd}${ext}`);
    for (const dir of dirs) {
      for (const name of names) {
        const full = join(dir, name);
        if (statSync(full, { throwIfNoEntry: false })?.isFile()) return full;
      }
    }
    return null;
  }

  for (const dir of dirs) {
    const full = join(dir, cmd);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      // @ignore-catch: 不存在或无执行权限 ⇒ 继续试下一个目录
    }
  }
  return null;
}

/**
 * 使用系统命令检测目标命令是否存在（**异步**，不阻塞事件循环）
 * Windows 使用 `where`，Unix 使用 `which`
 *
 * 2026-09-28：原实现用 `spawnSync`（每命令 2 次同步 spawn：`where` + `--version`），
 * 事件循环探针的 cpuprofile 归因显示这条链是 `spawnSync 3853ms` 阻塞的**第一大来源**
 * （1768ms / 3 命令）。① 先改异步 `execFileNoThrow`（不再停摆）；
 * ② 再以 `PATH` 扫描取代存在性探测子进程 ⇒ 存在性判定零 spawn；
 * ③ 最后按命令声明 `versionArgs`（仅 `git` 有版本输出）⇒ 单次检查仅剩 1 次 spawn。
 */
async function checkCommandExists(
  cmd: string,
  versionArgs?: string[]
): Promise<{ found: boolean; version?: string }> {
  if (!findExecutableInPath(cmd)) {
    return { found: false };
  }

  // 未声明 `versionArgs` ⇒ 该命令无有意义的版本输出，跳过探测（不再白耗一次 spawn）
  if (!versionArgs?.length) {
    return { found: true };
  }

  // 获取版本信息（部分工具把版本打到 stderr）
  const versionResult = await execFileNoThrow(cmd, versionArgs, {
    timeout: 3000,
  });
  const version =
    versionResult.stdout.trim() || versionResult.stderr.trim() || undefined;

  return { found: true, version };
}

/**
 * 命令检查定义（**内部类型**）：比对外 payload 多一个内部字段 `versionArgs`
 *
 * `versionArgs` 缺省 ⇒ **不做版本探测**。仅对"确实有版本输出"的命令声明 —— 实测本机：
 * `git --version` 246ms 有输出；`where --version` 239ms、`powershell --version` 985ms
 * 输出**恒为空**（`where` 无该参数；Windows PowerShell 5.1 不支持），故二者不声明：
 * 既省 ~1.2s/次，也不改变对外结果（它们本就没有版本值）。
 */
interface CommandCheckDef extends Omit<
  ExternalCommandCheck,
  'found' | 'version'
> {
  versionArgs?: string[];
}

/**
 * 获取平台预定义的外部命令检查清单
 */
function getCommandList(): CommandCheckDef[] {
  const list: CommandCheckDef[] = [
    {
      command: 'git',
      displayName: 'Git',
      required: false,
      purpose: 'Git 操作（提交、分支、日志等）',
      installHint: '从 https://git-scm.com/downloads 下载安装',
      versionArgs: ['--version'],
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
      installHint:
        'Windows 系统自带，可通过 https://github.com/PowerShell/PowerShell 更新',
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

  // 并发探测：各命令互不依赖；`Promise.all` 保持与 commandList 同序
  // （顺序 await 会把各命令的等待时间叠加；并发后 ≈ 最慢的单条，且当前仅 git 需一次 spawn）
  const probed = await Promise.all(
    commandList.map((cmdDef) =>
      checkCommandExists(cmdDef.command, cmdDef.versionArgs)
    )
  );

  for (const [index, cmdDef] of commandList.entries()) {
    const { found, version } = probed[index];
    // 显式映射（不用 `...cmdDef` 展开）：`versionArgs` 属内部字段，不得进入对外 payload
    items.push({
      command: cmdDef.command,
      displayName: cmdDef.displayName,
      required: cmdDef.required,
      purpose: cmdDef.purpose,
      installHint: cmdDef.installHint,
      found,
      version,
    });

    if (!found && cmdDef.required) {
      suggestions.push(
        `缺少必需命令 ${cmdDef.command}（${cmdDef.purpose}）：${cmdDef.installHint}`
      );
    } else if (!found) {
      suggestions.push(
        `可选命令 ${cmdDef.command}（${cmdDef.purpose}）未安装，${cmdDef.installHint}；不影响核心功能`
      );
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
    parts.push(
      `  ${icon} ${tag} ${item.displayName}: ${item.found ? `已找到${ver}` : `未找到 — ${item.installHint}`}`
    );
  }
  return parts.join('\n');
}
