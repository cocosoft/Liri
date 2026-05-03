// @ts-nocheck
/**
 * 权限缓存和验证机制
 * 负责缓存权限检查结果和验证权限规则
 */

import { logger } from '../utils/log.js';
import type { PermissionDecision } from './PermissionResult.js';
import type { PermissionRule } from './PermissionRule.js';
import { parsePermissionRule } from './PermissionRule.js';

/**
 * 权限缓存键
 */
export interface PermissionCacheKey {
  toolName: string;
  inputHash: string;
  permissionMode: string;
}

/**
 * 权限缓存项
 */
export interface PermissionCacheItem {
  decision: PermissionDecision;
  timestamp: number;
  expiry: number;
}

/**
 * 权限缓存
 */
class PermissionCache {
  private cache: Map<string, PermissionCacheItem> = new Map();
  private defaultExpiry: number = 5 * 60 * 1000; // 5分钟

  /**
   * 生成缓存键
   */
  private generateKey(key: PermissionCacheKey): string {
    return `${key.toolName}:${key.inputHash}:${key.permissionMode}`;
  }

  /**
   * 检查缓存是否过期
   */
  private isExpired(item: PermissionCacheItem): boolean {
    return Date.now() > item.timestamp + item.expiry;
  }

  /**
   * 获取缓存
   */
  get(key: PermissionCacheKey): PermissionDecision | null {
    const cacheKey = this.generateKey(key);
    const item = this.cache.get(cacheKey);

    if (!item) {
      return null;
    }

    if (this.isExpired(item)) {
      this.cache.delete(cacheKey);
      return null;
    }

    return item.decision;
  }

  /**
   * 设置缓存
   */
  set(
    key: PermissionCacheKey,
    decision: PermissionDecision,
    expiry?: number
  ): void {
    const cacheKey = this.generateKey(key);
    const item: PermissionCacheItem = {
      decision,
      timestamp: Date.now(),
      expiry: expiry || this.defaultExpiry,
    };

    this.cache.set(cacheKey, item);
    logger.debug(`Permission cache set for ${cacheKey}`);
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.cache.clear();
    logger.debug('Permission cache cleared');
  }

  /**
   * 清除特定工具的缓存
   */
  clearToolCache(toolName: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${toolName}:`)) {
        this.cache.delete(key);
      }
    }
    logger.debug(`Permission cache cleared for tool ${toolName}`);
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now();
    let deleted = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now > item.timestamp + item.expiry) {
        this.cache.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.debug(`Permission cache cleanup: deleted ${deleted} items`);
    }
  }
}

/**
 * 权限规则验证器
 */
export class PermissionRuleValidator {
  /**
   * 验证权限规则
   */
  static validateRule(ruleString: string): {
    valid: boolean;
    error?: string;
    rule?: PermissionRule;
  } {
    const ruleValue = parsePermissionRule(ruleString);
    if (!ruleValue) {
      return { valid: false, error: `Invalid rule format: ${ruleString}` };
    }

    // 验证工具名称
    if (!ruleValue.toolName || ruleValue.toolName.trim() === '') {
      return { valid: false, error: 'Tool name cannot be empty' };
    }

    // 验证规则内容（如果有）
    if (ruleValue.ruleContent) {
      // 检查规则内容是否包含危险字符
      const dangerousChars = [';', '|', '&', '`', '$', "'", '"'];
      for (const char of dangerousChars) {
        if (ruleValue.ruleContent?.includes(char)) {
          return {
            valid: false,
            error: `Rule content contains dangerous character: ${char}`,
          };
        }
      }
    }

    return {
      valid: true,
      rule: {
        source: 'runtime',
        ruleBehavior: 'allow', // 默认行为，实际使用时会根据上下文设置
        ruleValue,
      },
    };
  }

  /**
   * 验证权限规则列表
   */
  static validateRules(rules: string[]): {
    valid: boolean;
    errors: string[];
    validRules: PermissionRule[];
  } {
    const errors: string[] = [];
    const validRules: PermissionRule[] = [];

    for (const ruleString of rules) {
      const result = this.validateRule(ruleString);
      if (result.valid && result.rule) {
        validRules.push(result.rule);
      } else {
        errors.push(result.error || `Invalid rule: ${ruleString}`);
      }
    }

    return { valid: errors.length === 0, errors, validRules };
  }

  /**
   * 检查规则是否过于宽泛
   */
  static isOverlyBroadRule(rule: PermissionRule): boolean {
    // 检查是否为全局允许所有工具
    if (
      rule.ruleValue.toolName === '*' &&
      rule.ruleValue.ruleContent === undefined
    ) {
      return true;
    }

    // 检查是否为危险的shell命令允许
    if (
      (rule.ruleValue.toolName === 'Bash' ||
        rule.ruleValue.toolName === 'PowerShell') &&
      rule.ruleValue.ruleContent === '*'
    ) {
      return true;
    }

    return false;
  }
}

/**
 * 全局权限缓存实例
 */
export const permissionCache = new PermissionCache();

/**
 * 生成输入的哈希值
 */
export function generateInputHash(input: { [key: string]: unknown }): string {
  try {
    const inputString = JSON.stringify(input);
    // 简单的哈希算法，实际应用中可能需要更复杂的哈希函数
    let hash = 0;
    for (let i = 0; i < inputString.length; i++) {
      const char = inputString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  } catch (error) {
    logger.error('Error generating input hash:', error);
    return Math.random().toString(36).substring(2, 15);
  }
}

/**
 * 带缓存的权限检查
 */
export async function checkPermissionsWithCache(
  toolName: string,
  input: { [key: string]: unknown },
  permissionMode: string,
  checkFn: () => Promise<PermissionDecision>
): Promise<PermissionDecision> {
  // 生成缓存键
  const cacheKey: PermissionCacheKey = {
    toolName,
    inputHash: generateInputHash(input),
    permissionMode,
  };

  // 检查缓存
  const cachedDecision = permissionCache.get(cacheKey);
  if (cachedDecision) {
    logger.debug(`Permission cache hit for ${toolName}`);
    return cachedDecision;
  }

  // 执行权限检查
  const decision = await checkFn();

  // 缓存结果（只缓存允许和拒绝的决策，询问的决策不缓存）
  if (decision.behavior === 'allow' || decision.behavior === 'deny') {
    permissionCache.set(cacheKey, decision);
  }

  return decision;
}
