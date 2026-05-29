//
import type { PermissionMode } from './PermissionMode';
import { shouldAvoidPermissionPrompts } from './PermissionMode';
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
} from './PermissionRule';
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './PermissionRule';
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
  const emptyRecord: Record<string, string[]> = {};
  for (const source of RULE_SOURCES) {
    emptyRecord[source] = [];
  }
  return {
    mode: 'default',
    alwaysAllowRules: emptyRecord as Record<PermissionRuleSource, string[]>,
    alwaysDenyRules: emptyRecord as Record<PermissionRuleSource, string[]>,
    alwaysAskRules: emptyRecord as Record<PermissionRuleSource, string[]>,
    isBypassPermissionsModeAvailable: false,
    additionalWorkingDirectories: [],
  };
}

const RULE_SOURCES: PermissionRuleSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
  'cliArg',
  'command',
  'session',
];

export function getAllowRules(
  context: ToolPermissionContext
): PermissionRule[] {
  return RULE_SOURCES.flatMap((source) =>
    (context.alwaysAllowRules[source] || []).map((ruleString) => ({
      source,
      ruleBehavior: 'allow' as PermissionBehavior,
      ruleValue: permissionRuleValueFromString(ruleString),
    }))
  );
}

export function getDenyRules(context: ToolPermissionContext): PermissionRule[] {
  return RULE_SOURCES.flatMap((source) =>
    (context.alwaysDenyRules[source] || []).map((ruleString) => ({
      source,
      ruleBehavior: 'deny' as PermissionBehavior,
      ruleValue: permissionRuleValueFromString(ruleString),
    }))
  );
}

export function getAskRules(context: ToolPermissionContext): PermissionRule[] {
  return RULE_SOURCES.flatMap((source) =>
    (context.alwaysAskRules[source] || []).map((ruleString) => ({
      source,
      ruleBehavior: 'ask' as PermissionBehavior,
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
  rules: PermissionRule[],
  toolName: string,
  input?: Record<string, unknown>
): PermissionRule | undefined {
  return rules.find((r) => matchRuleValue(r.ruleValue, toolName, input));
}

export function hasPermissionsToUseTool<Input extends Record<string, unknown>>(
  toolName: string,
  input: Input,
  context: ToolPermissionContext
): PermissionResult<Input> {
  if (context.mode === 'bypass' && context.isBypassPermissionsModeAvailable) {
    return {
      behavior: 'allow',
      decisionReason: { type: 'config', source: 'bypass' },
    };
  }

  const denyRules = getDenyRules(context);
  const matchedDeny = getRuleByContentsForToolName(denyRules, toolName, input);
  if (matchedDeny) {
    return {
      behavior: 'deny',
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
      behavior: 'allow',
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
      behavior: 'ask',
      decisionReason: {
        type: 'rule',
        rule: matchedAsk,
        source: matchedAsk.source,
      },
    };
  }

  if (context.mode === 'acceptEdits') {
    return {
      behavior: 'allow',
      decisionReason: { type: 'config', source: 'acceptEdits' },
    };
  }

  if (context.mode === 'plan') {
    return {
      behavior: 'ask',
      decisionReason: { type: 'config', source: 'plan' },
    };
  }

  if (shouldAvoidPermissionPrompts(context.mode as PermissionMode)) {
    return {
      behavior: 'deny',
      message: `Permission denied: ${toolName} requires approval, but don't ask mode is enabled`,
      decisionReason: { type: 'config', source: 'dontAsk' },
    };
  }

  return { behavior: 'allow', decisionReason: { type: 'default' } };
}
