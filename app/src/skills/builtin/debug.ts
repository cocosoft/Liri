/**
 * Debug技能 - 用于调试会话
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';

const debugSkill: Skill = {
  name: 'debug',
  description: 'Enable debug logging for this session and help diagnose issues',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (context: unknown) => {
      const args = context as unknown[];
      return `Debug mode activated. Use this skill to help diagnose issues in your current session.\n\nUser issue: ${args.join(' ') || 'No specific issue provided'}`;
    },
  },
};

export default debugSkill;
