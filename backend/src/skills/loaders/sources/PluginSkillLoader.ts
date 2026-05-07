// @ts-nocheck
import { Skill, SkillSource } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import {
  parseSkillFrontmatter,
  createSkillCommand,
} from '@modules/skills/utils/skillParser';
import { validateSkillFrontmatter } from '@modules/skills/utils/skillValidator';
import { join } from 'path';
import { existsSync } from 'fs';
import { PluginManager } from '@modules/plugins/managers/PluginManager';

const pluginManager = PluginManager.getInstance();

/**
 * 插件技能加载器
 * 从插件中加载技能
 */
export class PluginSkillLoader extends SkillLoader {
  /**
   * 加载插件技能
   * @returns 技能列表
   */
  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      // 获取所有插件
      const plugins = pluginManager.getAllPlugins();

      for (const plugin of plugins) {
        const pluginId = plugin.repository;
        // 检查插件是否有技能
        if (plugin.manifest && plugin.manifest.skills) {
          for (const skillPath of plugin.manifest.skills) {
            try {
              const skillFilePath = join(plugin.path, skillPath);

              // 检查技能文件是否存在
              if (!existsSync(skillFilePath)) {
                console.warn(`Skill file not found: ${skillFilePath}`);
                continue;
              }

              // 读取技能文件内容
              const content = await import('fs/promises').then((fs) =>
                fs.readFile(skillFilePath, 'utf-8')
              );

              // 解析技能frontmatter
              const { frontmatter, content: markdownContent } =
                parseSkillFrontmatter(content);

              // 生成技能名称，添加插件前缀
              const skillName = `${pluginId}:${frontmatter.name || skillPath.replace(/\.md$/, '')}`;

              // 验证技能frontmatter
              const validation = validateSkillFrontmatter(
                frontmatter,
                skillName
              );
              if (!validation.valid) {
                console.warn(
                  `Invalid skill ${skillName}: ${validation.errors.join(', ')}`
                );
                continue;
              }

              // 创建技能对象
              const skill = createSkillCommand({
                skillName,
                frontmatter,
                content: markdownContent,
                source: SkillSource.PLUGIN,
                loadedFrom: 'plugin',
              });

              skills.push(skill);
            } catch (error) {
              console.error(
                `Error loading skill from plugin ${pluginId}:`,
                error
              );
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading plugin skills:', error);
    }

    return skills;
  }

  /**
   * 获取技能来源
   * @returns 技能来源
   */
  getSource(): SkillSource {
    return SkillSource.PLUGIN;
  }
}
