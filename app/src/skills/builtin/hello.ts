/**
 * Hello技能
 * 用于测试技能系统
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';

const helloSkill: Skill = {
  name: 'hello',
  description: '向用户问好',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (args: unknown[]) => {
      return `Hello, ${args[0] || 'world'}!`;
    },
  },
};

export default helloSkill;
