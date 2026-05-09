//
/**
 * 权限更新Schema（基于CC源码 utils/permissions/PermissionUpdateSchema.ts）
 */

import type {
  PermissionBehavior,
  PermissionRuleSource,
  PermissionUpdateDestination,
  PermissionUpdate,
} from './PermissionRule';

export type PermissionUpdateOperation =
  | { type: 'addRules'; destination: PermissionUpdateDestination; rules: { behavior: PermissionBehavior; toolName: string; ruleContent?: string }[] }
  | { type: 'replaceRules'; destination: PermissionUpdateDestination; rules: { behavior: PermissionBehavior; toolName: string; ruleContent?: string }[] }
  | { type: 'removeRules'; destination: PermissionUpdateDestination; toolNames: string[] }
  | { type: 'setMode'; mode: string };

export function applyPermissionUpdate(
  currentRules: Record<PermissionRuleSource, string[]>,
  update: PermissionUpdateOperation,
): Record<PermissionRuleSource, string[]> {
  const next = { ...currentRules };
  const src = 'destination' in update ? (update.destination as PermissionRuleSource) : null;

  if (!src) {
    return next;
  }

  switch (update.type) {
    case 'addRules': {
      const existing = new Set(next[src]);
      for (const r of update.rules) {
        existing.add(r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName);
      }
      next[src] = [...existing];
      break;
    }
    case 'replaceRules': {
      next[src] = update.rules.map(r =>
        r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName,
      );
      break;
    }
    case 'removeRules': {
      const removeSet = new Set(update.toolNames);
      next[src] = next[src].filter(r => !removeSet.has(r.split('(')[0]));
      break;
    }
  }

  return next;
}

export function persistPermissionUpdates(updates: PermissionUpdateOperation[]): boolean {
  try {
    for (const u of updates) {
      applyPermissionUpdate({} as Record<PermissionRuleSource, string[]>, u);
    }
    return true;
  } catch {
    return false;
  }
}
