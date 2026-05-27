import { Skill, SkillSource, SkillFrontmatter } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import {
  parseSkillFrontmatter,
  createSkillCommand,
} from '@modules/skills/utils/skillParser';
import { validateSkillFrontmatter } from '@modules/skills/utils/skillValidator';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 用户技能加载器
 * 加载用户配置目录下的技�?
 */
export class UserSkillLoader extends SkillLoader {
  private userSkillsDir: string;
  private testSkillsDir: string;

  constructor() {
    super();
    // 用户技能目录：~/.py_copilot/skills
    this.userSkillsDir = join(homedir(), '.py_copilot', 'skills');
    // 测试技能目录：项目的testing目录
    this.testSkillsDir = join(process.cwd(), 'testing');
  }

  /**
   * 加载用户技�?
   * @returns 技能列�?
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    const fs = await import('fs/promises');

    try {
      // 加载用户技能目录的技�?
      await this.loadSkillsFromDirectory(this.userSkillsDir, skills, fs);

      // 加载测试目录的技�?
      await this.loadSkillsFromDirectory(this.testSkillsDir, skills, fs);
    } catch (error) {
      logger.error('Error loading user skills:', { error });
    }

    return skills;
  }

  /**
   * 从指定目录加载技�?
   * @param directory 目录路径
   * @param skills 技能列�?
   * @param fs 文件系统模块
   */
  private async loadSkillsFromDirectory(
    directory: string,
    skills: Skill[],
    fs: any
  ): Promise<void> {
    try {
      // 检查目录是否存�?
      let entries: string[] = [];
      try {
        entries = await fs.readdir(directory);
      } catch {
        // 目录不存在，直接返回
        return;
      }

      // 并行处理技能文�?
      const skillPromises = entries.map(async (entry) => {
        // 对于测试目录，直接检查SKILL.md文件
        if (directory === this.testSkillsDir && entry === 'SKILL.md') {
          try {
            // 读取技能文件内�?
            const content = await fs.readFile(join(directory, entry), 'utf-8');

            // 解析技能frontmatter
            const parsed = parseSkillFrontmatter(content);
            const frontmatter = parsed.frontmatter as SkillFrontmatter;
            const markdownContent = parsed.content;

            // 验证技能frontmatter
            const validation = validateSkillFrontmatter(
              frontmatter,
              'test-skill'
            );
            if (!validation.valid) {
              logger.warning(
                `Invalid test skill: ${validation.errors.join(', ')}`
              );
              return null;
            }

            // 创建技能对�?
            return createSkillCommand({
              skillName: 'test-skill',
              frontmatter,
              content: markdownContent,
              source: SkillSource.USER,
              loadedFrom: 'test',
            });
          } catch (error) {
            logger.error(`Error loading test skill:`, { error });
            return null;
          }
        }

        // 对于普通技能目录，检查子目录和SKILL.md文件
        const skillDirPath = join(directory, entry);
        const skillFilePath = join(skillDirPath, 'SKILL.md');

        try {
          // 检查是否是目录
          const stat = await fs.stat(skillDirPath);
          if (!stat.isDirectory()) {
            return null;
          }

          // 检查SKILL.md文件是否存在
          try {
            await fs.access(skillFilePath);
          } catch {
            return null;
          }

          // 读取技能文件内�?
          const content = await fs.readFile(skillFilePath, 'utf-8');

          // 解析技能frontmatter
          const parsed = parseSkillFrontmatter(content);
          const frontmatter = parsed.frontmatter as SkillFrontmatter;
          const markdownContent = parsed.content;

          // 验证技能frontmatter
          const validation = validateSkillFrontmatter(frontmatter, entry);
          if (!validation.valid) {
            logger.warning(
              `Invalid skill ${entry}: ${validation.errors.join(', ')}`
            );
            return null;
          }

          // 创建技能对�?
          return createSkillCommand({
            skillName: entry,
            frontmatter,
            content: markdownContent,
            source: SkillSource.USER,
            loadedFrom: directory === this.testSkillsDir ? 'test' : 'user',
          });
        } catch (error) {
          logger.error(`Error loading skill ${entry}:`, { error });
          return null;
        }
      });

      // 等待所有技能处理完�?
      const skillResults = await Promise.all(skillPromises);

      // 过滤掉null值，添加有效技�?
      for (const skill of skillResults) {
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
   * 获取技能来�?
   * @returns 技能来�?
   */
  getSource(): SkillSource {
    return SkillSource.USER;
  }
}
