/**
 * 插件存储
 * 负责管理插件的安装、卸载和存储路径
 */

import {
  existsSync,
  readdirSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';

/**
 * 插件存储
 */
export class PluginStore {
  /**
   * 插件目录
   */
  private pluginsDir: string;

  /**
   * 构造函数
   * @param pluginsDir 插件目录路径
   */
  constructor(pluginsDir: string) {
    this.pluginsDir = resolve(pluginsDir);
    this.ensurePluginsDir();
  }

  /**
   * 确保插件目录存在
   */
  private ensurePluginsDir(): void {
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true });
    }
  }

  /**
   * 获取已安装插件
   * @returns 插件ID列表
   */
  async getInstalledPlugins(): Promise<string[]> {
    try {
      const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
      const plugins: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = join(this.pluginsDir, entry.name);
          if (existsSync(join(pluginPath, 'package.json'))) {
            plugins.push(entry.name);
          }
        }
      }

      return plugins;
    } catch (error) {
      console.error('Error getting installed plugins:', error);
      return [];
    }
  }

  /**
   * 安装插件
   * @param pluginPath 插件路径
   * @returns 安装的插件ID
   */
  async installPlugin(pluginPath: string): Promise<string> {
    try {
      // 读取插件的package.json
      const packageJsonPath = join(pluginPath, 'package.json');
      if (!existsSync(packageJsonPath)) {
        throw new Error('package.json not found in plugin');
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const pluginId = packageJson.name;

      if (!pluginId) {
        throw new Error('Plugin name not found in package.json');
      }

      // 目标路径
      const targetPath = join(this.pluginsDir, pluginId);

      // 移除已存在的插件
      if (existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true });
      }

      // 创建目标目录
      mkdirSync(targetPath, { recursive: true });

      // 复制插件文件（简化实现，仅复制package.json和src目录）
      this.copyFile(packageJsonPath, join(targetPath, 'package.json'));

      const srcPath = join(pluginPath, 'src');
      if (existsSync(srcPath)) {
        this.copyDirectory(srcPath, join(targetPath, 'src'));
      }

      return pluginId;
    } catch (error) {
      console.error('Error installing plugin:', error);
      throw error;
    }
  }

  /**
   * 复制文件
   * @param source 源文件路径
   * @param target 目标文件路径
   */
  private copyFile(source: string, target: string): void {
    const content = readFileSync(source, 'utf8');
    writeFileSync(target, content, 'utf8');
  }

  /**
   * 复制目录
   * @param source 源目录路径
   * @param target 目标目录路径
   */
  private copyDirectory(source: string, target: string): void {
    mkdirSync(target, { recursive: true });

    const entries = readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = join(source, entry.name);
      const targetPath = join(target, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(sourcePath, targetPath);
      } else {
        this.copyFile(sourcePath, targetPath);
      }
    }
  }

  /**
   * 卸载插件
   * @param pluginId 插件ID
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    try {
      const pluginPath = join(this.pluginsDir, pluginId);

      if (existsSync(pluginPath)) {
        rmSync(pluginPath, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Error uninstalling plugin:', error);
      throw error;
    }
  }

  /**
   * 获取插件路径
   * @param pluginId 插件ID
   * @returns 插件路径
   */
  async getPluginPath(pluginId: string): Promise<string> {
    const pluginPath = join(this.pluginsDir, pluginId);

    if (!existsSync(pluginPath)) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    return pluginPath;
  }

  /**
   * 检查插件是否已安装
   * @param pluginId 插件ID
   * @returns 是否已安装
   */
  async isPluginInstalled(pluginId: string): Promise<boolean> {
    const pluginPath = join(this.pluginsDir, pluginId);
    return (
      existsSync(pluginPath) && existsSync(join(pluginPath, 'package.json'))
    );
  }

  /**
   * 获取插件存储目录
   * @returns 插件存储目录
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }
}

/**
 * 创建插件存储实例
 * @param pluginsDir 插件目录路径
 * @returns 插件存储实例
 */
export function createPluginStore(pluginsDir: string): PluginStore {
  return new PluginStore(pluginsDir);
}
