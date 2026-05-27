/**
 * 环境变量管理工具
 * 提供环境变量的处理和管理功能
 * 参考CC源码: cc_code/backend/utils/subprocessEnv.ts
 */

import { platform, homedir } from 'os';
import { join, sep, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

/**
 * 环境变量选项
 */
export interface EnvOptions {
  pluginOptions?: Record<string, string>;
  skillRoot?: string;
  sessionId?: string;
  workspaceRoot?: string;
  isNonInteractive?: boolean;
  [key: string]: any;
}

/**
 * 平台信息
 */
interface PlatformInfo {
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  platform: string;
  shell: string;
}

/**
 * 环境变量管理类
 */
class EnvironmentManager {
  private static instance: EnvironmentManager;
  private envCache: Map<string, Record<string, string>> = new Map();
  private platformInfo: PlatformInfo;

  private constructor() {
    this.platformInfo = this.detectPlatform();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): EnvironmentManager {
    if (!EnvironmentManager.instance) {
      EnvironmentManager.instance = new EnvironmentManager();
    }
    return EnvironmentManager.instance;
  }

  /**
   * 检测平台信息
   */
  private detectPlatform(): PlatformInfo {
    const plat = platform();
    const isWindows = plat === 'win32';
    const isMac = plat === 'darwin';
    const isLinux = plat === 'linux';

    let shell = process.env.SHELL || process.env.COMSPEC || '/bin/sh';
    if (isWindows && !shell.includes('cmd.exe') && !shell.includes('powershell')) {
      shell = process.env.COMSPEC || 'cmd.exe';
    }

    return {
      isWindows,
      isMac,
      isLinux,
      platform: plat,
      shell,
    };
  }

  /**
   * 构建环境变量
   */
  buildEnvironment(options: EnvOptions = {}): Record<string, string> {
    const cacheKey = this.generateCacheKey(options);

    // 检查缓存
    if (this.envCache.has(cacheKey)) {
      return { ...this.envCache.get(cacheKey)! };
    }

    // 基础环境变量
    const env: Record<string, string> = {
      ...process.env,
    };

    // PY_APP特定的环境变量
    env.PY_APP_HOME = this.getPyAppHome();
    env.PY_APP_SESSION_ID = options.sessionId || '';
    env.PY_APP_PLATFORM = this.platformInfo.platform;
    env.PY_APP_SHELL = this.platformInfo.shell;
    env.PY_APP_IS_INTERACTIVE = process.env.TERM ? 'true' : 'false';
    env.PY_APP_HOME_DIR = homedir();
    env.PY_APP_TERM = process.env.TERM || '';
    env.PY_APP_TERM_PROGRAM = process.env.TERM_PROGRAM || '';

    // 工作区根目录
    if (options.workspaceRoot) {
      env.PY_APP_WORKSPACE = options.workspaceRoot;
      env.PY_APP_WORKSPACE_URI = this.pathToUri(options.workspaceRoot);
    }

    // 技能根目录
    if (options.skillRoot) {
      env.PY_APP_SKILL_ROOT = options.skillRoot;
      env.PY_APP_SKILL_ROOT_URI = this.pathToUri(options.skillRoot);
    }

    // 会话特定目录
    if (options.sessionId) {
      env.PY_APP_SESSION_DIR = this.getSessionDir(options.sessionId);
    }

    // 非交互模式标志
    if (options.isNonInteractive !== undefined) {
      env.PY_APP_NON_INTERACTIVE = options.isNonInteractive ? 'true' : 'false';
    }

    // 添加插件选项作为环境变量
    if (options.pluginOptions) {
      this.addPluginOptions(env, options.pluginOptions);
    }

    // 跨平台路径转换
    this.normalizePaths(env);

    // 安全处理
    this.sanitizeEnvironment(env);

    // 缓存结果
    this.envCache.set(cacheKey, { ...env });

    return env;
  }

  /**
   * 添加插件选项到环境变量
   */
  private addPluginOptions(env: Record<string, string>, pluginOptions: Record<string, string>): void {
    for (const [key, value] of Object.entries(pluginOptions)) {
      const envKey = `PY_APP_PLUGIN_${this.normalizeEnvKey(key)}`;
      env[envKey] = value;

      // 同时添加原始键名
      env[`PY_APP_PLUGIN_${key}`] = value;
    }

    // 添加所有插件选项的JSON表示
    env.PY_APP_PLUGIN_OPTIONS = JSON.stringify(pluginOptions);
  }

  /**
   * 标准化环境变量键名
   */
  private normalizeEnvKey(key: string): string {
    return key
      .toUpperCase()
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/__+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(options: EnvOptions): string {
    const parts = [
      options.sessionId || '',
      options.skillRoot || '',
      options.workspaceRoot || '',
      JSON.stringify(options.pluginOptions || {}),
      String(options.isNonInteractive || false),
    ];
    return parts.join('|');
  }

  /**
   * 获取PY_APP_HOME路径
   */
  private getPyAppHome(): string {
    const __dirname = this.getDirname(import.meta.url);
    return join(__dirname, '..', '..', '..');
  }

  /**
   * 获取会话目录
   */
  private getSessionDir(sessionId: string): string {
    const __dirname = this.getDirname(import.meta.url);
    return join(__dirname, '..', '..', '..', 'sessions', sessionId);
  }

  /**
   * 获取目录名
   */
  private getDirname(path: string): string {
    const normalized = path.replace(/^file:\/\/\//, '/').replace(/\\/g, '/');
    return normalized.substring(0, normalized.lastIndexOf('/'));
  }

  /**
   * 路径转换为URI
   */
  private pathToUri(pathStr: string): string {
    if (this.platformInfo.isWindows) {
      return `file:///${pathStr.replace(/\\/g, '/')}`;
    }
    return `file://${pathStr}`;
  }

  /**
   * URI转换为路径
   */
  private uriToPath(uri: string): string {
    if (this.platformInfo.isWindows && uri.startsWith('file:///')) {
      return uri.replace(/^file:\/\/\//, '').replace(/\//g, '\\');
    }
    return uri.replace(/^file:\/\//, '');
  }

  /**
   * 跨平台路径转换
   */
  private normalizePaths(env: Record<string, string>): void {
    const pathSeparator = this.platformInfo.isWindows ? ';' : ':';

    for (const [key, value] of Object.entries(env)) {
      if (!value) continue;

      // 处理PATH类环境变量
      if (key.toLowerCase().includes('path') && key !== 'PATHEXT') {
        const paths = value.split(pathSeparator).map(p => this.convertPath(p));
        env[key] = paths.join(pathSeparator);
        continue;
      }

      // 处理其他路径变量
      if (
        key.includes('HOME') ||
        key.includes('DIR') ||
        key.includes('PATH') ||
        key.includes('ROOT') ||
        key.includes('CWD')
      ) {
        if (isAbsolute(value)) {
          env[key] = this.convertPath(value);
        }
      }
    }

    // 确保PATH存在
    if (!env.PATH) {
      env.PATH = this.platformInfo.isWindows
        ? `${process.env.SystemRoot || 'C:\\Windows'}\\system32`
        : '/usr/local/bin:/usr/bin:/bin';
    }
  }

  /**
   * 转换路径分隔符
   */
  private convertPath(pathStr: string): string {
    if (!pathStr) return pathStr;

    // Windows路径转换为POSIX
    if (this.platformInfo.isWindows) {
      return pathStr.replace(/\//g, '\\');
    }

    // POSIX路径转换
    return pathStr.replace(/\\/g, '/');
  }

  /**
   * 安全处理环境变量
   */
  private sanitizeEnvironment(env: Record<string, string>): void {
    // 移除敏感信息
    const sensitiveKeys = [
      'PASSWORD',
      'TOKEN',
      'SECRET',
      'KEY',
      'AUTH',
      'CREDENTIAL',
      'PRIVATE',
    ];

    const sensitivePatterns = [
      /api[_-]?key/i,
      /access[_-]?token/i,
      /auth[_-]?token/i,
      /bearer/i,
    ];

    for (const key of Object.keys(env)) {
      const upperKey = key.toUpperCase();

      // 检查是否包含敏感键
      let isSensitive = false;
      for (const sensitive of sensitiveKeys) {
        if (upperKey.includes(sensitive)) {
          isSensitive = true;
          break;
        }
      }

      // 检查是否匹配敏感模式
      if (!isSensitive) {
        for (const pattern of sensitivePatterns) {
          if (pattern.test(key)) {
            isSensitive = true;
            break;
          }
        }
      }

      if (isSensitive) {
        env[key] = '***REDACTED***';
      }
    }

    // 清理空值环境变量
    for (const key of Object.keys(env)) {
      if (env[key] === '' || env[key] === undefined) {
        delete env[key];
      }
    }
  }

  /**
   * 获取平台信息
   */
  getPlatformInfo(): PlatformInfo {
    return { ...this.platformInfo };
  }

  /**
   * 无效化环境缓存
   */
  invalidateCache(): void {
    this.envCache.clear();
  }

  /**
   * 为特定会话无效化缓存
   */
  invalidateSessionCache(sessionId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.envCache.keys()) {
      if (key.includes(sessionId)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.envCache.delete(key);
    }
  }

  /**
   * 获取环境变量统计
   */
  getStats(): {
    cacheSize: number;
    platform: string;
    home: string;
    isWindows: boolean;
    isMac: boolean;
    isLinux: boolean;
  } {
    return {
      cacheSize: this.envCache.size,
      platform: this.platformInfo.platform,
      home: this.getPyAppHome(),
      isWindows: this.platformInfo.isWindows,
      isMac: this.platformInfo.isMac,
      isLinux: this.platformInfo.isLinux,
    };
  }

  /**
   * 验证路径是否安全（不超出工作区）
   */
  validatePath(pathStr: string, workspaceRoot?: string): boolean {
    if (!workspaceRoot) {
      return true;
    }

    try {
      const resolved = resolve(pathStr);
      const resolvedRoot = resolve(workspaceRoot);
      return resolved.startsWith(resolvedRoot);
    } catch {
      return false;
    }
  }

  /**
   * 获取相对于工作区的路径
   */
  getRelativePath(pathStr: string, workspaceRoot?: string): string {
    if (!workspaceRoot) {
      return pathStr;
    }

    try {
      const resolved = resolve(pathStr);
      const resolvedRoot = resolve(workspaceRoot);
      if (resolved.startsWith(resolvedRoot)) {
        return resolved.substring(resolvedRoot.length).replace(/^[\\/]/, '');
      }
    } catch {
      // 忽略错误
    }

    return pathStr;
  }

  /**
   * 扩展PATH环境变量
   */
  expandPath(existingPath: string, newPaths: string[]): string {
    const separator = this.platformInfo.isWindows ? ';' : ':';
    const paths = existingPath.split(separator).filter(p => p && existsSync(p));
    for (const newPath of newPaths) {
      if (existsSync(newPath) && !paths.includes(newPath)) {
        paths.push(newPath);
      }
    }
    return paths.join(separator);
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.envCache.clear();
  }
}

/**
 * 导出单例
 */
EnvironmentManager.instance = new EnvironmentManager();

export { EnvironmentManager };
export const environmentManager = EnvironmentManager.getInstance();
