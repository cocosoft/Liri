/**
 * Loop技能
 * 用于循环执行任务
 */

import { registerBundledSkill } from './bundledSkills';
import type { SkillService } from '../services/skillService';

/**
 * 注册Loop技能
 * @param skillService 技能服务实例
 */
export default function registerLoopSkill(skillService: SkillService): void {
  registerBundledSkill(skillService, {
    name: 'loop',
    description: 'Loop over a task multiple times',
    whenToUse: 'When you need to repeat a task multiple times',
    argumentHint: '[number of times] [task]',
    getPromptForCommand: async (args, context) => {
      return [
        {
          type: 'text',
          text: `You are a PY_APP loop assistant. Help the user execute a task multiple times.\n\nTask: ${args}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nPlease execute the task the specified number of times and report the results.`,
        },
      ];
    },
  });
}
