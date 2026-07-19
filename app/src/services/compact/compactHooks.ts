import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services:compact:compactHooks',
  level: LogLevel.INFO,
});
/**
 * Compact Hooks（Pre/Post压缩钩子集成）
 */

export type CompactHookType = 'pre-compact' | 'post-compact';

export interface CompactHook {
  type: CompactHookType;
  name: string;
  execute: (context: CompactHookContext) => Promise<void>;
}

export interface CompactHookContext {
  sessionId: string;
  tokenCountBefore?: number;
  tokenCountAfter?: number;
  messageCountBefore?: number;
  messageCountAfter?: number;
  durationMs?: number;
}

const hooks: CompactHook[] = [];

export function registerCompactHook(hook: CompactHook): void {
  hooks.push(hook);
}

export function clearCompactHooks(): void {
  hooks.length = 0;
}

export async function executePreCompactHooks(
  context: CompactHookContext
): Promise<void> {
  const preHooks = hooks.filter((h) => h.type === 'pre-compact');
  for (const hook of preHooks) {
    try {
      await hook.execute(context);
    } catch (err) {
      // Hook errors must not break compact flow

      logger.debug('Operation skipped', {
        context: 'Hook errors must not break compact flow',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function executePostCompactHooks(
  context: CompactHookContext
): Promise<void> {
  const postHooks = hooks.filter((h) => h.type === 'post-compact');
  for (const hook of postHooks) {
    try {
      await hook.execute(context);
    } catch (err) {
      void handleError(err, {
        module: 'services:compact',
        action: 'catch_error',
      });
    }
  }
}
