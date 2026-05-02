/**
 * 内置技能
 */

import type { SkillService } from '../services/skillService';

// 导入内置技能
import debugSkill from './debug';
import loopSkill from './loop';
import stuckSkill from './stuck';
import verifySkill from './verify';

/**
 * 初始化内置技能
 * @param skillService 技能服务实例
 */
export function initBundledSkills(skillService: SkillService): void {
  // 注册内置技能
  debugSkill(skillService);
  loopSkill(skillService);
  stuckSkill(skillService);
  verifySkill(skillService);

  console.log('Bundled skills initialized');
}
