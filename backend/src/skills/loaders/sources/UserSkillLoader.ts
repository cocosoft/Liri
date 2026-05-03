// @ts-nocheck
import { Skill, SkillSource } from '../../types';
import { SkillLoader } from '../SkillLoader';
import {
  parseSkillFrontmatter,
  createSkillCommand,
} from '../../utils/skillParser';
import { validateSkillFrontmatter } from '../../utils/skillValidator';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';

/**
 * 用户技能加载器
 * 加载用户配置目录下的技能
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
   * 加载用户技能
   * @returns 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    const fs = await import('fs/promises');

    try {
      // 加载用户技能目录的技能
      await this.loadSkillsFromDirectory(this.userSkillsDir, skills, fs);

      // 加载测试目录的技能
      await this.loadSkillsFromDirectory(this.testSkillsDir, skills, fs);
    } catch (error) {
      console.error('Error loading user skills:', error);
    }

    return skills;
  }

  /**
   * 从指定目录加载技能
   * @param directory 目录路径
   * @param skills 技能列表
   * @param fs 文件系统模块
   */
  private async loadSkillsFromDirectory(
    directory: string,
    skills: Skill[],
    fs: any
  ): Promise<void> {
    try {
      // 检查目录是否存在
      let entries: string[] = [];
      try {
        entries = await fs.readdir(directory);
      } catch {
        // 目录不存在，直接返回
        return;
      }

      // 并行处理技能文件
      const skillPromises = entries.map(async (entry) => {
        // 对于测试目录，直接检查SKILL.md文件
        if (directory === this.testSkillsDir && entry === 'SKILL.md') {
          try {
            // 读取技能文件内容
            const content = await fs.readFile(join(directory, entry), 'utf-8');

            // 解析技能frontmatter
            const { frontmatter, content: markdownContent } =
              parseSkillFrontmatter(content);

            // 验证技能frontmatter
            const validation = validateSkillFrontmatter(
              frontmatter,
              'test-skill'
            );
            if (!validation.valid) {
              console.warn(
                `Invalid test skill: ${validation.errors.join(', ')}`
              );
              return null;
            }

            // 创建技能对象
            return createSkillCommand({
              skillName: 'test-skill',
              frontmatter,
              content: markdownContent,
              source: SkillSource.USER,
              loadedFrom: 'test',
            });
          } catch (error) {
            console.error(`Error loading test skill:`, error);
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
            source: SkillSource.USER,
            loadedFrom: directory === this.testSkillsDir ? 'test' : 'user',
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
      console.error(`Error loading skills from directory ${directory}:`, error);
    }
  }

  /**
   * 获取技能来源
   * @returns 技能来源
   */
  getSource(): SkillSource {
    return SkillSource.USER;
  }
}
