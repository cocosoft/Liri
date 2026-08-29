import { getLogger } from '@modules/monitoring';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveProjectRoot } from '@modules/core';

const logger = getLogger('daemon:autoUpdater');

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  updateAvailableAt?: number;
}

export class AutoUpdater {
  private checkIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentVersion: string;
  private latestVersion: string = '';

  constructor(checkIntervalMs: number = 24 * 60 * 60 * 1000, version?: string) {
    this.checkIntervalMs = checkIntervalMs;
    this.currentVersion = version || this.detectVersion();
  }

  start(): void {
    if (this.timer) return;
    this.check();
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
    logger.info('[AutoUpdater] 已启动', {
      intervalMs: this.checkIntervalMs,
      currentVersion: this.currentVersion,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check(): Promise<UpdateInfo> {
    try {
      this.latestVersion = await this.fetchLatestVersion();
      const hasUpdate = this.latestVersion !== this.currentVersion;
      if (hasUpdate) {
        logger.info('[AutoUpdater] 发现新版本', {
          current: this.currentVersion,
          latest: this.latestVersion,
        });
      }
      return {
        currentVersion: this.currentVersion,
        latestVersion: this.latestVersion,
        hasUpdate,
        updateAvailableAt: hasUpdate ? Date.now() : undefined,
      };
    } catch (e) {
      logger.warn('[AutoUpdater] 检查更新失败', { error: String(e) });
      return {
        currentVersion: this.currentVersion,
        latestVersion: this.currentVersion,
        hasUpdate: false,
      };
    }
  }

  async apply(): Promise<boolean> {
    if (!this.latestVersion || this.latestVersion === this.currentVersion) {
      return false;
    }
    try {
      logger.info('[AutoUpdater] 正在应用更新', {
        from: this.currentVersion,
        to: this.latestVersion,
      });
      execSync('git pull origin main', { stdio: 'pipe' });
      execSync('bun install', { stdio: 'pipe' });
      this.currentVersion = this.latestVersion;
      logger.info('[AutoUpdater] 更新完成');
      return true;
    } catch (e) {
      logger.error('[AutoUpdater] 更新失败', { error: String(e) });
      return false;
    }
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }

  private detectVersion(): string {
    // KB-AUTOUPDATE-PATH（2026-08-29）：版本文件在 app/package.json（仓库根无 package.json），
    // 原实现读根目录恒返回 0.0.0
    const candidates = [
      join(resolveProjectRoot(), 'app', 'package.json'),
      join(resolveProjectRoot(), 'package.json'),
    ];
    for (const pkgPath of candidates) {
      if (!existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '0.0.0';
      } catch (e) {
        // KB-AUTOUPDATE-VER（2026-08-29）：package.json 读取/解析失败静默 0.0.0 →
        // 版本比较把当前版本当"不存在"，可能触发错误更新判定且无排查线索
        logger.warn('[AutoUpdater] 读取 package.json 失败，版本按 0.0.0 处理', {
          pkgPath,
          error: e instanceof Error ? e.message : String(e),
        });
        return '0.0.0';
      }
    }
    return '0.0.0';
  }

  private async fetchLatestVersion(): Promise<string> {
    // KB-AUTOUPDATE-FETCH（2026-08-29）：桩实现 → 真实获取远端版本号。
    // 与 apply() 的 git pull 机制一致：fetch 远端 main 后读远端 package.json 的 version。
    // 无 remote / 网络失败时返回当前版本（按无更新处理，check() 不误报）。
    try {
      execSync('git fetch origin main --quiet', {
        stdio: 'pipe',
        timeout: 30000,
      });
      const remotePkg = execSync('git show origin/main:app/package.json', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as unknown as string;
      const parsed = JSON.parse(remotePkg) as { version?: string };
      const version = parsed.version || this.currentVersion;
      logger.info('[AutoUpdater] 远端版本', {
        remote: version,
        current: this.currentVersion,
      });
      return version;
    } catch (e) {
      logger.warn('[AutoUpdater] 获取远端版本失败，按无更新处理', {
        error: e instanceof Error ? e.message : String(e),
      });
      return this.currentVersion;
    }
  }
}
