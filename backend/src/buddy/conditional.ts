import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * Buddy条件编译支持
 * 提供编译时功能开关和条件编译宏
 */

/**
 * 编译特性标志
 */
export interface BuddyCompileFlags {
  /** 是否启用Buddy功能 */
  ENABLE_BUDDY: boolean;
  /** 是否启用Buddy通知 */
  ENABLE_BUDDY_NOTIFICATIONS: boolean;
  /** 是否启用Buddy交互 */
  ENABLE_BUDDY_INTERACTIONS: boolean;
  /** 是否启用Buddy统计数据 */
  ENABLE_BUDDY_STATS: boolean;
  /** 是否启用Buddy稀有度系统 */
  ENABLE_BUDDY_RARITY: boolean;
  /** 是否启用Buddy精灵渲染 */
  ENABLE_BUDDY_SPRITES: boolean;
  /** 是否启用Buddy增强功能 */
  ENABLE_BUDDY_ENHANCED: boolean;
}

/**
 * 默认编译标志
 */
const DEFAULT_FLAGS: BuddyCompileFlags = {
  ENABLE_BUDDY: true,
  ENABLE_BUDDY_NOTIFICATIONS: true,
  ENABLE_BUDDY_INTERACTIONS: true,
  ENABLE_BUDDY_STATS: true,
  ENABLE_BUDDY_RARITY: true,
  ENABLE_BUDDY_SPRITES: true,
  ENABLE_BUDDY_ENHANCED: true,
};

/**
 * 从环境变量获取编译标志
 */
function getFlagsFromEnv(): Partial<BuddyCompileFlags> {
  const flags: Partial<BuddyCompileFlags> = {};

  const envPrefix = 'PY_APP_BUDDY_';
  const flagKeys: (keyof BuddyCompileFlags)[] = [
    'ENABLE_BUDDY',
    'ENABLE_BUDDY_NOTIFICATIONS',
    'ENABLE_BUDDY_INTERACTIONS',
    'ENABLE_BUDDY_STATS',
    'ENABLE_BUDDY_RARITY',
    'ENABLE_BUDDY_SPRITES',
    'ENABLE_BUDDY_ENHANCED',
  ];

  for (const key of flagKeys) {
    const envValue = process.env[envPrefix + key];
    if (envValue !== undefined) {
      flags[key] = envValue.toLowerCase() === 'true';
    }
  }

  return flags;
}

/**
 * 当前编译标志
 */
export const BUDDY_FLAGS: Readonly<BuddyCompileFlags> = {
  ...DEFAULT_FLAGS,
  ...getFlagsFromEnv(),
};

/**
 * 条件编译宏 - 检查Buddy是否启用
 */
export function isBuddyEnabled(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY;
}

/**
 * 条件编译宏 - 检查通知功能是否启用
 */
export function areBuddyNotificationsEnabled(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY && BUDDY_FLAGS.ENABLE_BUDDY_NOTIFICATIONS;
}

/**
 * 条件编译宏 - 检查交互功能是否启用
 */
export function areBuddyInteractionsEnabled(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY && BUDDY_FLAGS.ENABLE_BUDDY_INTERACTIONS;
}

/**
 * 条件编译宏 - 检查统计功能是否启用
 */
export function areBuddyStatsEnabled(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY && BUDDY_FLAGS.ENABLE_BUDDY_STATS;
}

/**
 * 条件编译宏 - 检查稀有度系统是否启用
 */
export function isBuddyRarityEnabled(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY && BUDDY_FLAGS.ENABLE_BUDDY_RARITY;
}

/**
 * 条件编译宏 - 检查精灵渲染是否启用
 */
export function areBuddySpritesEnabled(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY && BUDDY_FLAGS.ENABLE_BUDDY_SPRITES;
}

/**
 * 条件编译宏 - 检查增强功能是否启用
 */
export function isBuddyEnhancedEnabled(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY && BUDDY_FLAGS.ENABLE_BUDDY_ENHANCED;
}

/**
 * 条件执行函数 - 仅当Buddy启用时执行
 */
export function ifBuddyEnabled<T>(fn: () => T): T | undefined {
  if (isBuddyEnabled()) {
    return fn();
  }
  return undefined;
}

/**
 * 条件执行函数 - 仅当通知启用时执行
 */
export function ifNotificationsEnabled<T>(fn: () => T): T | undefined {
  if (areBuddyNotificationsEnabled()) {
    return fn();
  }
  return undefined;
}

/**
 * 条件执行函数 - 仅当交互启用时执行
 */
export function ifInteractionsEnabled<T>(fn: () => T): T | undefined {
  if (areBuddyInteractionsEnabled()) {
    return fn();
  }
  return undefined;
}

/**
 * 获取编译标志的JSON表示（用于调试）
 */
export function getCompileFlagsJson(): string {
  return JSON.stringify(BUDDY_FLAGS, null, 2);
}

/**
 * 检查是否所有Buddy功能都禁用
 */
export function isBuddyFullyDisabled(): boolean {
  return !BUDDY_FLAGS.ENABLE_BUDDY;
}

/**
 * 检查是否至少有一个Buddy功能启用
 */
export function hasAnyBuddyFeature(): boolean {
  return BUDDY_FLAGS.ENABLE_BUDDY;
}

/**
 * 编译时断言 - 如果条件不满足则抛出错误
 */
export function compileTimeAssert(condition: boolean, message: string): void {
  if (!condition) {
    throw new AppError(`[Buddy Compile Error] ${message}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
  }
}

/**
 * 编译时检查 - 验证Buddy依赖
 */
export function validateBuddyDependencies(): void {
  if (isBuddyEnhancedEnabled()) {
    compileTimeAssert(
      areBuddyInteractionsEnabled(),
      'ENABLE_BUDDY_ENHANCED requires ENABLE_BUDDY_INTERACTIONS to be true'
    );
    compileTimeAssert(
      areBuddyStatsEnabled(),
      'ENABLE_BUDDY_ENHANCED requires ENABLE_BUDDY_STATS to be true'
    );
  }

  if (areBuddyInteractionsEnabled()) {
    compileTimeAssert(
      isBuddyRarityEnabled(),
      'ENABLE_BUDDY_INTERACTIONS requires ENABLE_BUDDY_RARITY to be true'
    );
  }
}
