import { Skill, SkillFrontmatter } from '../types';

/**
 * 验证技能frontmatter
 * @param frontmatter 技能frontmatter
 * @param skillName 技能名称
 * @returns 验证结果
 */
export function validateSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  skillName: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 验证必要字段
  if (!frontmatter.name && !skillName) {
    errors.push('Skill name is required');
  }

  // 验证allowed-tools格式
  if (
    frontmatter['allowed-tools'] &&
    !Array.isArray(frontmatter['allowed-tools'])
  ) {
    errors.push('allowed-tools must be an array');
  }

  // 验证arguments格式
  if (frontmatter.arguments && !Array.isArray(frontmatter.arguments)) {
    errors.push('arguments must be an array');
  }

  // 验证paths格式
  if (frontmatter.paths && !Array.isArray(frontmatter.paths)) {
    errors.push('paths must be an array');
  }

  // 验证effort值
  if (frontmatter.effort) {
    const validEfforts = ['low', 'medium', 'high'];
    if (!validEfforts.includes(frontmatter.effort)) {
      errors.push(`effort must be one of: ${validEfforts.join(', ')}`);
    }
  }

  // 验证context值
  if (frontmatter.context && frontmatter.context !== 'fork') {
    errors.push('context must be "fork"');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 验证技能对象
 * @param skill 技能对象
 * @returns 验证结果
 */
export function validateSkill(skill: Skill): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 验证必要字段
  if (!skill.name) {
    errors.push('Skill name is required');
  }

  if (!skill.description) {
    errors.push('Skill description is required');
  }

  // 验证allowedTools格式
  if (!Array.isArray(skill.allowedTools)) {
    errors.push('allowedTools must be an array');
  }

  // 验证userFacingName方法
  if (typeof skill.userFacingName !== 'function') {
    errors.push('userFacingName must be a function');
  }

  // 验证getPromptForCommand方法
  if (typeof skill.getPromptForCommand !== 'function') {
    errors.push('getPromptForCommand must be a function');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
