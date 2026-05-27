/**
 * 多账号系统类型定义
 * 对齐 OpenClaw accounts.ts + account-resolution.ts 设计
 */

/** 命名账号标识 */
export interface NamedAccount {
  /** 账号唯一标识 */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 账号级配置 */
  config: Record<string, unknown>;
  /** 是否默认回退 */
  isDefault: boolean;
}

/** 账号解析结果 */
export interface ResolvedAccount {
  /** 解析到的账号 */
  account: NamedAccount;
  /** 是否为回退账号（非精确匹配） */
  fallback: boolean;
}

/** 账号注册选项 */
export interface AccountRegistrationOptions {
  /** 账号唯一标识 */
  id: string;
  /** 显示名称 */
  displayName?: string;
  /** 账号级配置 */
  config?: Record<string, unknown>;
  /** 是否默认账号 */
  isDefault?: boolean;
}
