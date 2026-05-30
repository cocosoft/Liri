/**
 * Debug技能 - 用于调试会话
 */

import { Skill } from '../SkillManager.js';

const debugSkill: Skill = {
  name: 'debug',
  description: 'Enable debug logging for this session and help diagnose issues',
  version: '1.0.0',
  author: 'Liri',
  execute: async (args: any[]) => {
    return `Debug mode activated. Use this skill to help diagnose issues in your current session.\n\nUser issue: ${args.join(' ') || 'No specific issue provided'}`;
  },
};

export default debugSkill;
