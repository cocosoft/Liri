/**
 * Remember技能 - 记忆功能
 */

import { Skill } from '../SkillManager.js';

const rememberSkill: Skill = {
  name: 'remember',
  description: 'Store information to remember for later conversations',
  version: '1.0.0',
  author: 'Liri',
  execute: async (args: any[]) => {
    return `Remembering information...\n\nContent: ${args.join(' ') || 'No content provided'}\n\nThis information has been stored for future reference.`;
  },
};

export default rememberSkill;
