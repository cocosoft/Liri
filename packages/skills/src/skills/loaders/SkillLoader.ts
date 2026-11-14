import { Skill, SkillSource } from '../types';

export abstract class SkillLoader {
  /**
   * 加载技能
   * @returns 技能列表
   */
  abstract loadSkills(): Promise<Skill[]>;

  /**
   * 获取技能来源
   * @returns 技能来源
   */
  abstract getSource(): SkillSource;
}
