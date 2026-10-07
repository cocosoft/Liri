import type { PermissionMode } from './PermissionMode';
import { shouldAvoidPermissionPrompts } from './PermissionMode';
import {
  PermissionBehavior,
  PermissionRuleSource,
} from './types/PermissionRule';
import { permissionRuleValueFromString } from './types/PermissionRule';
import type { PermissionRuleEntry } from './PermissionRule';
import type { PermissionDecision, PermissionResult } from './PermissionResult';

export interface ToolPermissionContext {
  mode: PermissionMode;
  alwaysAllowRules: Record<PermissionRuleSource, string[]>;
  alwaysDenyRules: Record<PermissionRuleSource, string[]>;
  alwaysAskRules: Record<PermissionRuleSource, string[]>;
  isBypassPermissionsModeAvailable: boolean;
  additionalWorkingDirectories: string[];
}

export function getEmptyToolPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default',
    alwaysAllowRules: buildEmptyRulesBySource(),
    alwaysDenyRules: buildEmptyRulesBySource(),
    alwaysAskRules: buildEmptyRulesBySource(),
    isBypassPermissionsModeAvailable: false,
    additionalWorkingDirectories: [],
  };
}

/**
 * 构造"每个来源一个空数组"的规则表。
 *
 * ⚠️ **必须每张表各建一份**（2026-10-07 修正）：此前 allow/deny/ask **共享同一对象**，
 * 任何一侧写入都会同时污染另两（接线 `loadAllPermissionSettings` 时实测：allow 的规则
 * 泄漏进 deny/ask）。三表同源引用 ⇒ 权限判定语义被静默改写。
 */
function buildEmptyRulesBySource(): Record<PermissionRuleSource, string[]> {
  const record = {} as Record<PermissionRuleSource, string[]>;
  for (const source of RULE_SOURCES) {
    record[source] = [];
  }
  return record;
}

const RULE_SOURCES: PermissionRuleSource[] = [
  PermissionRuleSource.USER_SETTINGS,
  PermissionRuleSource.PROJECT_SETTINGS,
  PermissionRuleSource.LOCAL_SETTINGS,
  PermissionRuleSource.FLAG_SETTINGS,
  PermissionRuleSource.POLICY_SETTINGS,
  PermissionRuleSource.CLI_ARG,
  PermissionRuleSource.COMMAND,
  PermissionRuleSource.SESSION,
];

export function getAllowRules(
  context: ToolPermissionContext
): PermissionRuleEntry[] {
  return RULE_SOURCES.flatMap((source) =>
    (context.alwaysAllowRules[source] || []).map((ruleString) => ({
      source,
      ruleBehavior: PermissionBehavior.ALLOW,
      ruleValue: permissionRuleValueFromString(ruleString),
    }))
  );
}

export function getDenyRules(
  context: ToolPermissionContext
): PermissionRuleEntry[] {
  return RULE_SOURCES.flatMap((source) =>
    (context.alwaysDenyRules[source] || []).map((ruleString) => ({
      source,
      ruleBehavior: PermissionBehavior.DENY,
      ruleValue: permissionRuleValueFromString(ruleString),
    }))
  );
}

export function getAskRules(
  context: ToolPermissionContext
): PermissionRuleEntry[] {
  return RULE_SOURCES.flatMap((source) =>
    (context.alwaysAskRules[source] || []).map((ruleString) => ({
      source,
      ruleBehavior: PermissionBehavior.ASK,
      ruleValue: permissionRuleValueFromString(ruleString),
    }))
  );
}

function matchRuleValue(
  ruleValue: { toolName: string; ruleContent?: string },
  toolName: string,
  input?: Record<string, unknown>
): boolean {
  if (ruleValue.toolName === '*' || ruleValue.toolName === toolName) {
    return true;
  }

  if (ruleValue.toolName.startsWith('mcp__') && toolName === 'mcp') {
    return input?.['serverName'] === ruleValue.toolName.replace('mcp__', '');
  }

  return false;
}

export function getRuleByContentsForToolName(
  rules: PermissionRuleEntry[],
  toolName: string,
  input?: Record<string, unknown>
): PermissionRuleEntry | undefined {
  return rules.find((r) => matchRuleValue(r.ruleValue, toolName, input));
}

export function hasPermissionsToUseTool<Input extends Record<string, unknown>>(
  toolName: string,
  input: Input,
  context: ToolPermissionContext
): PermissionResult<Input> {
  if (context.mode === 'bypass' && context.isBypassPermissionsModeAvailable) {
    return {
      behavior: PermissionBehavior.ALLOW,
      decisionReason: { type: 'config', source: 'bypass' },
    };
  }

  const denyRules = getDenyRules(context);
  const matchedDeny = getRuleByContentsForToolName(denyRules, toolName, input);
  if (matchedDeny) {
    return {
      behavior: PermissionBehavior.DENY,
      decisionReason: {
        type: 'rule',
        rule: matchedDeny,
        source: matchedDeny.source,
      },
      message: `${toolName} is denied by ${matchedDeny.source}`,
    };
  }

  const allowRules = getAllowRules(context);
  const matchedAllow = getRuleByContentsForToolName(
    allowRules,
    toolName,
    input
  );
  if (matchedAllow && context.mode !== 'plan') {
    return {
      behavior: PermissionBehavior.ALLOW,
      updatedInput: input,
      decisionReason: {
        type: 'rule',
        rule: matchedAllow,
        source: matchedAllow.source,
      },
    };
  }

  const askRules = getAskRules(context);
  const matchedAsk = getRuleByContentsForToolName(askRules, toolName, input);
  if (matchedAsk) {
    return {
      behavior: PermissionBehavior.ASK,
      decisionReason: {
        type: 'rule',
        rule: matchedAsk,
        source: matchedAsk.source,
      },
    };
  }

  if (context.mode === 'acceptEdits') {
    return {
      behavior: PermissionBehavior.ALLOW,
      decisionReason: { type: 'config', source: 'acceptEdits' },
    };
  }

  if (context.mode === 'plan') {
    return {
      behavior: PermissionBehavior.ASK,
      decisionReason: { type: 'config', source: 'plan' },
    };
  }

  if (shouldAvoidPermissionPrompts(context.mode as PermissionMode)) {
    return {
      behavior: PermissionBehavior.DENY,
      message: `Permission denied: ${toolName} requires approval, but don't ask mode is enabled`,
      decisionReason: { type: 'config', source: 'dontAsk' },
    };
  }

  return {
    behavior: PermissionBehavior.ALLOW,
    decisionReason: { type: 'default' },
  };
}
