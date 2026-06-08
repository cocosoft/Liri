/**
 * Verify技能 - 验证代码变更
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';

const verifySkill: Skill = {
  name: 'verify',
  description: 'Verify a code change does what it should by running the app',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (args: unknown[]) => {
      return `Verifying code changes...\n\nTarget: ${args.join(' ') || 'current project'}\n\nVerification steps:\n1. Run tests\n2. Check build\n3. Validate functionality\n\nUse /verify <path> to specify a specific file or directory.`;
    },
  },
};

export default verifySkill;
