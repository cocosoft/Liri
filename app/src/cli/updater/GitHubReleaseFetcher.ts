/**
 * GitHub Release 信息获取器
 * 从 GitHub Releases API 获取最新版本信息
 */

import { Logger, LogLevel } from '@modules/monitoring';
import {
  getGitHubReleasesUrl,
  type UpdateChannel,
} from '../../constants/product';
/**
 * 版本更新信息
 */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog?: string[];
  downloadUrl?: string;
  releaseDate?: string;
  checksum?: string;
  releaseNotesUrl?: string;
  releaseChannel?: UpdateChannel;
}

const logger = new Logger({
  module: 'cli:updater:gitHubReleaseFetcher',
  level: LogLevel.INFO,
});

/**
 * GitHub API 返回的 Release 结构
 */
interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body: string | null;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
  prerelease: boolean;
}

/**
 * GitHub Release 获取器
 */
export class GitHubReleaseFetcher {
  private currentVersion: string;
  private channel: UpdateChannel;
  private requestTimeout: number;

  /**
   * @param currentVersion 当前版本号
   * @param channel 更新通道
   * @param requestTimeout 请求超时时间（毫秒）
   */
  constructor(
    currentVersion: string,
    channel: UpdateChannel = 'stable',
    requestTimeout: number = 10000
  ) {
    this.currentVersion = currentVersion;
    this.channel = channel;
    this.requestTimeout = requestTimeout;
  }

  /**
   * 从 GitHub 获取最新版本信息
   * @returns 更新信息
   */
  async fetchLatest(): Promise<UpdateInfo> {
    // 检查 GitHub Release 断路器状态
    const { CircuitBreaker } =
      await import('../../diagnostics/CircuitBreaker.js');
    const releaseBreaker = CircuitBreaker.getOrCreate('github-release', {
      maxFailures: 2,
      baseDelayMs: 30000,
      maxDelayMs: 600000,
    });
    if (releaseBreaker.isOpen()) {
      logger.info('GitHub Release 断路器已断开，跳过本次检查', {
        cooldown: releaseBreaker.getRemainingCooldown(),
      });
      return this.buildNoUpdateInfo();
    }

    try {
      const url = getGitHubReleasesUrl(this.channel);

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeout
      );

      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Liri-Updater/1.0.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 能收到 HTTP 响应说明服务可达，重置断路器
      releaseBreaker.recordSuccess();

      if (!response.ok) {
        if (response.status === 404) {
          logger.info(`GitHub Release 未找到（无可用版本）`);
        } else {
          logger.warning(`GitHub API 返回错误: ${response.status}`);
        }
        return this.buildNoUpdateInfo();
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      releaseBreaker.recordFailure();
      logger.info(`获取 GitHub Release 失败（非关键）`, { error });
      return this.buildNoUpdateInfo();
    }
  }

  /**
   * 解析 GitHub API 响应
   */
  private parseResponse(data: GitHubRelease | GitHubRelease[]): UpdateInfo {
    let release: GitHubRelease;

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return this.buildNoUpdateInfo();
      }
      release = data[0];
    } else {
      release = data;
    }

    const latestVersion = release.tag_name.replace(/^v/, '');
    const updateAvailable =
      this.compareVersions(latestVersion, this.currentVersion) > 0;

    const changelog = release.body
      ? release.body
          .split('\n')
          .filter((line) => line.startsWith('-') || line.startsWith('*'))
          .map((line) => line.replace(/^[-*]\s*/, ''))
          .slice(0, 20)
      : undefined;

    const asset = release.assets?.[0];

    return {
      currentVersion: this.currentVersion,
      latestVersion,
      updateAvailable,
      changelog,
      downloadUrl: asset?.browser_download_url || release.html_url,
      releaseDate: release.published_at,
      releaseNotesUrl: release.html_url,
      releaseChannel: this.channel,
    };
  }

  /**
   * 构建无更新信息
   */
  private buildNoUpdateInfo(): UpdateInfo {
    return {
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
      updateAvailable: false,
    };
  }

  /**
   * 比较两个版本号
   * @returns 正数表示 v1 > v2，负数表示 v1 < v2，0 表示相等
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 !== p2) return p1 - p2;
    }

    return 0;
  }
}
