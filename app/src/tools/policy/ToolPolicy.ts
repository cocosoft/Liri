/**
 * 工具策略核心类型定义
 * 提供 ToolPolicy 接口、PolicyContext、PolicyResult 等核心类型
 */

import type { Tool } from '../types/Tool';

/**
 * 工具策略使用的用户角色
 * owner: 拥有所有权限，可使用全部工具
 * operator: 操作员，可使用除系统管理外的大部分工具
 * guest: 访客，仅可使用只读/查询类工具
 */
export type PolicyUserRole = 'owner' | 'operator' | 'guest';

/**
 * 可用工具 profile
 * coding: 开发场景，暴露文件读写、搜索、终端等全量工具
 * messaging: 消息/沟通场景，仅暴露消息发送、信息查询类工具
 * minimal: 最小化场景，仅暴露最基础的只读工具
 */
export type ToolProfile = 'coding' | 'messaging' | 'minimal';

/**
 * 策略评估上下文
 * 包含用户身份、会话信息、当前 profile 等
 */
export interface PolicyContext {
  /** 用户 ID（可选） */
  userId?: string;
  /** 用户角色（可选，默认 guest） */
  userRole?: PolicyUserRole;
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 当前工具 profile（可选，默认 coding） */
  profile?: ToolProfile;
  /** 权限模式（可选） */
  permissionMode?: string;
  /** 自定义属性（供扩展策略使用） */
  attributes?: Record<string, unknown>;
}

/**
 * 策略决策结果
 */
export interface PolicyResult {
  /** 是否允许访问 */
  allowed: boolean;
  /** 策略名称（用于追踪来源） */
  policyName: string;
  /** 拒绝原因（allowed 为 false 时必填） */
  reason?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 工具策略接口
 * 所有策略实现必须遵循此接口
 */
export interface ToolPolicy {
  /** 策略名称 */
  readonly name: string;
  /**
   * 评估工具是否允许使用
   * @param tool 待评估的工具实例
   * @param context 评估上下文
   * @returns 策略决策结果
   */
  evaluate(tool: Tool, context: PolicyContext): PolicyResult;
  /**
   * 批量评估工具列表
   * @param tools 待评估的工具列表
   * @param context 评估上下文
   * @returns 策略决策结果列表
   */
  evaluateBatch(tools: Tool[], context: PolicyContext): PolicyResult[];
}

/**
 * 创建默认允许的策略结果
 */
export function allowResult(policyName: string): PolicyResult {
  return { allowed: true, policyName };
}

/**
 * 创建拒绝的策略结果
 */
export function denyResult(policyName: string, reason: string): PolicyResult {
  return { allowed: false, policyName, reason };
}
