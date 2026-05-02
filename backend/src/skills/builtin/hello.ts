/**
 * Hello技能
 * 用于测试技能系统
 */

import { Skill } from '../SkillManager.js';

const helloSkill: Skill = {
  name: 'hello',
  description: '向用户问好',
  version: '1.0.0',
  author: 'PY_APP',
  execute: async (args: any[]) => {
    return `Hello, ${args[0] || 'world'}!`;
  },
};

export default helloSkill;
