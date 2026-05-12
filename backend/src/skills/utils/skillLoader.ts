/**
 * 技能加载器（基于CC源码增强）
 * 支持多目录加载、技能去重、缓存机制等功能
 */

import { readdir, stat, realpath } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { SkillParser, SkillSource, type SkillDefinition } from './skillParser';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 技能加载路径配置（基于CC源码）
 */
export interface SkillLoadPath {
  /**
   * 技能来源
   */
  source: SkillSource;

  /**
   * 目录路径
   */
  path: string;

  /**
   * 加载优先级
   */
  priority: number;

  /**
   * 是否启用
   */
  enabled: boolean;

  /**
   * 是否递归扫描
   */
  recursive?: boolean;
}

/**
 * 技能加载结果（基于CC源码）
 */
export interface SkillLoadResult {
  /**
   * 加载的技能定义
   */
  skills: SkillDefinition[];

  /**
   * 加载的目录数量
   */
  directoriesScanned: number;

  /**
   * 加载的技能文件数量
   */
  filesLoaded: number;

  /**
   * 错误信息
   */
  errors: string[];

  /**
   * 加载时间（毫秒）
   */
  loadTime: number;
}

/**
 * 技能缓存配置（基于CC源码）
 */
export interface SkillCacheConfig {
  /**
   * 是否启用缓存
   */
  enabled: boolean;

  /**
   * 缓存超时时间（毫秒）
   */
  timeout: number;

  /**
   * 最大缓存条目数
   */
  maxEntries: number;
}

/**
 * 技能加载器类（基于CC源码实现）
 */
export class SkillLoader {
  private parser: SkillParser;
  private loadPaths: SkillLoadPath[];
  private cacheConfig: SkillCacheConfig;
  private skillCache: Map<
    string,
    { skill: SkillDefinition; timestamp: number }
  > = new Map();

  constructor(config?: {
    loadPaths?: SkillLoadPath[];
    cacheConfig?: Partial<SkillCacheConfig>;
  }) {
    this.parser = new SkillParser();

    // 默认加载路径（基于CC源码）
    this.loadPaths = config?.loadPaths || this.getDefaultLoadPaths();

    // 默认缓存配置
    this.cacheConfig = {
      enabled: true,
      timeout: 5 * 60 * 1000, // 5分钟
      maxEntries: 1000,
      ...config?.cacheConfig,
    };
  }

  /**
   * 获取默认加载路径（基于CC源码）
   */
  private getDefaultLoadPaths(): SkillLoadPath[] {
    const homeDir = homedir();
    const currentDir = process.cwd();

    return [
      // 用户技能目录（最高优先级）
      {
        source: SkillSource.USER,
        path: join(homeDir, '.claude', 'skills'),
        priority: 100,
        enabled: true,
        recursive: true,
      },

      // 项目技能目录
      {
        source: SkillSource.PROJECT,
        path: join(currentDir, '.claude', 'skills'),
        priority: 90,
        enabled: true,
        recursive: true,
      },

      // 内置技能目录
      {
        source: SkillSource.BUILTIN,
        path: join(__dirname, '..', '..', 'builtin', 'skills'),
        priority: 80,
        enabled: true,
        recursive: false,
      },

      // 插件技能目录
      {
        source: SkillSource.PLUGIN,
        path: join(homeDir, '.claude', 'plugins', 'skills'),
        priority: 70,
        enabled: true,
        recursive: true,
      },
    ];
  }

  /**
   * 加载所有技能（基于CC源码）
   */
  async loadAllSkills(): Promise<SkillLoadResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const loadedSkills: SkillDefinition[] = [];
    let directoriesScanned = 0;
    let filesLoaded = 0;

    // 按优先级排序加载路径
    const sortedPaths = this.loadPaths
      .filter((path) => path.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const loadPath of sortedPaths) {
      try {
        const result = await this.loadSkillsFromPath(loadPath);

        directoriesScanned += result.directoriesScanned;
        filesLoaded += result.filesLoaded;
        loadedSkills.push(...result.skills);

        if (result.errors.length > 0) {
          errors.push(...result.errors);
        }
      } catch (error) {
        errors.push(
          `Failed to load skills from ${loadPath.path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // 去重处理（基于CC源码）
    const uniqueSkills = this.deduplicateSkills(loadedSkills);

    const loadTime = Date.now() - startTime;

    return {
      skills: uniqueSkills,
      directoriesScanned,
      filesLoaded,
      errors,
      loadTime,
    };
  }

  /**
   * 从指定路径加载技能（基于CC源码）
   */
  private async loadSkillsFromPath(
    loadPath: SkillLoadPath
  ): Promise<SkillLoadResult> {
    const skills: SkillDefinition[] = [];
    const errors: string[] = [];
    let directoriesScanned = 0;
    let filesLoaded = 0;

    if (!existsSync(loadPath.path)) {
      return { skills, directoriesScanned, filesLoaded, errors, loadTime: 0 };
    }

    try {
      const files = await readdir(loadPath.path);
      directoriesScanned++;

      for (const file of files) {
        const filePath = join(loadPath.path, file);
        const stats = await stat(filePath);

        if (stats.isDirectory()) {
          // 处理目录格式：skill-name/SKILL.md
          if (loadPath.recursive) {
            const skillFile = join(filePath, 'SKILL.md');
            if (existsSync(skillFile)) {
              try {
                const skill = await this.loadSkillFile(
                  skillFile,
                  loadPath.source
                );
                skills.push(skill);
                filesLoaded++;
              } catch (error) {
                errors.push(
                  `Failed to load skill from ${skillFile}: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }
          }
        } else if (file.endsWith('.md')) {
          // 处理旧版格式：commands/skill-name.md
          try {
            const skill = await this.loadSkillFile(filePath, loadPath.source);
            skills.push(skill);
            filesLoaded++;
          } catch (error) {
            errors.push(
              `Failed to load skill from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    } catch (error) {
      errors.push(
        `Failed to scan directory ${loadPath.path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return {
      skills,
      directoriesScanned,
      filesLoaded,
      errors,
      loadTime: 0,
    };
  }

  /**
   * 加载单个技能文件（基于CC源码）
   */
  private async loadSkillFile(
    filePath: string,
    source: SkillSource
  ): Promise<SkillDefinition> {
    // 检查缓存
    const cacheKey = `${filePath}_${source}`;
    const cached = this.skillCache.get(cacheKey);

    if (cached && this.cacheConfig.enabled) {
      const age = Date.now() - cached.timestamp;
      if (age < this.cacheConfig.timeout) {
        return cached.skill;
      } else {
        this.skillCache.delete(cacheKey);
      }
    }

    // 解析符号链接（基于CC源码）
    const realPath = await this.resolveRealPath(filePath);

    // 解析技能文件
    const skill = await this.parser.parseSkillFile(realPath, source);

    // 验证技能定义
    const validation = this.parser.validateSkillDefinition(skill);
    if (!validation.valid) {
      throw new AppError(
        `Invalid skill definition: ${validation.errors.join(', ')}`
      , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    // 应用路径过滤（基于CC源码）
    if (!this.isSkillApplicable(skill)) {
      throw new AppError(
        `Skill ${skill.name} is not applicable to current context`
      , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    // 缓存技能
    if (this.cacheConfig.enabled) {
      this.skillCache.set(cacheKey, { skill, timestamp: Date.now() });

      // 清理过期缓存
      this.cleanupCache();
    }

    return skill;
  }

  /**
   * 解析符号链接（基于CC源码）
   */
  private async resolveRealPath(filePath: string): Promise<string> {
    try {
      return await realpath(filePath);
    } catch (error) {
      // 如果解析失败，返回原始路径
      return filePath;
    }
  }

  /**
   * 检查技能是否适用（基于CC源码的paths字段）
   */
  private isSkillApplicable(skill: SkillDefinition): boolean {
    if (!skill.frontmatter.paths) {
      return true; // 没有路径限制，默认适用
    }

    const currentDir = process.cwd();
    const paths = Array.isArray(skill.frontmatter.paths)
      ? skill.frontmatter.paths
      : [skill.frontmatter.paths];

    return paths.some((path) => {
      // 支持绝对路径和相对路径匹配
      if (path.startsWith('/')) {
        return currentDir.startsWith(path);
      } else {
        // 相对路径匹配，检查当前目录是否包含路径模式
        return currentDir.includes(path);
      }
    });
  }

  /**
   * 技能去重（基于CC源码）
   */
  private deduplicateSkills(skills: SkillDefinition[]): SkillDefinition[] {
    const uniqueSkills = new Map<string, SkillDefinition>();

    for (const skill of skills) {
      const key = this.getSkillKey(skill);

      if (!uniqueSkills.has(key)) {
        uniqueSkills.set(key, skill);
      } else {
        // 保留高优先级的技能（基于来源优先级）
        const existingSkill = uniqueSkills.get(key)!;
        if (
          this.getSourcePriority(skill.source) >
          this.getSourcePriority(existingSkill.source)
        ) {
          uniqueSkills.set(key, skill);
        }
      }
    }

    return Array.from(uniqueSkills.values());
  }

  /**
   * 获取技能唯一键（基于CC源码）
   */
  private getSkillKey(skill: SkillDefinition): string {
    // 使用技能名称和主要配置作为唯一键
    const keyParts = [
      skill.name,
      skill.frontmatter.context || 'inline',
      skill.frontmatter.agent || 'default',
    ];

    return keyParts.join('::');
  }

  /**
   * 获取来源优先级（基于CC源码）
   */
  private getSourcePriority(source: SkillSource): number {
    const priorities = {
      [SkillSource.USER]: 100,
      [SkillSource.PROJECT]: 90,
      [SkillSource.PLUGIN]: 80,
      [SkillSource.BUILTIN]: 70,
      [SkillSource.BUNDLED]: 60,
      [SkillSource.MCP]: 50,
    };

    return priorities[source] || 0;
  }

  /**
   * 清理缓存（基于CC源码）
   */
  private cleanupCache(): void {
    if (this.skillCache.size <= this.cacheConfig.maxEntries) {
      return;
    }

    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.skillCache.entries()) {
      const age = now - entry.timestamp;
      if (age > this.cacheConfig.timeout) {
        toDelete.push(key);
      }
    }

    // 如果清理后仍然超过限制，按时间排序删除最旧的
    if (this.skillCache.size - toDelete.length > this.cacheConfig.maxEntries) {
      const sortedEntries = Array.from(this.skillCache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );

      const additionalToDelete = sortedEntries
        .slice(0, this.skillCache.size - this.cacheConfig.maxEntries)
        .map(([key]) => key);

      toDelete.push(...additionalToDelete);
    }

    for (const key of toDelete) {
      this.skillCache.delete(key);
    }
  }

  /**
   * 重新加载技能（基于CC源码）
   */
  async reloadSkills(): Promise<SkillLoadResult> {
    // 清除缓存
    this.skillCache.clear();

    // 重新加载
    return await this.loadAllSkills();
  }

  /**
   * 获取缓存统计信息（基于CC源码）
   */
  getCacheStats(): {
    totalCached: number;
    cacheHits: number;
    cacheMisses: number;
    cacheSize: number;
  } {
    return {
      totalCached: this.skillCache.size,
      cacheHits: 0, // 简化实现
      cacheMisses: 0, // 简化实现
      cacheSize: this.cacheConfig.maxEntries,
    };
  }

  /**
   * 添加加载路径（基于CC源码）
   */
  addLoadPath(loadPath: SkillLoadPath): void {
    this.loadPaths.push(loadPath);

    // 重新排序
    this.loadPaths.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 移除加载路径（基于CC源码）
   */
  removeLoadPath(path: string): boolean {
    const index = this.loadPaths.findIndex((p) => p.path === path);
    if (index !== -1) {
      this.loadPaths.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取当前加载路径配置
   */
  getLoadPaths(): SkillLoadPath[] {
    return [...this.loadPaths];
  }

  /**
   * 更新缓存配置
   */
  updateCacheConfig(config: Partial<SkillCacheConfig>): void {
    this.cacheConfig = { ...this.cacheConfig, ...config };
  }
}
