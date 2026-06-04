import { Skill, SkillSource, SkillFrontmatter } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import {
  parseSkillFrontmatter,
  createSkillCommand,
} from '@modules/skills/utils/skillParser';
import { validateSkillFrontmatter } from '@modules/skills/utils/skillValidator';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveDataDir } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 项目技能加载器
 * 加载项目目录下的技�?
 */
export class ProjectSkillLoader extends SkillLoader {
  private projectSkillsDir: string;

  constructor() {
    super();
    // 项目技能目录：./.py_copilot/skills
    this.projectSkillsDir = join(resolveDataDir(), 'skills');
  }

  /**
   * 加载项目技�?
   * @returns 技能列�?
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    const fs = await import('fs/promises');

    try {
      // 检查项目技能目录是否存�?
      let entries: string[] = [];
      try {
        entries = await fs.readdir(this.projectSkillsDir);
      } catch {
        // 目录不存在，返回空列�?
        return skills;
      }

      // 并行处理技能文�?
      const skillPromises = entries.map(async (entry) => {
        const skillDirPath = join(this.projectSkillsDir, entry);
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
            source: SkillSource.PROJECT,
            loadedFrom: 'project',
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
      logger.error('Error loading project skills:', { error });
    }

    return skills;
  }

  /**
   * 获取技能来�?
   * @returns 技能来�?
   */
  getSource(): SkillSource {
    return SkillSource.PROJECT;
  }
}
