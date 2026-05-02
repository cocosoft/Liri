/**
 * Debug技能
 * 用于调试问题
 */

import { registerBundledSkill } from './bundledSkills';
import type { SkillService } from '../services/skillService';

/**
 * 注册Debug技能
 * @param skillService 技能服务实例
 */
export default function registerDebugSkill(skillService: SkillService): void {
  registerBundledSkill(skillService, {
    name: 'debug',
    description: 'Debug issues with PY_APP',
    aliases: ['troubleshoot'],
    whenToUse: 'When you need to debug issues with PY_APP',
    argumentHint: '[issue description]',
    getPromptForCommand: async (args, context) => {
      return [
        {
          type: 'text',
          text: `You are a PY_APP debug assistant. Help the user debug their issue.\n\nIssue: ${args}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nPlease provide a step-by-step debugging plan and explain how to fix the issue.`,
        },
      ];
    },
  });
}
