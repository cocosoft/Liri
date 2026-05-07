// @ts-nocheck
import { Skill, SkillSource } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import {
  parseSkillFrontmatter,
  createSkillCommand,
} from '@modules/skills/utils/skillParser';
import { validateSkillFrontmatter } from '@modules/skills/utils/skillValidator';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { cwd } from 'process';

/**
 * 项目技能加载器
 * 加载项目目录下的技能
 */
export class ProjectSkillLoader extends SkillLoader {
  private projectSkillsDir: string;

  constructor() {
    super();
    // 项目技能目录：./.py_copilot/skills
    this.projectSkillsDir = join(cwd(), '.py_copilot', 'skills');
  }

  /**
   * 加载项目技能
   * @returns 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    const fs = await import('fs/promises');

    try {
      // 检查项目技能目录是否存在
      let entries: string[] = [];
      try {
        entries = await fs.readdir(this.projectSkillsDir);
      } catch {
        // 目录不存在，返回空列表
        return skills;
      }

      // 并行处理技能文件
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

          // 读取技能文件内容
          const content = await fs.readFile(skillFilePath, 'utf-8');

          // 解析技能frontmatter
          const { frontmatter, content: markdownContent } =
            parseSkillFrontmatter(content);

          // 验证技能frontmatter
          const validation = validateSkillFrontmatter(frontmatter, entry);
          if (!validation.valid) {
            console.warn(
              `Invalid skill ${entry}: ${validation.errors.join(', ')}`
            );
            return null;
          }

          // 创建技能对象
          return createSkillCommand({
            skillName: entry,
            frontmatter,
            content: markdownContent,
            source: SkillSource.PROJECT,
            loadedFrom: 'project',
          });
        } catch (error) {
          console.error(`Error loading skill ${entry}:`, error);
          return null;
        }
      });

      // 等待所有技能处理完成
      const skillResults = await Promise.all(skillPromises);

      // 过滤掉null值，添加有效技能
      for (const skill of skillResults) {
        if (skill) {
          skills.push(skill);
        }
      }
    } catch (error) {
      console.error('Error loading project skills:', error);
    }

    return skills;
  }

  /**
   * 获取技能来源
   * @returns 技能来源
   */
  getSource(): SkillSource {
    return SkillSource.PROJECT;
  }
}
