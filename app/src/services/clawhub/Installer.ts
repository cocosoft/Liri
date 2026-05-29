/**
 * Installer
 * 技能安装器，负责从远程源下载技能文件、解析清单、写入本地存储。
 * 支持安装、卸载、更新和依赖检查。
 */

import https from 'node:https';
import http from 'node:http';
import { join, basename, extname, dirname } from 'path';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  copyFileSync,
} from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { LocalSkillStore } from './LocalSkillStore';
import type { InstalledSkill, ClawHubSkillMeta } from './ClawHubAdapter';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 清单文件名常量
 */
const MANIFEST_JSON = 'claw.json';
const MANIFEST_YAML = 'skill.yaml';

/**
 * Installer 配置
 */
export interface InstallerConfig {
  /** ClawHub API 基础地址 */
  apiBaseUrl?: string;
  /** 请求超时（毫秒） */
  timeout?: number;
  /** 本地技能存储 */
  localStore?: LocalSkillStore;
}

/**
 * 安装选项
 */
export interface InstallOptions {
  /** 来源 URL */
  sourceUrl?: string;
  /** 是否跳过依赖检查 */
  skipDependencies?: boolean;
  /** 是否强制重新安装 */
  force?: boolean;
}

/**
 * 安装结果
 */
export interface InstallResult {
  skill: InstalledSkill;
  /** 是否是新安装 */
  isNew: boolean;
  /** 跳过的依赖 */
  skippedDeps?: string[];
}

/**
 * Installer
 * 技能安装器，管理技能的下载、安装、卸载和更新流程。
 */
export class Installer {
  private apiBaseUrl: string;
  private timeout: number;
  private localStore: LocalSkillStore;

  /**
   * 构造函数
   * @param config 安装器配置
   */
  constructor(config: InstallerConfig) {
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.clawhub.com/v1';
    this.timeout = config.timeout || 30000;
    this.localStore = config.localStore!;
  }

  /**
   * 安装技能
   * 从 ClawHub 市场下载并安装指定的技能
   * @param skillId 技能 ID
   * @param sourceUrl 自定义来源 URL（可选）
   * @param options 安装选项
   * @returns 安装后的技能信息
   */
  async install(
    skillId: string,
    sourceUrl?: string,
    options: InstallOptions = {}
  ): Promise<InstalledSkill> {
    const installPath = this.localStore.getSkillInstallPath(skillId);

    if (existsSync(installPath) && !options.force) {
      throw new Error(`技能已安装: ${skillId}（使用 force 选项强制重新安装）`);
    }

    logger.info(`开始安装技能: ${skillId}`);

    let metaData: ClawHubSkillMeta;

    if (sourceUrl) {
      metaData = await this.downloadFromUrl(skillId, sourceUrl, installPath);
    } else {
      metaData = await this.downloadFromMarket(skillId, installPath);
    }

    if (!options.skipDependencies && metaData.dependencies?.length) {
      await this.resolveDependencies(metaData.dependencies);
    }

    const installed: InstalledSkill = {
      meta: metaData,
      installPath,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      enabled: true,
      files: this.collectFiles(installPath),
      sourceUrl: sourceUrl || `${this.apiBaseUrl}/skills/${skillId}`,
    };

    logger.info(`技能安装完成: ${metaData.name}@${metaData.version}`);
    return installed;
  }

  /**
   * 卸载技能
   * @param skill 已安装的技能
   */
  async uninstall(skill: InstalledSkill): Promise<void> {
    const installPath = skill.installPath;

    if (existsSync(installPath)) {
      rmSync(installPath, { recursive: true, force: true });
      logger.info(`技能文件已删除: ${installPath}`);
    }

    logger.info(`技能已卸载: ${skill.meta.name}`);
  }

  /**
   * 更新技能
   * @param skillId 技能 ID
   * @param current 当前已安装的技能
   * @returns 更新后的技能信息
   */
  async update(
    skillId: string,
    current: InstalledSkill
  ): Promise<InstalledSkill> {
    logger.info(
      `开始更新技能: ${skillId}（当前版本: ${current.meta.version}）`
    );

    const installPath = this.localStore.getSkillInstallPath(skillId);

    const metaData = await this.downloadFromMarket(skillId, installPath);

    const updated: InstalledSkill = {
      meta: metaData,
      installPath,
      installedAt: current.installedAt,
      updatedAt: Date.now(),
      enabled: current.enabled,
      files: this.collectFiles(installPath),
      sourceUrl: current.sourceUrl,
    };

    logger.info(
      `技能更新完成: ${metaData.name} ${current.meta.version} → ${metaData.version}`
    );
    return updated;
  }

  /**
   * 从 ClawHub 市场下载技能
   * @param skillId 技能 ID
   * @param installPath 安装路径
   * @returns 技能元数据
   */
  private async downloadFromMarket(
    skillId: string,
    installPath: string
  ): Promise<ClawHubSkillMeta> {
    const manifestUrl = `${this.apiBaseUrl}/skills/${encodeURIComponent(skillId)}/download`;

    try {
      const data = await this.httpGet(manifestUrl);

      const meta: ClawHubSkillMeta = {
        id: data.id || skillId,
        name: data.name || skillId,
        version: data.version || '1.0.0',
        description: data.description || '',
        author: data.author || '',
        license: data.license,
        category: data.category,
        tags: data.tags || [],
        icon: data.icon,
        readme: data.readme,
        dependencies: data.dependencies,
        permissions: data.permissions,
        manifestVersion: data.manifestVersion || '1.0',
        source: 'third_party',
      };

      await this.writeSkillFiles(installPath, meta, data.files || {});

      return meta;
    } catch (error) {
      logger.error(`从市场下载技能失败: ${skillId}`, error as Error);
      throw new Error(`下载技能失败: ${skillId}`);
    }
  }

  /**
   * 从自定义 URL 下载技能
   * @param skillId 技能 ID
   * @param sourceUrl 来源 URL
   * @param installPath 安装路径
   * @returns 技能元数据
   */
  private async downloadFromUrl(
    skillId: string,
    sourceUrl: string,
    installPath: string
  ): Promise<ClawHubSkillMeta> {
    try {
      const data = await this.httpGet(sourceUrl);

      const meta: ClawHubSkillMeta = {
        id: data.id || skillId,
        name: data.name || skillId,
        version: data.version || '1.0.0',
        description: data.description || '',
        author: data.author || '',
        license: data.license,
        category: data.category,
        tags: data.tags || [],
        icon: data.icon,
        readme: data.readme,
        dependencies: data.dependencies,
        permissions: data.permissions,
        manifestVersion: data.manifestVersion || '1.0',
        source: 'third_party',
      };

      await this.writeSkillFiles(installPath, meta, data.files || {});

      return meta;
    } catch (error) {
      logger.error(`从 URL 下载技能失败: ${sourceUrl}`, error as Error);
      throw new Error(`从 URL 下载技能失败: ${sourceUrl}`);
    }
  }

  /**
   * 将技能文件写入本地存储
   * @param installPath 安装路径
   * @param meta 技能元数据
   * @param files 技能文件映射（文件名 → 内容）
   */
  private async writeSkillFiles(
    installPath: string,
    meta: ClawHubSkillMeta,
    files: Record<string, string>
  ): Promise<void> {
    if (!existsSync(installPath)) {
      mkdirSync(installPath, { recursive: true });
    }

    const manifestPath = join(installPath, MANIFEST_JSON);
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          claw: '1.0',
          skill: {
            id: meta.id,
            name: meta.name,
            version: meta.version,
            description: meta.description,
            author: meta.author,
            license: meta.license,
            category: meta.category,
            tags: meta.tags,
            icon: meta.icon,
            readme: meta.readme,
            dependencies: meta.dependencies,
            permissions: meta.permissions,
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(installPath, filePath);
      const dir = dirname(fullPath);

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(fullPath, content, 'utf-8');
    }
  }

  /**
   * 收集已安装的技能文件列表
   * @param installPath 安装路径
   * @returns 文件路径列表
   */
  private collectFiles(installPath: string): string[] {
    const files: string[] = [];

    if (!existsSync(installPath)) {
      return files;
    }

    const collect = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    };

    collect(installPath);
    return files;
  }

  /**
   * 解析技能依赖
   * 检查依赖是否已安装，未安装的自动安装
   * @param dependencies 依赖技能 ID 列表
   */
  private async resolveDependencies(dependencies: string[]): Promise<void> {
    const allSkills = await this.localStore.getAllSkills();
    const installedIds = new Set(allSkills.map((s) => s.meta.id));

    const missing = dependencies.filter((depId) => !installedIds.has(depId));

    for (const depId of missing) {
      try {
        logger.info(`正在安装依赖技能: ${depId}`);
        await this.install(depId, undefined, { skipDependencies: true });
      } catch (error) {
        logger.warn(`依赖技能安装失败: ${depId}`, error as Error);
      }
    }
  }

  /**
   * 检查技能更新
   * 查询远程市场获取最新版本号，与本地版本比较
   * @param skillId 技能 ID
   * @param currentVersion 当前版本号
   * @returns 更新信息（如有可用更新）
   */
  async checkUpdate(
    skillId: string,
    currentVersion: string
  ): Promise<{
    hasUpdate: boolean;
    latestVersion: string;
    currentVersion: string;
  } | null> {
    try {
      const url = `${this.apiBaseUrl}/skills/${encodeURIComponent(skillId)}/version`;
      const data = await this.httpGet(url);
      const latestVersion = data.version || data.latestVersion;

      if (!latestVersion) {
        return null;
      }

      const hasUpdate = this.compareVersions(latestVersion, currentVersion) > 0;

      return {
        hasUpdate,
        latestVersion,
        currentVersion,
      };
    } catch (error) {
      logger.warn(`检查技能更新失败: ${skillId}`, error as Error);
      return null;
    }
  }

  /**
   * 比较版本号
   * @param v1 版本 A
   * @param v2 版本 B
   * @returns 正数表示 v1 > v2，负数表示 v1 < v2，0 表示相等
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const a = parts1[i] || 0;
      const b = parts2[i] || 0;
      if (a !== b) {
        return a - b;
      }
    }

    return 0;
  }

  /**
   * 发起 HTTP GET 请求
   */
  private httpGet(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith('https');
      const client = isHttps ? https : http;

      const req = client.get(url, { timeout: this.timeout }, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(JSON.parse(body));
            } else {
              reject(
                new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)
              );
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时: ${url}`));
      });
    });
  }
}
