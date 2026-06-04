/**
 * 主题加载器
 *
 * 从内置主题目录和用户主题目录加载主题配置。
 * 内置主题路径：随项目发布的 themes/ 目录
 * 用户主题路径：~/.pyapp/themes/
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  ThemeDefinition,
  ThemeMetadata,
  validateThemeDefinition,
} from './ThemeSchema';
import { resolvePyappHome } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 内置主题目录（基于当前文件位置解析，独立于 CWD）
 */
const BUILTIN_THEMES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'builtin'
);

/**
 * 用户主题目录
 */
const USER_THEMES_DIR = join(resolvePyappHome(), 'themes');

/**
 * 主题加载器
 */
export class ThemeLoader {
  private builtinThemes: Map<string, ThemeDefinition> = new Map();
  private userThemes: Map<string, ThemeDefinition> = new Map();
  private initialized = false;

  /**
   * 初始化主题加载器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.ensureDirectories();
    await this.loadBuiltinThemes();
    await this.loadUserThemes();

    this.initialized = true;
    logger.info(
      `主题加载完成：${this.builtinThemes.size} 个内置主题，${this.userThemes.size} 个用户主题`
    );
  }

  /**
   * 确保主题目录存在
   */
  private async ensureDirectories(): Promise<void> {
    if (!existsSync(USER_THEMES_DIR)) {
      mkdirSync(USER_THEMES_DIR, { recursive: true });
    }
  }

  /**
   * 加载内置主题
   */
  private async loadBuiltinThemes(): Promise<void> {
    if (existsSync(BUILTIN_THEMES_DIR)) {
      const files = readdirSync(BUILTIN_THEMES_DIR);
      for (const file of files) {
        if (extname(file).toLowerCase() !== '.json') continue;

        const theme = this.loadThemeFile(join(BUILTIN_THEMES_DIR, file));
        if (theme) {
          this.builtinThemes.set(theme.name, theme);
        }
      }
    }
  }

  /**
   * 加载用户主题
   */
  private async loadUserThemes(): Promise<void> {
    if (existsSync(USER_THEMES_DIR)) {
      const files = readdirSync(USER_THEMES_DIR);
      for (const file of files) {
        if (extname(file).toLowerCase() !== '.json') continue;

        const theme = this.loadThemeFile(join(USER_THEMES_DIR, file));
        if (theme) {
          this.userThemes.set(theme.name, theme);
        }
      }
    }
  }

  /**
   * 从文件加载单个主题
   */
  private loadThemeFile(filePath: string): ThemeDefinition | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as ThemeDefinition;

      const validation = validateThemeDefinition(data);
      if (!validation.valid) {
        logger.warning(`主题文件 ${basename(filePath)} 验证失败`, {
          errors: validation.errors,
        });
        return null;
      }

      return data;
    } catch (error) {
      logger.warning(
        `无法加载主题文件 ${basename(filePath)}`,
        error instanceof Error ? error : undefined
      );
      return null;
    }
  }

  /**
   * 注册内置主题（编程方式）
   */
  registerBuiltinTheme(theme: ThemeDefinition): void {
    const validation = validateThemeDefinition(theme);
    if (!validation.valid) {
      logger.warning(`内置主题 ${theme.name} 注册失败`, {
        errors: validation.errors,
      });
      return;
    }

    this.builtinThemes.set(theme.name, theme);
  }

  /**
   * 获取内置主题
   */
  getBuiltinTheme(name: string): ThemeDefinition | undefined {
    return this.builtinThemes.get(name);
  }

  /**
   * 获取用户主题
   */
  getUserTheme(name: string): ThemeDefinition | undefined {
    return this.userThemes.get(name);
  }

  /**
   * 获取所有主题（内置 + 用户合并，同名用户主题覆盖内置）
   */
  getAllThemes(): Map<string, ThemeDefinition> {
    const merged = new Map(this.builtinThemes);
    for (const [name, theme] of this.userThemes) {
      merged.set(name, theme);
    }
    return merged;
  }

  /**
   * 获取所有主题元数据
   */
  getAllThemeMetadata(): ThemeMetadata[] {
    const metadata: ThemeMetadata[] = [];

    for (const [name, theme] of this.builtinThemes) {
      metadata.push({
        name,
        displayName: theme.displayName || name,
        description: theme.description || '',
        type: (theme.type as 'light' | 'dark') || 'dark',
        author: theme.author || 'Liri',
        version: theme.version || '1.0.0',
        isBuiltIn: true,
      });
    }

    for (const [name, theme] of this.userThemes) {
      metadata.push({
        name,
        displayName: theme.displayName || name,
        description: theme.description || '',
        type: (theme.type as 'light' | 'dark') || 'dark',
        author: theme.author || '未知',
        version: theme.version || '1.0.0',
        isBuiltIn: false,
        filePath: join(USER_THEMES_DIR, `${name}.json`),
      });
    }

    return metadata.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 获取主题
   */
  getTheme(name: string): ThemeDefinition | undefined {
    return this.userThemes.get(name) || this.builtinThemes.get(name);
  }

  /**
   * 保存用户主题
   */
  saveUserTheme(theme: ThemeDefinition): boolean {
    try {
      if (!existsSync(USER_THEMES_DIR)) {
        mkdirSync(USER_THEMES_DIR, { recursive: true });
      }

      const filePath = join(USER_THEMES_DIR, `${theme.name}.json`);
      writeFileSync(filePath, JSON.stringify(theme, null, 2), 'utf-8');

      this.userThemes.set(theme.name, theme);
      logger.info(`用户主题已保存：${theme.name}`);
      return true;
    } catch (error) {
      logger.error(
        `保存用户主题失败：${theme.name}`,
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * 删除用户主题
   */
  deleteUserTheme(name: string): boolean {
    try {
      const filePath = join(USER_THEMES_DIR, `${name}.json`);
      if (!existsSync(filePath)) return false;

      unlinkSync(filePath);

      this.userThemes.delete(name);
      logger.info(`用户主题已删除：${name}`);
      return true;
    } catch (error) {
      logger.error(
        `删除用户主题失败：${name}`,
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * 从文件导入主题
   */
  importThemeFromFile(filePath: string): ThemeDefinition | null {
    const theme = this.loadThemeFile(filePath);
    if (!theme) return null;

    if (this.builtinThemes.has(theme.name)) {
      logger.warning(`主题名称 "${theme.name}" 与内置主题冲突，无法导入`);
      return null;
    }

    return theme;
  }

  /**
   * 获取用户主题目录路径
   */
  getUserThemesDir(): string {
    return USER_THEMES_DIR;
  }

  /**
   * 获取内置主题数量
   */
  getBuiltinCount(): number {
    return this.builtinThemes.size;
  }

  /**
   * 获取用户主题数量
   */
  getUserCount(): number {
    return this.userThemes.size;
  }

  /**
   * 是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
