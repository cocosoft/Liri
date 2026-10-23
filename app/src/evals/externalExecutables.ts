/**
 * externalExecutables.ts — 解析 eval 子进程依赖的外部命令（`git` / `tar`）
 *
 * 问题（2026-10-23 实测）：`execFile('git', …)` / `execFile('tar', …)` 只按 `PATH` 查找。
 * `git` 常装在默认目录却没写进 `PATH`（GUI 启动的进程、精简环境、本机 PowerShell 会话），
 * `tar` 在 Windows 上是 `%SystemRoot%\System32\tar.exe` —— 二者一起导致快照导出以
 * `spawn … ENOENT` 失败，且与"仓库不存在 / 归档损坏"**完全同形**，排查成本高。
 *
 * 解析顺序（每条命令统一）：
 *   1. 显式环境变量（`PYAPP_GIT_BIN` / `PYAPP_TAR_BIN`）—— CI 与非默认安装位置
 *   2. `PATH` 扫描（**零子进程**，按 `PATHEXT` 扩展名逐个目录试）
 *   3. 各平台常见安装位置（Git for Windows 默认在 `%ProgramFiles%\Git\cmd`）
 * 都找不到 ⇒ 返回命令名本身：保留原行为（由子进程报 ENOENT，调用方错误文案负责说明）。
 *
 * 为什么不复用 `diagnostics/DependenciesChecker` 的 PATH 扫描：那里经 `ConfigManager`
 * 取 `PATH` 且为私有实现，引入它会把 config/monitoring 依赖拉进本"零依赖"的离线判据链。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 显式指定外部命令路径的环境变量名 */
export const GIT_BIN_ENV = 'PYAPP_GIT_BIN';
export const TAR_BIN_ENV = 'PYAPP_TAR_BIN';

/** 在 `PATH` 的每个目录里找命令（Windows 依次试 `.exe/.cmd/.bat` 与无扩展名） */
function findInPath(
  command: string,
  pathValue: string,
  platform: NodeJS.Platform
): string | null {
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  // 分隔符按**被模拟的平台**取（而不是宿主的 `path.delimiter`）：测试会注入 platform
  const separator = platform === 'win32' ? ';' : ':';
  for (const rawDir of pathValue.split(separator)) {
    const dir = rawDir.trim().replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const extension of extensions) {
      const full = join(dir, `${command}${extension}`);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/**
 * 解析一条外部命令（先显式变量 → 再 PATH → 再常见安装位置）
 *
 * @param command 命令名（作为最后兜底，交给子进程报 ENOENT）
 * @param overrideKey 显式指定路径的环境变量名
 * @param knownLocations 各平台常见安装位置（**绝对路径**）
 */
function resolveExecutable(
  command: string,
  overrideKey: string,
  knownLocations: (
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform
  ) => string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string {
  const override = (env[overrideKey] ?? '').trim();
  if (override) return override;

  const fromPath = findInPath(
    command,
    env['PATH'] ?? env['Path'] ?? '',
    platform
  );
  if (fromPath) return fromPath;

  for (const candidate of knownLocations(env, platform)) {
    if (existsSync(candidate)) return candidate;
  }
  return command;
}

/** Git for Windows / 类 Unix 的 git 常见安装位置 */
function gitKnownLocations(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  if (platform !== 'win32') {
    return ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
  }
  const roots = [
    env['ProgramFiles'],
    env['ProgramFiles(x86)'],
    env['ProgramW6432'],
    env['LOCALAPPDATA'] ? join(env['LOCALAPPDATA'], 'Programs') : undefined,
  ].filter((root): root is string => !!root && root.trim() !== '');
  return roots.flatMap((root) => [
    join(root, 'Git', 'cmd', 'git.exe'),
    join(root, 'Git', 'bin', 'git.exe'),
  ]);
}

/** tar 的常见安装位置（Windows 自带 bsdtar 位于 System32） */
function tarKnownLocations(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  if (platform !== 'win32') {
    return ['/usr/bin/tar', '/bin/tar', '/usr/local/bin/tar'];
  }
  const systemRoot = (env['SystemRoot'] ?? 'C:\\Windows').trim();
  return [join(systemRoot, 'System32', 'tar.exe')];
}

/**
 * 解析 git 可执行文件路径。
 *
 * @param env 环境（测试可注入；缺省 `process.env`）
 * @param platform 平台（测试可注入；缺省 `process.platform`）
 */
export function resolveGitExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveExecutable(
    'git',
    GIT_BIN_ENV,
    gitKnownLocations,
    env,
    platform
  );
}

/**
 * 解析 tar 可执行文件路径（Windows 为自带的 bsdtar）。
 *
 * @param env 环境（测试可注入；缺省 `process.env`）
 * @param platform 平台（测试可注入；缺省 `process.platform`）
 */
export function resolveTarExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveExecutable(
    'tar',
    TAR_BIN_ENV,
    tarKnownLocations,
    env,
    platform
  );
}
