import type { Command, CommandContext } from '../../types/index.js';
import { skillManager } from '../../../skills/managers/SkillManager.js';
import { UserSkillLoader } from '../../../skills/loaders/sources/UserSkillLoader.js';
import { ProjectSkillLoader } from '../../../skills/loaders/sources/ProjectSkillLoader.js';
import { PluginSkillLoader } from '../../../skills/loaders/sources/PluginSkillLoader.js';
import { MCPSkillLoader } from '../../../skills/loaders/sources/MCPSkillLoader.js';

export default {
  async call(args: string, context: CommandContext) {
    const parts = args.split(' ');
    const subCommand = parts[0];
    const skillName = parts[1];

    // 注册加载器
    skillManager.registerLoader(new UserSkillLoader());
    skillManager.registerLoader(new ProjectSkillLoader());
    skillManager.registerLoader(new PluginSkillLoader());
    skillManager.registerLoader(new MCPSkillLoader());

    // 加载技能
    await skillManager.loadSkills();

    switch (subCommand) {
      case 'list':
        return await this.listSkills();
      case 'info':
        return await this.skillInfo(skillName);
      default:
        return {
          type: 'text' as const,
          value: `技能命令用法:\n\n/skill list - 列出所有可用技能\n/skill info <技能名> - 查看技能详情`,
        };
    }
  },

  async listSkills() {
    const skills = skillManager.getSkills({ userInvocable: true });

    if (skills.length === 0) {
      return {
        type: 'text' as const,
        value: '没有找到可用的技能',
      };
    }

    const skillList = skills
      .map((skill) => `  ${skill.name.padEnd(20)} - ${skill.description}`)
      .join('\n');

    return {
      type: 'text' as const,
      value: `可用技能列表:\n\n${skillList}\n\n使用 /skill info <技能名> 查看技能详情`,
    };
  },

  async skillInfo(skillName: string) {
    if (!skillName) {
      return {
        type: 'text' as const,
        value: '请提供技能名称: /skill info <技能名>',
      };
    }

    const skill = skillManager.getSkill(skillName);
    if (!skill) {
      return {
        type: 'text' as const,
        value: `未找到技能: ${skillName}`,
      };
    }

    const info = `
技能详情:
========================
名称: ${skill.name}
描述: ${skill.description}
来源: ${skill.source}
用户可调用: ${skill.userInvocable ? '是' : '否'}
${skill.argumentHint ? `参数: ${skill.argumentHint}` : ''}
${skill.whenToUse ? `使用场景: ${skill.whenToUse}` : ''}
`;

    return {
      type: 'text' as const,
      value: info.trim(),
    };
  },
};
