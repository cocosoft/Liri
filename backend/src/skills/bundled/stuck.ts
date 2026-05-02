/**
 * Stuck技能
 * 用于解决卡住的问题
 */

import { registerBundledSkill } from './bundledSkills';
import type { SkillService } from '../services/skillService';

/**
 * 注册Stuck技能
 * @param skillService 技能服务实例
 */
export default function registerStuckSkill(skillService: SkillService): void {
  registerBundledSkill(skillService, {
    name: 'stuck',
    description: 'Help when you get stuck',
    whenToUse: 'When you are stuck and need help',
    argumentHint: '[description of what you are stuck on]',
    getPromptForCommand: async (args, context) => {
      return [
        {
          type: 'text',
          text: `You are a PY_APP stuck assistant. Help the user get unstuck.\n\nIssue: ${args}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nPlease provide creative solutions to help the user get unstuck.`,
        },
      ];
    },
  });
}
