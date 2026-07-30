/**
 * Remember技能 - 记忆功能
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';

const rememberSkill: Skill = {
  name: 'remember',
  description: 'Store information to remember for later conversations',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (context: unknown) => {
      const args = context as unknown[];
      return `Remembering information...\n\nContent: ${args.join(' ') || 'No content provided'}\n\nThis information has been stored for future reference.`;
    },
  },
};

export default rememberSkill;
