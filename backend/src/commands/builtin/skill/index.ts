/**
 * 技能命令
 * 管理技能
 */
import type { Command } from '../../types/index.js';
import { skillManager } from '../../../skills/managers/SkillManager.js';
import { SkillState } from '../../../skills/SkillManager.js';

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
      const skills = skillManager.getSkills();

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'list':
          if (skills.size === 0) {
            return {
              success: true,
              message: 'No skills available',
            };
          }
          const skillList = Array.from(skills.values())
            .map(
              (skillInfo) =>
                `  ${skillInfo.skill.name} - ${skillInfo.skill.description || 'No description'} (${skillInfo.state === SkillState.INITIALIZED ? 'enabled' : skillInfo.state})`
            )
            .join('\n');
          return {
            success: true,
            message: `Skills:\n${skillList}`,
          };

        case 'enable':
          const enableSkill = restArgs;
          const skillToEnable = skills.get(enableSkill);
          if (skillToEnable) {
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
          const skillToDisable = skills.get(disableSkill);
          if (skillToDisable) {
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

