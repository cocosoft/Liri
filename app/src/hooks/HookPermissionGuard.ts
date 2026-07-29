/**
 * HookPermissionGuard — 权限 Hook 不变量保护
 *
 * P1-6: 对标 cc_code resolveHookPermissionDecision()。
 * 确保 Hook allow 不绕过 settings.json 的 deny/ask 规则。
 *
 * 不变量：
 *   1. Hook `allow` + Settings `deny` → 最终拒绝（Hook 不能覆盖 deny）
 *   2. Hook `allow` + Settings `ask` → 仍需用户确认
 *   3. Hook `deny` → 立即拒绝（无论 Settings 如何）
 *   4. 无 Hook → 按 Settings 规则正常判断
 */
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'hooks:guard' });

export type HookDecision = 'allow' | 'deny' | 'ask' | 'passthrough';
export type SettingsDecision = 'allow' | 'deny' | 'ask';

export interface PermissionGuardResult {
  decision: HookDecision;
  /** 实际决策来源 */
  source: 'hook' | 'settings' | 'hook_overridden_by_settings' | 'default';
  reason: string;
}

/**
 * P1-6: 合并 Hook 决策和 Settings 规则，保证不变量
 */
export function resolvePermissionDecision(
  hookDecision: HookDecision | undefined,
  settingsDecision: SettingsDecision | undefined,
  toolName: string
): PermissionGuardResult {
  // No hook → defer to settings
  if (!hookDecision || hookDecision === 'passthrough') {
    if (!settingsDecision) {
      return { decision: 'ask', source: 'default', reason: `No rule for '${toolName}'` };
    }
    return {
      decision: settingsDecision as HookDecision,
      source: 'settings',
      reason: `Settings rule: ${settingsDecision}`,
    };
  }

  // Hook deny → always deny (Rule 3)
  if (hookDecision === 'deny') {
    return {
      decision: 'deny',
      source: 'hook',
      reason: `Hook denied '${toolName}'`,
    };
  }

  // Hook allow + Settings deny → deny (Rule 1: Hook cannot override settings deny)
  if (hookDecision === 'allow' && settingsDecision === 'deny') {
    logger.warn('hooks:guard_override', {
      toolName,
      hookDecision,
      settingsDecision,
      result: 'deny',
    });
    return {
      decision: 'deny',
      source: 'hook_overridden_by_settings',
      reason: `Hook allowed '${toolName}' but settings rule is 'deny' — blocked by invariant`,
    };
  }

  // Hook allow + Settings ask → ask (Rule 2: Hook allow doesn't bypass user confirmation requirement)
  if (hookDecision === 'allow' && settingsDecision === 'ask') {
    return {
      decision: 'ask',
      source: 'hook_overridden_by_settings',
      reason: `Hook allowed '${toolName}' but settings requires user confirmation`,
    };
  }

  // Hook allow + no settings deny/ask → allow
  if (hookDecision === 'allow') {
    return {
      decision: 'allow',
      source: 'hook',
      reason: `Hook allowed '${toolName}' (no conflicting settings rule)`,
    };
  }

  // Hook ask → ask (pass through)
  return {
    decision: hookDecision,
    source: 'hook',
    reason: `Hook requested confirmation for '${toolName}'`,
  };
}

/**
 * P1-6: 验证 Hook 链的隔离性 — 单个 Hook 异常不应导致全链崩溃
 */
export async function executeHookChainWithIsolation<T>(
  hooks: Array<{ execute: (ctx: T) => Promise<T>; name: string }>,
  initialContext: T
): Promise<{ result: T; errors: Array<{ name: string; error: string }> }> {
  let context = initialContext;
  const errors: Array<{ name: string; error: string }> = [];

  for (const hook of hooks) {
    try {
      context = await hook.execute(context);
    } catch (err) {
      errors.push({
        name: hook.name,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.warn('hooks:chain_isolation', {
        hook: hook.name,
        error: errors[errors.length - 1].error,
      });
    }
  }

  return { result: context, errors };
}
