/**
 * 技能命令
 * 管理技能
 */
import type { Command } from '../../types/index.js';

/**
 * 技能命令
 */
export const skillCommand: Command = {
  type: 'action',
  name: 'skill',
  description: '管理技能',
  aliases: ['sk'],
  argumentHint: '[list|enable|disable]',
  whenToUse: '当你需要管理系统技能时',
  load: async () => ({
    execute: async (args: string) => {
      // 模拟技能列表
      const skills = [
        { name: 'code', description: '代码生成和分析', enabled: true },
        { name: 'search', description: '网络搜索', enabled: true },
        { name: 'math', description: '数学计算', enabled: false },
        { name: 'translate', description: '翻译', enabled: true },
      ];

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'list':
          const skillList = skills
            .map(
              (skill) =>
                `  ${skill.name} - ${skill.description} (${skill.enabled ? 'enabled' : 'disabled'})`
            )
            .join('\n');
          return {
            success: true,
            message: `Skills:\n${skillList}`,
          };

        case 'enable':
          const enableSkill = restArgs;
          const skillToEnable = skills.find((s) => s.name === enableSkill);
          if (skillToEnable) {
            skillToEnable.enabled = true;
            return {
              success: true,
              message: `Enabled skill: ${enableSkill}`,
            };
          } else {
            return {
              success: false,
              error: `Skill not found: ${enableSkill}`,
            };
          }

        case 'disable':
          const disableSkill = restArgs;
          const skillToDisable = skills.find((s) => s.name === disableSkill);
          if (skillToDisable) {
            skillToDisable.enabled = false;
            return {
              success: true,
              message: `Disabled skill: ${disableSkill}`,
            };
          } else {
            return {
              success: false,
              error: `Skill not found: ${disableSkill}`,
            };
          }

        default:
          return {
            success: false,
            error: `Invalid subcommand. Usage: /skill [list|enable|disable]`,
          };
      }
    },
  }),
};

export default skillCommand;
