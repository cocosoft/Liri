/**
 * Tool Policy 工具访问控制策略
 * 对标 OpenClaw agents/tool-policy.ts
 *
 * 提供工具级别的访问控制，包括：
 * - Owner-only 工具限制
 * - Allow/Deny 黑白名单
 * - 工具 Profile（minimal/coding/messaging/full）
 * - 工具组展开和名称别名
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 工具 Profile 类型
 */
export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

/**
 * Owner-only 工具的审批等级
 */
export type OwnerOnlyToolApprovalClass =
  | 'control_plane'
  | 'exec_capable'
  | 'interactive';

/**
 * 工具策略配置项
 */
export interface ToolPolicyConfig {
  /** Allow 白名单（支持工具组展开） */
  allow?: string[];
  /** Deny 黑名单（支持工具组展开） */
  deny?: string[];
  /** 是否启用策略 */
  enabled: boolean;
}

/**
 * 工具策略评估结果
 */
export interface ToolPolicyEvaluation {
  /** 工具名称 */
  toolName: string;
  /** 是否允许使用 */
  allowed: boolean;
  /** 原因说明 */
  reason: string;
  /** 匹配的策略规则 */
  matchedRule?: 'allow' | 'deny' | 'owner_only' | 'profile' | 'default';
}

/**
 * 工具目录条目
 */
export interface ToolCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  ownerOnly?: boolean;
  approvalClass?: OwnerOnlyToolApprovalClass;
}

/**
 * 默认的工具组定义
 */
export const TOOL_GROUPS: Record<string, string[]> = {
  'group:fs': ['read', 'write', 'edit', 'apply_patch', 'glob', 'grep'],
  'group:runtime': ['exec', 'process', 'bash', 'powershell'],
  'group:web': ['web_search', 'web_fetch'],
  'group:memory': ['memory_search', 'memory_get', 'todo_write'],
  'group:sessions': [
    'sessions_list',
    'sessions_history',
    'sessions_send',
    'sessions_spawn',
    'sessions_yield',
    'session_status',
  ],
  'group:ui': ['browser', 'canvas', 'voice_input', 'voice_output'],
  'group:messaging': ['message', 'send_message', 'push_notification'],
  'group:automation': ['cron', 'gateway'],
  'group:agents': ['agents_list', 'update_plan', 'task'],
  'group:media': [
    'image',
    'image_generate',
    'music_generate',
    'video_generate',
    'tts',
  ],
  'group:openclaw': [
    'web_search',
    'web_fetch',
    'read',
    'write',
    'edit',
    'glob',
    'grep',
    'exec',
    'bash',
    'sessions_list',
    'sessions_history',
    'sessions_send',
    'task',
    'memory_search',
    'memory_get',
    'todo_write',
  ],
};

/**
 * 工具名称别名映射
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: 'exec',
  'apply-patch': 'apply_patch',
  shell: 'exec',
  ps: 'powershell',
  search: 'web_search',
  fetch: 'web_fetch',
};

/**
 * Owner-only 工具的默认审批等级
 */
const OWNER_ONLY_TOOL_APPROVAL_CLASSES: Record<
  string,
  OwnerOnlyToolApprovalClass
> = {
  cron: 'control_plane',
  gateway: 'control_plane',
  nodes: 'exec_capable',
};

/**
 * 各 Profile 允许的工具列表
 */
const PROFILE_TOOL_ALLOW_LISTS: Record<ToolProfileId, string[]> = {
  minimal: ['read', 'glob', 'grep', 'session_status'],
  coding: [
    'read',
    'write',
    'edit',
    'apply_patch',
    'glob',
    'grep',
    'exec',
    'process',
    'web_search',
    'web_fetch',
    'memory_search',
    'memory_get',
    'todo_write',
    'sessions_list',
    'sessions_history',
    'sessions_send',
    'sessions_spawn',
    'sessions_yield',
    'session_status',
    'cron',
    'update_plan',
    'task',
    'image',
    'image_generate',
  ],
  messaging: [
    'message',
    'send_message',
    'push_notification',
    'sessions_list',
    'sessions_history',
    'sessions_send',
    'session_status',
  ],
  full: [],
};

/**
 * 规范化工具名称
 */
export function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

/**
 * 规范化工具名称列表
 */
export function normalizeToolList(list?: string[]): string[] {
  if (!list || list.length === 0) {
    return [];
  }
  return list.map(normalizeToolName).filter(Boolean);
}

/**
 * 展开工具组为具体工具列表
 */
export function expandToolGroups(list?: string[]): string[] {
  const normalized = normalizeToolList(list);
  const expanded: string[] = [];
  for (const value of normalized) {
    const group = TOOL_GROUPS[value];
    if (group) {
      expanded.push(...group);
    } else {
      expanded.push(value);
    }
  }
  return Array.from(new Set(expanded));
}

/**
 * 获取指定 profile 的策略
 */
export function resolveProfilePolicy(
  profile?: string
): ToolPolicyConfig | undefined {
  if (!profile) {
    return undefined;
  }
  const profileId = profile as ToolProfileId;
  const allowList = PROFILE_TOOL_ALLOW_LISTS[profileId];
  if (!allowList) {
    return undefined;
  }
  if (profileId === 'full') {
    return { enabled: true };
  }
  return {
    allow: [...allowList],
    enabled: true,
  };
}

/**
 * 获取指定工具的 Owner-only 审批等级
 */
export function resolveOwnerOnlyApprovalClass(
  toolName: string
): OwnerOnlyToolApprovalClass | undefined {
  return OWNER_ONLY_TOOL_APPROVAL_CLASSES[normalizeToolName(toolName)];
}

/**
 * 检查工具是否为 Owner-only
 */
export function isOwnerOnlyTool(toolName: string): boolean {
  return normalizeToolName(toolName) in OWNER_ONLY_TOOL_APPROVAL_CLASSES;
}

/**
 * ToolPolicyManager
 * 管理工具的访问控制策略，包括黑白名单、Owner-only 限制、Profile 策略
 */
export class ToolPolicyManager {
  private globalAllowList: Set<string> = new Set();
  private globalDenyList: Set<string> = new Set();
  private ownerOnlyTools: Map<string, OwnerOnlyToolApprovalClass> = new Map(
    Object.entries(OWNER_ONLY_TOOL_APPROVAL_CLASSES)
  );
  private profile: ToolProfileId | null = null;
  private senderIsOwner: boolean = false;
  private ownerOnlyAllowlist: Set<string> = new Set();
  private enabled: boolean = true;

  /**
   * 设置全局 Allow 白名单
   */
  setAllowList(tools: string[]): void {
    const expanded = expandToolGroups(tools);
    this.globalAllowList = new Set(expanded);
    logger.info(`Tool allow list updated: ${expanded.length} tools`);
  }

  /**
   * 设置全局 Deny 黑名单
   */
  setDenyList(tools: string[]): void {
    const expanded = expandToolGroups(tools);
    this.globalDenyList = new Set(expanded);
    logger.info(`Tool deny list updated: ${expanded.length} tools`);
  }

  /**
   * 设置当前使用的 Profile
   */
  setProfile(profile: ToolProfileId | null): void {
    this.profile = profile;
    logger.info(`Tool policy profile set to: ${profile ?? 'none'}`);
  }

  /**
   * 设置发送者是否为 Owner
   */
  setSenderIsOwner(isOwner: boolean): void {
    this.senderIsOwner = isOwner;
  }

  /**
   * 设置 Owner-only 工具的 Allowlist（允许非 Owner 使用特定工具）
   */
  setOwnerOnlyAllowlist(tools: string[]): void {
    this.ownerOnlyAllowlist = new Set(normalizeToolList(tools));
  }

  /**
   * 启用/禁用策略
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 评估指定工具是否被允许使用
   */
  evaluate(toolName: string): ToolPolicyEvaluation {
    const name = normalizeToolName(toolName);

    if (!this.enabled) {
      return { toolName, allowed: true, reason: 'Policy disabled' };
    }

    // 1. 检查 Deny 黑名单
    if (this.globalDenyList.size > 0 && this.globalDenyList.has(name)) {
      return {
        toolName,
        allowed: false,
        reason: 'Tool is denied by policy',
        matchedRule: 'deny',
      };
    }

    // 2. 检查 Owner-only 限制
    if (this.ownerOnlyTools.has(name)) {
      if (!this.senderIsOwner && !this.ownerOnlyAllowlist.has(name)) {
        return {
          toolName,
          allowed: false,
          reason: 'Tool restricted to owner senders',
          matchedRule: 'owner_only',
        };
      }
    }

    // 3. 检查 Allow 白名单
    if (this.globalAllowList.size > 0) {
      if (!this.globalAllowList.has(name)) {
        return {
          toolName,
          allowed: false,
          reason: 'Tool not in allow list',
          matchedRule: 'allow',
        };
      }
      return {
        toolName,
        allowed: true,
        reason: 'Tool is in allow list',
        matchedRule: 'allow',
      };
    }

    // 4. 检查 Profile 限制
    if (this.profile && this.profile !== 'full') {
      const profileAllowList = PROFILE_TOOL_ALLOW_LISTS[this.profile];
      if (profileAllowList && profileAllowList.length > 0) {
        if (!profileAllowList.includes(name)) {
          return {
            toolName,
            allowed: false,
            reason: `Tool not allowed in profile: ${this.profile}`,
            matchedRule: 'profile',
          };
        }
        return {
          toolName,
          allowed: true,
          reason: `Allowed by profile: ${this.profile}`,
          matchedRule: 'profile',
        };
      }
    }

    // 5. 默认允许
    return {
      toolName,
      allowed: true,
      reason: 'Default allow',
      matchedRule: 'default',
    };
  }

  /**
   * 批量评估工具列表
   */
  evaluateAll(toolNames: string[]): ToolPolicyEvaluation[] {
    return toolNames.map((name) => this.evaluate(name));
  }

  /**
   * 过滤出被允许的工具列表
   */
  filterAllowed(toolNames: string[]): string[] {
    return toolNames.filter((name) => this.evaluate(name).allowed);
  }

  /**
   * 包装工具执行函数，对 Owner-only 工具添加检查
   */
  wrapToolExecution<T extends (...args: unknown[]) => unknown>(
    toolName: string,
    executeFn: T
  ): T {
    const name = normalizeToolName(toolName);
    const isOwnerOnly = this.ownerOnlyTools.has(name);

    if (!isOwnerOnly) {
      return executeFn;
    }

    const isAuthorized =
      this.senderIsOwner || this.ownerOnlyAllowlist.has(name);

    if (isAuthorized) {
      return executeFn;
    }

    const wrappedFn = ((...args: unknown[]) => {
      throw new Error(`Tool "${toolName}" is restricted to owner senders.`);
    }) as unknown as T;

    return wrappedFn;
  }

  /**
   * 获取当前策略的完整状态
   */
  getState(): {
    enabled: boolean;
    profile: ToolProfileId | null;
    senderIsOwner: boolean;
    allowListSize: number;
    denyListSize: number;
    ownerOnlyTools: string[];
  } {
    return {
      enabled: this.enabled,
      profile: this.profile,
      senderIsOwner: this.senderIsOwner,
      allowListSize: this.globalAllowList.size,
      denyListSize: this.globalDenyList.size,
      ownerOnlyTools: Array.from(this.ownerOnlyTools.keys()),
    };
  }

  /**
   * 重置所有策略配置
   */
  reset(): void {
    this.globalAllowList.clear();
    this.globalDenyList.clear();
    this.profile = null;
    this.senderIsOwner = false;
    this.ownerOnlyAllowlist.clear();
    this.enabled = true;
    logger.info('Tool policy manager reset to defaults');
  }
}
