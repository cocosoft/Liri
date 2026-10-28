/**
 * PluginInstallManager 插件安装管理器
 * 处理插件的安装、更新、卸载流程，支持多源安装和依赖处理
 */
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { resolvePluginsInstalledDir } from '@modules/environment';
import { PluginRegistry } from '../core/PluginRegistry.js';
import { NpmDistributor } from '../distribution/NpmDistributor.js';
import { pluginSecurityScanner } from '../utils/pluginSecurityScanner.js';
import {
  describeCapabilityDenial,
  resolvePluginCapabilities,
} from '../utils/pluginCapabilities.js';
import { checkPluginSignature } from '../utils/pluginSignature.js';
import { installPythonPlugin } from './PythonPluginInstaller.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('plugins:install:PluginInstallManager');

/**
 * 异步执行（阻塞源收敛 2026-10-04，台账 V-2）：`git clone` 原用 `execSync` 同步阻塞（超时 120s）。
 * `installFromGit` 本就是 async ⇒ 改 `promisify(exec)`，零签名变化。
 */
const execAsync = promisify(exec);

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
    // 能力回滚只允许删「本次新建」且在受管目录内的目标（见 discardInstalledDir）
    const targetExistedBefore = fs.existsSync(targetPath);
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

    // PY-6：Python 插件安装依赖（venv）+ 生成 plugin.json 桥接清单（已定案 b）
    const pythonInstall = await this.installPythonIfNeeded(targetPath);
    if (pythonInstall && !pythonInstall.success) {
      return {
        success: false,
        pluginName: options.sourcePath,
        version: options.version || 'unknown',
        installPath: targetPath,
        error: pythonInstall.error ?? 'Python 插件安装失败',
      };
    }

    // ── T25-08 P2（2026-10-25）：能力授权（spec §6「未授权能力 ⇒ 拒绝安装」）──
    // 授权表未配置 ⇒ 零行为变更；配置后 fail-closed：声明了但未授权 ⇒ 拒绝，并**仅**回滚
    // 「本次新建且在受管目录内」的目标（不删用户既有目录，见 discardInstalledDir）。
    // 签名校验（默认关）与能力闸共用这段回滚逻辑。
    const gateError =
      this.checkCapabilities(targetPath) ?? this.checkSignature(targetPath);
    if (gateError) {
      const discarded = this.discardInstalledDir(
        targetPath,
        targetExistedBefore
      );
      return {
        success: false,
        pluginName: options.sourcePath,
        version: options.version || 'unknown',
        installPath: '',
        error: discarded
          ? `${gateError}（已回滚本次写入的安装目录）`
          : `${gateError}（安装目录未删除：非本次新建或不在插件安装根目录内，请自行处理）`,
      };
    }

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
   * PY-6：检测并安装 Python 插件（manifest 含 entry.python / type=python）
   * @param targetPath 插件安装目录
   * @returns 安装结果（非 Python 插件返回 undefined）
   */
  private async installPythonIfNeeded(
    targetPath: string
  ): Promise<ReturnType<typeof installPythonPlugin> | undefined> {
    const manifestPath = path.join(targetPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) return undefined;

    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const base =
        parsed && typeof parsed.plugin === 'object' && parsed.plugin !== null
          ? parsed.plugin
          : parsed;
      const isPython = base?.entry?.python || base?.type === 'python';
      if (!isPython) return undefined;
      return await installPythonPlugin(targetPath, base);
    } catch (error) {
      logger.warn('Python 插件检测失败', { targetPath, error });
      return undefined;
    }
  }

  /**
   * T25-08 P2：安装后的**能力授权**检查（纯读清单，不改动文件）。
   *
   * - 无 `plugin.json` ⇒ 放行（无清单的目录不会被 `PluginLoader` 发现，不构成运行时入口）；
   * - 清单解析失败 / 声明了未授权能力 ⇒ 返回拒绝原因（调用方负责清理刚落盘的目录）。
   */
  private checkCapabilities(targetPath: string): string | null {
    const manifestPath = path.join(targetPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) return null;

    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const base =
        parsed && typeof parsed.plugin === 'object' && parsed.plugin !== null
          ? parsed.plugin
          : parsed;
      const pluginId =
        typeof base?.id === 'string' && base.id
          ? base.id
          : path.basename(targetPath);
      const decision = resolvePluginCapabilities(pluginId, base?.capabilities);
      if (decision.allowed) return null;
      const denial = describeCapabilityDenial(decision);
      logger.warn('plugins:install:capability_denied — 安装被拒', {
        pluginId,
        targetPath,
        declared: decision.declared,
        missing: decision.missing,
        unknown: decision.unknown,
        malformed: decision.malformed,
      });
      return `插件「${pluginId}」能力校验未通过，已取消安装：${denial}`;
    } catch (error) {
      return `插件清单解析失败（plugin.json）：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * T25-08 P2：安装后的**清单签名**检查（信任锚即开；显式 false 可关）。
   *
   * 与加载器共用 `checkPluginSignature`：覆盖“装进来”和“已经有”的两条路径。
   */
  private checkSignature(targetPath: string): string | null {
    const decision = checkPluginSignature({ pluginDir: targetPath });
    if (decision.allowed) return null;
    logger.warn('plugins:install:signature_denied — 安装被拒', {
      targetPath,
      reason: decision.reason,
    });
    return `插件清单签名校验未通过，已取消安装：${decision.reason ?? '未知原因'}`;
  }

  /**
   * 丢弃**本次安装**刚落盘的目录（能力校验未通过时回滚）。
   *
   * 安全边界（CD：删除只作用于自己创建的东西）：
   * - `existedBefore === true` ⇒ **不删**（那是用户既有目录，可能是升级前版本或别处数据）；
   * - 目标不在插件安装根目录内（`options.installPath` 指到外面）⇒ **不删**；
   * - 删除失败仅告警，不覆盖掉安装错误。
   *
   * @returns 是否真的删除了目录
   */
  private discardInstalledDir(
    targetPath: string,
    existedBefore: boolean
  ): boolean {
    if (existedBefore) {
      logger.warn('能力校验未通过：目标目录为既有目录 ⇒ 不删除', {
        targetPath,
      });
      return false;
    }
    const base = path.resolve(this.installPaths.getBasePath());
    const target = path.resolve(targetPath);
    const rel = path.relative(base, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      logger.warn('能力校验未通过：目标不在插件安装根目录内 ⇒ 不删除', {
        targetPath,
        base,
      });
      return false;
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch (error) {
      logger.warn('能力校验未通过后清理安装目录失败', {
        targetPath,
        error: String(error),
      });
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

    await execAsync(`git clone ${cloneUrl} ${targetPath}`, {
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
