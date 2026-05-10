/**
 * 权限缓存和验证机制
 * 负责缓存权限检查结果和验证权限规则
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { PermissionDecision } from '../PermissionResult';
import type { PermissionRule } from '../PermissionRule';
import { permissionRuleValueFromString } from '../PermissionRule';

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
export class PermissionCache {
  private cache: Map<string, PermissionCacheItem> = new Map();
  private defaultExpiry: number = 5 * 60 * 1000;

  private generateKey(key: PermissionCacheKey): string {
    return `${key.toolName}:${key.inputHash}:${key.permissionMode}`;
  }

  private isExpired(item: PermissionCacheItem): boolean {
    return Date.now() > item.timestamp + item.expiry;
  }

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

  clear(): void {
    this.cache.clear();
    logger.debug('Permission cache cleared');
  }

  clearToolCache(toolName: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${toolName}:`)) {
        this.cache.delete(key);
      }
    }
    logger.debug(`Permission cache cleared for tool ${toolName}`);
  }

  size(): number {
    return this.cache.size;
  }

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
  static validateRule(ruleString: string): {
    valid: boolean;
    error?: string;
    rule?: PermissionRule;
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
        source: 'session' as const,
        ruleBehavior: 'allow' as const,
        ruleValue,
      },
    };
  }

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

  static isOverlyBroadRule(rule: PermissionRule): boolean {
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
