/**
 * 插件版本检查器
 * 负责检查插件更新和管理版本历史
 * 参考CC源码 cc_code/backend/utils/plugins/pluginVersioning.ts 实现
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '@modules/utils/log';

/**
 * 版本信息
 */
export interface VersionInfo {
  version: string;
  checkedAt: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  releaseNotes?: string;
}

/**
 * 更新检查结果
 */
export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  checkedAt: string;
}

/**
 * 版本比较结果
 */
export type VersionCompareResult = -1 | 0 | 1;

/**
 * 插件版本管理器
 */
export class PluginVersionManager {
  private versionCache: Map<string, VersionInfo> = new Map();
  private versionHistory: Map<string, string[]> = new Map();

  /**
   * 从版本字符串解析主版本号
   */
  parseMajor(version: string): number {
    const match = version.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * 从版本字符串解析次版本号
   */
  parseMinor(version: string): number {
    const match = version.match(/^\d+\.(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * 从版本字符串解析补丁版本号
   */
  parsePatch(version: string): number {
    const match = version.match(/^\d+\.\d+\.(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * 比较两个版本
   * @returns -1: a < b, 0: a == b, 1: a > b
   */
  compareVersions(a: string, b: string): VersionCompareResult {
    const aParts = [this.parseMajor(a), this.parseMinor(a), this.parsePatch(a)];
    const bParts = [this.parseMajor(b), this.parseMinor(b), this.parsePatch(b)];

    for (let i = 0; i < 3; i++) {
      if (aParts[i] < bParts[i]) return -1;
      if (aParts[i] > bParts[i]) return 1;
    }

    return 0;
  }

  /**
   * 检查是否有可用更新
   */
  hasUpdate(currentVersion: string, latestVersion: string): boolean {
    return this.compareVersions(latestVersion, currentVersion) === 1;
  }

  /**
   * 获取缓存的版本信息
   */
  getCachedVersion(pluginId: string): VersionInfo | undefined {
    return this.versionCache.get(pluginId);
  }

  /**
   * 更新版本缓存
   */
  updateCache(pluginId: string, info: VersionInfo): void {
    this.versionCache.set(pluginId, info);
    this.addToHistory(pluginId, info.version);
  }

  /**
   * 添加到版本历史
   */
  private addToHistory(pluginId: string, version: string): void {
    const history = this.versionHistory.get(pluginId) || [];
    if (!history.includes(version)) {
      history.push(version);
      this.versionHistory.set(pluginId, history);
    }
  }

  /**
   * 获取版本历史
   */
  getVersionHistory(pluginId: string): string[] {
    return this.versionHistory.get(pluginId) || [];
  }

  /**
   * 清除版本缓存
   */
  clearCache(pluginId?: string): void {
    if (pluginId) {
      this.versionCache.delete(pluginId);
    } else {
      this.versionCache.clear();
    }
  }

  /**
   * 清除版本历史
   */
  clearHistory(pluginId?: string): void {
    if (pluginId) {
      this.versionHistory.delete(pluginId);
    } else {
      this.versionHistory.clear();
    }
  }

  /**
   * 计算插件版本（基于Git）
   */
  async calculateVersionFromGit(repoPath: string): Promise<string> {
    try {
      const { execSync } = await import('child_process');
      const sha = execSync('git rev-parse HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();
      return sha.substring(0, 12);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to get git version:', e);
      return 'unknown';
    }
  }

  /**
   * 计算插件版本（基于文件内容）
   */
  async calculateVersionFromContent(dirPath: string): Promise<string> {
    try {
      const files = await this.getDirectoryFiles(dirPath);
      const hash = createHash('sha256');

      for (const file of files.sort()) {
        const content = await readFile(join(dirPath, file));
        hash.update(content);
      }

      return hash.digest('hex').substring(0, 12);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to calculate version from content:', e);
      return 'unknown';
    }
  }

  /**
   * 获取目录下的所有文件
   */
  private async getDirectoryFiles(
    dir: string,
    base: string = ''
  ): Promise<string[]> {
    const files: string[] = [];
    const { readdir, stat } = await import('fs/promises');
    const { join } = await import('path');

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = base ? `${base}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (entry.name !== '.git') {
            const subFiles = await this.getDirectoryFiles(
              fullPath,
              relativePath
            );
            files.push(...subFiles);
          }
        } else {
          files.push(relativePath);
        }
      }
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to read directory ${dir}:`, e);
    }

    return files;
  }

  /**
   * 检查版本是否兼容
   */
  isCompatible(version: string, requiredVersion: string): boolean {
    if (requiredVersion.startsWith('^')) {
      const required = requiredVersion.substring(1);
      return (
        this.compareVersions(version, required) >= 0 &&
        this.parseMajor(version) === this.parseMajor(required)
      );
    }

    if (requiredVersion.startsWith('~')) {
      const required = requiredVersion.substring(1);
      return (
        this.compareVersions(version, required) >= 0 &&
        this.parseMajor(version) === this.parseMajor(required) &&
        this.parseMinor(version) === this.parseMinor(required)
      );
    }

    if (requiredVersion.startsWith('>=')) {
      return this.compareVersions(version, requiredVersion.substring(2)) >= 0;
    }

    if (requiredVersion.startsWith('>')) {
      return this.compareVersions(version, requiredVersion.substring(1)) > 0;
    }

    return this.compareVersions(version, requiredVersion) === 0;
  }
}

/**
 * 导出单例
 */
/**
 * 计算插件版本
 * @param manifest 插件清单
 * @returns 版本号
 */
export function calculatePluginVersion(manifest: { version?: string }): string {
  return manifest.version || '0.0.0';
}

export const pluginVersionManager = new PluginVersionManager();
