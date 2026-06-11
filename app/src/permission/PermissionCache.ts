/**
 * 权限缓存和验证机制
 * 负责缓存权限检查结果和验证权限规则
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { PermissionDecision } from './PermissionResult';
import type { PermissionRuleEntry } from './PermissionRule';
import type { ICache, CacheStats } from '@modules/cache/types';
import { TTLCache } from '@modules/utils/cache';
import { PermissionBehavior, PermissionRuleSource, permissionRuleValueFromString } from './types/PermissionRule';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 权限缓存键
 */
export interface PermissionCacheKey {
  toolName: string;
  inputHash: string;
  permissionMode: string;
}

/**
 * 权限缓存
 */
export class PermissionCache implements ICache<PermissionCacheKey, PermissionDecision> {
  private cache: TTLCache<PermissionDecision>;
  private defaultExpiry: number = 5 * 60 * 1000;
  private hits = 0;
  private misses = 0;
  private expirations = 0;
  private cleanups = 0;

  constructor() {
    this.cache = new TTLCache<PermissionDecision>(10000, this.defaultExpiry);
  }

  private generateKey(key: PermissionCacheKey): string {
    return `${key.toolName}:${key.inputHash}:${key.permissionMode}`;
  }

  get(key: PermissionCacheKey): PermissionDecision | null {
    const cacheKey = this.generateKey(key);
    const result = this.cache.get(cacheKey);

    if (result === null) {
      this.misses++;
      return null;
    }

    this.hits++;
    return result;
  }

  set(
    key: PermissionCacheKey,
    decision: PermissionDecision,
    expiry?: number
  ): void {
    const cacheKey = this.generateKey(key);
    this.cache.set(cacheKey, decision, expiry ?? this.defaultExpiry);
    logger.debug(`Permission cache set for ${cacheKey}`);
  }

  has(key: PermissionCacheKey): boolean {
    const cacheKey = this.generateKey(key);
    return this.cache.has(cacheKey);
  }

  delete(key: PermissionCacheKey): boolean {
    const cacheKey = this.generateKey(key);
    return this.cache.delete(cacheKey);
  }

  clear(): void {
    this.cache.clear();
    logger.debug('Permission cache cleared');
  }

  size(): number {
    return this.cache.size();
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    return {
      size: this.cache.size(),
      hits: this.hits,
      misses: this.misses,
      expirations: this.expirations,
      cleanups: this.cleanups,
    };
  }
}

/**
 * 权限规则验证器
 */
export class PermissionRuleValidator {
  static validateRule(ruleString: string): {
    valid: boolean;
    error?: string;
    rule?: PermissionRuleEntry;
  } {
    const ruleValue = permissionRuleValueFromString(ruleString);
    if (!ruleValue) {
      return { valid: false, error: `Invalid rule format: ${ruleString}` };
    }

    if (!ruleValue.toolName || ruleValue.toolName.trim() === '') {
      return { valid: false, error: 'Tool name cannot be empty' };
    }

    if (ruleValue.ruleContent) {
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
        source: PermissionRuleSource.SESSION,
        ruleBehavior: PermissionBehavior.ALLOW,
        ruleValue,
      },
    };
  }

  static validateRules(rules: string[]): {
    valid: boolean;
    errors: string[];
    validRules: PermissionRuleEntry[];
  } {
    const errors: string[] = [];
    const validRules: PermissionRuleEntry[] = [];

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

  static isOverlyBroadRule(rule: PermissionRuleEntry): boolean {
    if (
      rule.ruleValue.toolName === '*' &&
      rule.ruleValue.ruleContent === undefined
    ) {
      return true;
    }

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

export const permissionCache = new PermissionCache();

export function generateInputHash(input: Record<string, unknown>): string {
  try {
    const inputString = JSON.stringify(input);
    let hash = 0;
    for (let i = 0; i < inputString.length; i++) {
      const char = inputString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    logger.error('Error generating input hash:', e);
    return Math.random().toString(36).substring(2, 15);
  }
}

export async function checkPermissionsWithCache(
  toolName: string,
  input: Record<string, unknown>,
  permissionMode: string,
  checkFn: () => Promise<PermissionDecision>
): Promise<PermissionDecision> {
  const cacheKey: PermissionCacheKey = {
    toolName,
    inputHash: generateInputHash(input),
    permissionMode,
  };

  const cachedDecision = permissionCache.get(cacheKey);
  if (cachedDecision) {
    logger.debug(`Permission cache hit for ${toolName}`);
    return cachedDecision;
  }

  const decision = await checkFn();

  if (decision.behavior === 'allow' || decision.behavior === 'deny') {
    permissionCache.set(cacheKey, decision);
  }

  return decision;
}
