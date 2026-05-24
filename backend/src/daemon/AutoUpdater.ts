import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

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
    const pkgPath = join(process.cwd(), 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '0.0.0';
      } catch {
        return '0.0.0';
      }
    }
    return '0.0.0';
  }

  private async fetchLatestVersion(): Promise<string> {
    return '0.0.0';
  }
}
