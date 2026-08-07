/**
 * PluginInstallManager 插件安装管理器
 * 处理插件的安装、更新、卸载流程，支持多源安装和依赖处理
 */
import path from 'path';
import fs from 'fs';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { resolvePluginsInstalledDir } from '@modules/core';
import { PluginRegistry } from '../core/PluginRegistry.js';
import { NpmDistributor } from '../distribution/NpmDistributor.js';
import { pluginSecurityScanner } from '../utils/pluginSecurityScanner.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'plugins:install:PluginInstallManager',
  level: LogLevel.INFO,
});

/**
 * 安装源类型
 */
export type InstallSource =
  | 'npm'
  | 'local'
  | 'git'
  | 'registry'
  | 'marketplace';

/**
 * 安装选项
 */
export interface InstallOptions {
  source: InstallSource;
  sourcePath: string;
  version?: string;
  skipDependencies?: boolean;
  skipSecurityScan?: boolean;
  force?: boolean;
  installPath?: string;
}

/**
 * 安装结果
 */
export interface InstallResult {
  success: boolean;
  pluginName: string;
  version: string;
  installPath: string;
  dependencies?: string[];
  warnings?: string[];
  error?: string;
}

/**
 * 安装历史记录
 */
export interface InstallRecord {
  pluginName: string;
  version: string;
  source: InstallSource;
  sourcePath: string;
  installPath: string;
  installedAt: number;
  updatedAt?: number;
}

/**
 * 插件安装路径管理器
 */
export class PluginInstallPaths {
  private basePath: string;

  constructor(basePath?: string) {
    // 2026-08-06 路径收敛：安装目录统一为 ~/.pyapp/plugins/installed
    this.basePath = basePath || resolvePluginsInstalledDir();
  }

  getBasePath(): string {
    return this.basePath;
  }

  getPluginPath(pluginName: string): string {
    return path.join(this.basePath, pluginName);
  }

  getConfigPath(pluginName: string): string {
    return path.join(this.getPluginPath(pluginName), 'config.json');
  }

  getManifestPath(pluginName: string): string {
    return path.join(this.getPluginPath(pluginName), 'plugin.json');
  }

  getDataPath(pluginName: string): string {
    return path.join(this.getPluginPath(pluginName), 'data');
  }

  ensureDirectories(pluginName: string): boolean {
    try {
      const pluginPath = this.getPluginPath(pluginName);
      fs.mkdirSync(pluginPath, { recursive: true });
      fs.mkdirSync(this.getDataPath(pluginName), { recursive: true });
      return true;
    } catch {
      // @ignore-catch — 安装/卸载操作失败返回 false（失败由调用方提示，不抛错）
      return false;
    }
  }
}

/**
 * 插件安装管理器
 */
export class PluginInstallManager {
  private registry: PluginRegistry;
  private npmDistributor: NpmDistributor;
  private installPaths: PluginInstallPaths;
  private installHistory: Map<string, InstallRecord> = new Map();
  private historyFile: string;

  constructor(
    registry: PluginRegistry,
    npmDistributor: NpmDistributor,
    installPaths?: PluginInstallPaths
  ) {
    this.registry = registry;
    this.npmDistributor = npmDistributor;
    this.installPaths = installPaths || new PluginInstallPaths();
    this.historyFile = path.join(
      this.installPaths.getBasePath(),
      '.install-history.json'
    );
    this.loadHistory();
  }

  /**
   * 安装插件
   */
  async install(options: InstallOptions): Promise<InstallResult> {
    const warnings: string[] = [];

    if (!options.skipSecurityScan) {
      const scanResult = await pluginSecurityScanner.scanPluginDir(
        options.sourcePath
      );
      if (!scanResult.safe) {
        return {
          success: false,
          pluginName: options.sourcePath,
          version: options.version || 'unknown',
          installPath: '',
          error: `安全扫描未通过: ${scanResult.issues?.map((i) => i.description).join(', ') || '未知风险'}`,
        };
      }
    }

    const targetPath =
      options.installPath ||
      this.installPaths.getPluginPath(this.sanitizeName(options.sourcePath));
    this.installPaths.ensureDirectories(this.sanitizeName(options.sourcePath));

    try {
      switch (options.source) {
        case 'npm':
          await this.installFromNpm(options, targetPath);
          break;
        case 'local':
          this.installFromLocal(options, targetPath);
          break;
        case 'git':
          await this.installFromGit(options, targetPath);
          break;
        case 'registry':
          await this.installFromRegistry(options, targetPath);
          break;
        case 'marketplace':
          await this.installFromMarketplace(options, targetPath);
          break;
      }
    } catch (err) {
      return {
        success: false,
        pluginName: options.sourcePath,
        version: options.version || 'unknown',
        installPath: targetPath,
        error: `安装失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 2026-08-06 清理：原 skipDependencies 依赖安装分支为死代码（deps 恒为空数组），已删除；依赖安装待插件依赖解析机制落地后接入

    const record: InstallRecord = {
      pluginName: options.sourcePath,
      version: options.version || '1.0.0',
      source: options.source,
      sourcePath: options.sourcePath,
      installPath: targetPath,
      installedAt: Date.now(),
    };

    this.installHistory.set(options.sourcePath, record);
    this.saveHistory();

    return {
      success: true,
      pluginName: options.sourcePath,
      version: options.version || '1.0.0',
      installPath: targetPath,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * 卸载插件
   */
  uninstall(pluginName: string): boolean {
    const record = this.installHistory.get(pluginName);
    if (!record) return false;

    try {
      fs.rmSync(record.installPath, { recursive: true, force: true });
      this.installHistory.delete(pluginName);
      this.saveHistory();
      return true;
    } catch {
      // @ignore-catch — 安装/卸载操作失败返回 false（失败由调用方提示，不抛错）
      return false;
    }
  }

  /**
   * 更新插件
   */
  async update(pluginName: string, version?: string): Promise<InstallResult> {
    const record = this.installHistory.get(pluginName);
    if (!record) {
      return {
        success: false,
        pluginName,
        version: version || 'unknown',
        installPath: '',
        error: '插件未安装',
      };
    }

    const result = await this.install({
      source: record.source,
      sourcePath: record.sourcePath,
      version: version || record.version,
      force: true,
      installPath: record.installPath,
    });

    if (result.success) {
      record.updatedAt = Date.now();
      record.version = result.version;
      this.saveHistory();
    }

    return result;
  }

  /**
   * 获取已安装插件列表
   */
  getInstalledPlugins(): InstallRecord[] {
    return Array.from(this.installHistory.values());
  }

  /**
   * 检查插件是否已安装
   */
  isInstalled(pluginName: string): boolean {
    return this.installHistory.has(pluginName);
  }

  /**
   * 从 NPM 安装
   */
  private async installFromNpm(
    options: InstallOptions,
    targetPath: string
  ): Promise<void> {
    await this.npmDistributor.install(options.sourcePath, options.version);
  }

  /**
   * 从本地安装
   */
  private installFromLocal(options: InstallOptions, targetPath: string): void {
    if (!fs.existsSync(options.sourcePath)) {
      throw new AppError(
        `本地路径不存在: ${options.sourcePath}`,
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { sourcePath: options.sourcePath }
      );
    }

    if (options.force && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    fs.cpSync(options.sourcePath, targetPath, { recursive: true });
  }

  /**
   * 从 Git 安装
   */
  private async installFromGit(
    options: InstallOptions,
    targetPath: string
  ): Promise<void> {
    const { execSync } = await import('child_process');
    const cloneUrl = options.version
      ? `${options.sourcePath}#${options.version}`
      : options.sourcePath;

    if (fs.existsSync(targetPath)) {
      if (!options.force) {
        throw new AppError(
          `目标路径已存在: ${targetPath}`,
          ErrorCategory.FILESYSTEM,
          ErrorSeverity.HIGH,
          'ENTITY_EXISTS',
          { targetPath }
        );
      }
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    execSync(`git clone ${cloneUrl} ${targetPath}`, {
      stdio: 'pipe',
      timeout: 120000,
    });
  }

  /**
   * 从注册表安装
   */
  private async installFromRegistry(
    options: InstallOptions,
    targetPath: string
  ): Promise<void> {
    const plugin = this.registry.getPlugin(options.sourcePath);
    if (!plugin) {
      throw new AppError(
        `注册表中未找到插件: ${options.sourcePath}`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { sourcePath: options.sourcePath }
      );
    }
    await this.installFromNpm(options, targetPath);
  }

  /**
   * 从市场安装
   */
  private async installFromMarketplace(
    options: InstallOptions,
    targetPath: string
  ): Promise<void> {
    await this.installFromNpm(options, targetPath);
  }

  /**
   * 清理插件名称
   */
  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }

  /**
   * 加载安装历史
   */
  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
        if (Array.isArray(data)) {
          for (const record of data) {
            this.installHistory.set(record.pluginName, record);
          }
        }
      }
    } catch {
      // @ignore-catch — 安装历史持久化失败清空内存态（非关键路径）
      this.installHistory.clear();
    }
  }

  /**
   * 保存安装历史
   */
  private saveHistory(): void {
    try {
      const data = Array.from(this.installHistory.values());
      fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
      fs.writeFileSync(
        this.historyFile,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch (err) {
      // 忽略保存错误

      handleError(err, { module: 'plugins:install', action: 'saveLockFile' });
    }
  }
}

export const pluginInstallPaths = new PluginInstallPaths();
