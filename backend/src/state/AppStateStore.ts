/**
 * 应用状态存储
 */

/**
 * 应用状态接口
 */
export interface AppState {
  /**
   * 伙伴系统相关状态
   */
  companionReaction?: string;
  companionPetAt?: number;
  footerSelection?: string;
}

/**
 * 获取默认应用状态
 * @returns 默认应用状态
 */
export function getDefaultAppState(): AppState {
  return {
    companionReaction: undefined,
    companionPetAt: undefined,
    footerSelection: undefined,
  };
}
