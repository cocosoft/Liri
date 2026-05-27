/**
 * 工具建造者
 * 从部分工具定义构建完整的Tool，填充默认值
 */
import { Tool, ToolDef } from './types/Tool';
import { createAllowResult } from './types/PermissionResult';

/**
 * 工具默认值
 * 采用fail-closed策略（默认不安全、默认写操作）
 */
const TOOL_DEFAULTS = {
  /**
   * 默认启用
   */
  isEnabled: () => true,

  /**
   * 默认不并发安全
   */
  isConcurrencySafe: (_input?: Record<string, unknown>) => false,

  /**
   * 默认非只读（假设写操作）
   */
  isReadOnly: (_input?: Record<string, unknown>) => false,

  /**
   * 默认非破坏性
   */
  isDestructive: (_input?: Record<string, unknown>) => false,

  /**
   * 默认权限检查返回allow，交由通用权限系统处理
   */
  checkPermissions: (input: Record<string, unknown>, _ctx?: any) =>
    Promise.resolve(createAllowResult(input)),

  /**
   * 默认自动分类器输入返回空字符串
   */
  toAutoClassifierInput: (_input?: Record<string, unknown>) => '',

  /**
   * 默认用户可见名称返回工具名称
   */
  userFacingName: (_input?: Record<string, unknown>) => '',
};

/**
 * 工具建造者函数
 * 从部分工具定义构建完整的Tool，填充默认值
 *
 * @param def 工具定义（部分Tool接口）
 * @returns 完整的Tool实例
 */
export function buildTool(def: Partial<Tool>): Tool {
  return {
    // 先展开默认值
    ...TOOL_DEFAULTS,
    // 设置userFacingName默认值为工具名称
    userFacingName: (input?: Record<string, unknown>) => def.name || '',
    // 最后展开用户定义（用户定义覆盖默认值）
    ...def,
  } as Tool;
}

/**
 * 工具建造者工厂函数
 * 创建一个预配置的工具建造者
 *
 * @param defaults 额外的默认值
 * @returns 工具建造者函数
 */
export function createToolBuilder(defaults: Partial<Tool> = {}) {
  return (def: Partial<Tool>): Tool => {
    return buildTool({
      ...defaults,
      ...def,
    });
  };
}
