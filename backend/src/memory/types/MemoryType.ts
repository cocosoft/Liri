/**
 * 记忆类型
 */
export enum MemoryType {
  /**
   * 关于用户角色、目标、责任和知识的信息
   */
  USER = 'user',

  /**
   * 用户关于如何处理工作的指导
   */
  FEEDBACK = 'feedback',

  /**
   * 关于项目工作、目标、计划等的信息
   */
  PROJECT = 'project',

  /**
   * 指向外部系统中信息的指针
   */
  REFERENCE = 'reference',
}

/**
 * 验证记忆类型是否有效
 * @param type 记忆类型
 * @returns 是否有效
 */
export function isValidMemoryType(type: string): type is MemoryType {
  return Object.values(MemoryType).includes(type as MemoryType);
}
