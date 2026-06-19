/**
 * AppCore 启动增强工具函数
 * 从 AppCore.ts 拆分，保障核心类不超过 500 行。
 *
 * 职责：
 * - Git 工作树创建
 * - Session 持久化加载
 * - 终端状态备份/恢复
 * - 启动报告展示
 */
import { Logger } from '@modules/monitoring';
import { TerminalComponents } from '@modules/ui/TerminalComponents.js';
import { StartupProfiler } from '@modules/utils/startupProfiler.js';
import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { resolveSessionsDir, resolveDataDir } from '@modules/core';
import { configManager } from '@modules/config';
import type { AppCoreConfig } from './AppCoreConfig';
import type { ModuleDependencyManager } from './ModuleDependencyManager.js';
import type { PluginSystem } from '@modules/plugins/index.js';

const logger = new Logger({ module: 'AppCore' });

/**
 * 创建 Git 工作树
 * @returns 工作树路径，若未创建则返回 null
 */
export async function setupGitWorktree(
  config: AppCoreConfig
): Promise<string | null> {
  const opts = config.startup?.worktree;
  if (!opts?.enabled) return null;

  try {
    const cwd = process.cwd();
    const gitRoot = findGitRoot(cwd);
    if (!gitRoot) {
      logger.warn('Not in a git repository, skipping worktree creation');
      return null;
    }

    const slug = opts.prNumber ? `pr-${opts.prNumber}` : (opts.name ?? 'dev');
    const worktreeBranch = `worktree/${slug}`;
    const worktreePath = resolve(gitRoot, '..', 'worktrees', slug);

    if (existsSync(worktreePath)) {
      logger.info(`Worktree already exists at ${worktreePath}`);
      return worktreePath;
    }

    logger.info(`Creating git worktree: ${worktreeBranch} at ${worktreePath}`);

    execSync(`git worktree add --detach "${worktreePath}"`, {
      cwd: gitRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    execSync(`git checkout -b "${worktreeBranch}"`, {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    process.chdir(worktreePath);
    logger.info(`Git worktree created and switched to ${worktreePath}`);
    return worktreePath;
  } catch (error) {
    logger.warn('Failed to create git worktree', { error: String(error) });
    return null;
  }
}

/**
 * 查找 Git 仓库根目录
 */
function findGitRoot(startPath: string): string | null {
  try {
    const output = execSync('git rev-parse --show-toplevel', {
      cwd: startPath,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * 加载 Session 持久化
 * @returns SessionFactory 实例，若未启用则返回 null
 */
export async function loadSessionPersistence(
  config: AppCoreConfig
): Promise<import('../session/SessionFactory.js').SessionFactory | null> {
  const opts = config.startup?.session;
  if (!opts?.enabled) return null;

  try {
    const { SessionFactory } = await import('../session/SessionFactory.js');
    const { UnifiedStorageAdapter } =
      await import('../session/storage/UnifiedStorageAdapter.js');
    const { FileSystemUnifiedStorage } =
      await import('../session/storage/FileSystemUnifiedStorage.js');
    const { StorageType } =
      await import('../session/storage/UnifiedStorage.js');

    const storageDir = opts.storageDir ?? resolveSessionsDir();
    const unifiedStorage = new FileSystemUnifiedStorage({
      type: StorageType.FILESYSTEM,
      basePath: storageDir,
    });
    await unifiedStorage.initialize();
    const storage = new UnifiedStorageAdapter(unifiedStorage);
    const sessionFactory = new SessionFactory(storage);

    if (opts.sessionId) {
      const session = await sessionFactory.loadSession(opts.sessionId);
      if (session) {
        logger.info(`Session loaded: ${opts.sessionId}`);
        TerminalComponents.printInfo(`恢复会话: ${opts.sessionId}`);
      } else {
        logger.info(`Session not found: ${opts.sessionId}, creating new`);
        const newSession = await sessionFactory.createSession({
          title: `Startup ${new Date().toISOString()}`,
        });
        logger.info(`New session created: ${newSession.id}`);
      }
    }

    return sessionFactory;
  } catch (error) {
    logger.warn('Failed to load session persistence', {
      error: String(error),
    });
    return null;
  }
}

/**
 * 保存终端状态备份
 * @returns 备份路径，若未创建则返回 null
 */
export async function saveTerminalState(): Promise<string | null> {
  try {
    const backupDir = resolveDataDir();
    if (!existsSync(backupDir)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = join(backupDir, 'terminal_state.json');
    const terminalState = {
      cwd: process.cwd(),
      env: {
        TERM: configManager.env('TERM'),
        SHELL: configManager.env('SHELL'),
        LANG: configManager.env('LANG'),
      },
      timestamp: new Date().toISOString(),
    };

    writeFileSync(backupPath, JSON.stringify(terminalState, null, 2), 'utf-8');
    logger.info(`Terminal state saved to ${backupPath}`);
    return backupPath;
  } catch (error) {
    logger.warn('Failed to save terminal state', { error: String(error) });
    return null;
  }
}

/**
 * 恢复终端状态
 */
export async function restoreTerminalState(
  backupPath: string | null
): Promise<void> {
  if (!backupPath || !existsSync(backupPath)) return;

  try {
    const data = readFileSync(backupPath, 'utf-8');
    const terminalState = JSON.parse(data);
    logger.info('Terminal state restored from backup');
    unlinkSync(backupPath);
  } catch (error) {
    logger.warn('Failed to restore terminal state', { error: String(error) });
  }
}

/**
 * 显示启动报告
 */
export function showStartupReport(
  config: AppCoreConfig,
  profiler: StartupProfiler,
  useLegacyModuleSystem: boolean,
  moduleManager?: ModuleDependencyManager,
  pluginSystem?: PluginSystem
): void {
  profiler.stop();
  const report = profiler.generateReport();

  TerminalComponents.printHeader('启动报告');

  const stats: [string, string][] = [
    ['应用名称', config.name],
    ['版本', config.version],
    ['官网', 'https://openliri.com'],
    ['启动时间', `${report.totalDuration.toFixed(2)}ms`],
    [
      '模块数量',
      useLegacyModuleSystem
        ? (moduleManager?.getModules().length.toString() ?? 'N/A')
        : '由 ModuleRegistry 管理',
    ],
    ['插件数量', pluginSystem?.getPluginInfoList().length.toString() ?? 'N/A'],
  ];

  TerminalComponents.printKeyValue(stats);
}
