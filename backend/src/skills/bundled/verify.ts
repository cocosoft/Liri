// @ts-nocheck
/**
 * Verify技能
 * 用于验证结果
 */

import { registerBundledSkill } from './bundledSkills';
import type { SkillService } from '../services/skillService';

/**
 * 注册Verify技能
 * @param skillService 技能服务实例
 */
export default function registerVerifySkill(skillService: SkillService): void {
  registerBundledSkill(skillService, {
    name: 'verify',
    description: 'Verify the correctness of a result',
    whenToUse: 'When you need to verify if a result is correct',
    argumentHint: '[result to verify]',
    getPromptForCommand: async (args, context) => {
      return [
        {
          type: 'text',
          text: `You are a PY_APP verification assistant. Help the user verify if a result is correct.\n\nResult: ${args}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nPlease verify the result and explain why it is correct or incorrect.`,
        },
      ];
    },
  });
}
