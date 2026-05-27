/**
 * Stuck技能 - 解决卡住问题
 */

import { Skill } from '../SkillManager.js';

const stuckSkill: Skill = {
  name: 'stuck',
  description: 'Get unstuck when you feel stuck on a problem',
  version: '1.0.0',
  author: 'PY_APP',
  execute: async (args: any[]) => {
    return `Help getting unstuck...\n\nProblem: ${args.join(' ') || 'Not specified'}\n\nLet me help you work through this problem. Try these approaches:\n1. Break the problem into smaller pieces\n2. Look for similar problems/solutions\n3. Take a step back and reconsider the approach\n4. Try a different approach altogether`;
  },
};

export default stuckSkill;
