/**
 * 文件系统技能加载器
 * 从指定目录加载技能文件（.md / .ts / .js）
 * 合并 UserSkillLoader + ProjectSkillLoader 的共有逻辑
 */

import { Skill, SkillSource, SkillFrontmatter } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import {
  parseSkillFrontmatter,
  createSkillCommand,
} from '@modules/skills/utils/skillParser';
import { validateSkillFrontmatter } from '@modules/skills/utils/skillValidator';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('skills:fileLoader');

/** 文件系统加载器配置 */
export interface FileSkillLoaderConfig {
  /** 要扫描的目录列表 */
  directories: string[];
  /** 技能来源（如 THIRD_PARTY / OFFICIAL） */
  source: SkillSource;
  /** 加载来源标识（如 'user' / 'project'） */
  loadedFrom: string;
  /** 文件扩展名（默认 ['.md']） */
  extensions?: string[];
  /** 是否递归扫描子目录 */
  recursive?: boolean;
  /** 技能文件名模式（默认 'SKILL.md'） */
  skillFileName?: string;
}

/**
 * 文件系统技能加载器
 *
 * 统一处理从文件系统目录加载技能的共有逻辑。
 * 支持 .md / .ts / .js 技能文件格式。
 */
export class FileSkillLoader extends SkillLoader {
  private config: FileSkillLoaderConfig;

  /**
   * @param config 加载器配置
   */
  constructor(config: FileSkillLoaderConfig) {
    super();
    this.config = {
      extensions: ['.md'],
      recursive: false,
      skillFileName: 'SKILL.md',
      ...config,
    };
  }

  /**
   * 加载技能
   * @returns 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    const fs = await import('fs/promises');

    for (const dir of this.config.directories) {
      await this.loadFromDirectory(dir, skills, fs);
    }

    return skills;
  }

  /**
   * 从单个目录加载技能
   */
  private async loadFromDirectory(
    directory: string,
    skills: Skill[],
    fs: typeof import('fs/promises')
  ): Promise<void> {
    try {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(directory);
      } catch (err) {
        // 目录不存在，跳过
        return;
      }

      const skillPromises = entries.map(async (entry) => {
        const fullPath = join(directory, entry);

        return this.loadSkillEntry(fullPath, entry, fs);
      });

      const results = await Promise.all(skillPromises);
      for (const skill of results) {
        if (skill) {
          skills.push(skill);
        }
      }
    } catch (error) {
      logger.error(`Error loading skills from directory ${directory}:`, {
        error,
      });
    }
  }

  /**
   * 加载单个目录条目
   */
  private async loadSkillEntry(
    fullPath: string,
    entry: string,
    fs: typeof import('fs/promises')
  ): Promise<Skill | null> {
    const ext = this.getExtension(entry);
    const isSkillFile = ext && this.config.extensions!.includes(ext);
    const isNamedSkillFile = entry === this.config.skillFileName;

    try {
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // 子目录模式：查找 SKILL.md
        const skillFilePath = join(fullPath, this.config.skillFileName!);
        return await this.loadSkillFromFile(skillFilePath, entry, fs);
      }

      if (stat.isFile() && (isSkillFile || isNamedSkillFile)) {
        // 直接文件模式：读取并解析
        return await this.loadSkillFromFile(
          fullPath,
          this.getNameWithoutExt(entry),
          fs
        );
      }

      return null;
    } catch (err) {
      return null;
    }
  }

  /**
   * 从文件加载技能
   */
  private async loadSkillFromFile(
    filePath: string,
    skillName: string,
    fs: typeof import('fs/promises')
  ): Promise<Skill | null> {
    try {
      await fs.access(filePath);
    } catch (err) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseSkillFrontmatter(content);
      const frontmatter = parsed.frontmatter as SkillFrontmatter;
      const markdownContent = parsed.content;

      const validation = validateSkillFrontmatter(frontmatter, skillName);
      if (!validation.valid) {
        logger.warning(
          `Invalid skill ${skillName}: ${validation.errors.join(', ')}`
        );
        return null;
      }

      return createSkillCommand({
        skillName,
        frontmatter,
        content: markdownContent,
        source: this.config.source,
        loadedFrom: this.config.loadedFrom,
      });
    } catch (error) {
      logger.error(`Error loading skill from ${filePath}:`, { error });
      return null;
    }
  }

  /**
   * 获取文件扩展名
   */
  private getExtension(filename: string): string | null {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx) : null;
  }

  /**
   * 获取文件名（不含扩展名）
   */
  private getNameWithoutExt(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(0, idx) : filename;
  }

  /**
   * 获取技能来源
   */
  getSource(): SkillSource {
    return this.config.source;
  }
}
