/**
 * 权限管理核心模块
 * 负责处理权限检查、规则匹配和自动模式决策
 */

import { logger } from '../utils/log.js';
import type { PermissionMode } from './PermissionMode.js';
import { isAutoMode, shouldAvoidPermissionPrompts } from './PermissionMode.js';
import type { PermissionRule, PermissionBehavior } from './PermissionRule.js';
import {
  PermissionRuleSource,
  parsePermissionRule,
  ruleMatches,
} from './PermissionRule.js';
import type {
  PermissionDecision,
  PermissionResult,
  PermissionDecisionReason,
} from './PermissionResult.js';
import {
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  createPassthroughDecision,
} from './PermissionResult.js';

/**
 * 工具权限上下文
 */
export interface ToolPermissionContext {
  mode: PermissionMode;
  alwaysAllowRules: Record<string, string[]>;
  alwaysDenyRules: Record<string, string[]>;
  alwaysAskRules: Record<string, string[]>;
  shouldAvoidPermissionPrompts?: boolean;
}

/**
 * 工具使用上下文
 */
export interface ToolUseContext {
  getAppState: () => {
    toolPermissionContext: ToolPermissionContext;
    denialTracking?: DenialTrackingState;
  };
  setAppState: (updater: (prev: any) => any) => void;
  abortController: AbortController;
  messages: any[];
  options: {
    tools: any[];
  };
  addNotification?: (notification: any) => void;
  localDenialTracking?: DenialTrackingState;
}

/**
 * 工具定义
 */
export interface Tool {
  name: string;
  inputSchema: {
    parse: (input: any) => any;
  };
  checkPermissions: (
    input: any,
    context: ToolUseContext
  ) => Promise<PermissionResult>;
  requiresUserInteraction?: () => boolean;
}

/**
 * 拒绝跟踪状态
 */
export interface DenialTrackingState {
  consecutiveDenials: number;
  totalDenials: number;
}

/**
 * 拒绝限制
 */
const DENIAL_LIMITS = {
  maxConsecutive: 5,
  maxTotal: 20,
};

/**
 * 创建拒绝跟踪状态
 */
export function createDenialTrackingState(): DenialTrackingState {
  return {
    consecutiveDenials: 0,
    totalDenials: 0,
  };
}

/**
 * 记录拒绝
 */
export function recordDenial(state: DenialTrackingState): DenialTrackingState {
  return {
    consecutiveDenials: state.consecutiveDenials + 1,
    totalDenials: state.totalDenials + 1,
  };
}

/**
 * 记录成功
 */
export function recordSuccess(state: DenialTrackingState): DenialTrackingState {
  return {
    consecutiveDenials: 0,
    totalDenials: state.totalDenials,
  };
}

/**
 * 检查是否应该回退到提示
 */
export function shouldFallbackToPrompting(state: DenialTrackingState): boolean {
  return (
    state.consecutiveDenials >= DENIAL_LIMITS.maxConsecutive ||
    state.totalDenials >= DENIAL_LIMITS.maxTotal
  );
}

/**
 * 权限规则来源
 */
const PERMISSION_RULE_SOURCES = [
  'default',
  'env',
  'file',
  'runtime',
  'cliArg',
  'command',
  'session',
] as const;

/**
 * 获取允许规则
 */
export function getAllowRules(
  context: ToolPermissionContext
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(
    (source) =>
      (context.alwaysAllowRules[source] || [])
        .map((ruleString) => {
          const ruleValue = parsePermissionRule(ruleString);
          if (!ruleValue) {
            return null;
          }
          return {
            source: source as PermissionRuleSource,
            ruleBehavior: 'allow' as PermissionBehavior,
            ruleValue: ruleValue,
          };
        })
        .filter((rule) => rule !== null) as PermissionRule[]
  );
}

/**
 * 获取拒绝规则
 */
export function getDenyRules(context: ToolPermissionContext): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(
    (source) =>
      (context.alwaysDenyRules[source] || [])
        .map((ruleString) => {
          const ruleValue = parsePermissionRule(ruleString);
          if (!ruleValue) {
            return null;
          }
          return {
            source: source as PermissionRuleSource,
            ruleBehavior: 'deny' as PermissionBehavior,
            ruleValue: ruleValue,
          };
        })
        .filter((rule) => rule !== null) as PermissionRule[]
  );
}

/**
 * 获取询问规则
 */
export function getAskRules(context: ToolPermissionContext): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(
    (source) =>
      (context.alwaysAskRules[source] || [])
        .map((ruleString) => {
          const ruleValue = parsePermissionRule(ruleString);
          if (!ruleValue) {
            return null;
          }
          return {
            source: source as PermissionRuleSource,
            ruleBehavior: 'ask' as PermissionBehavior,
            ruleValue: ruleValue,
          };
        })
        .filter((rule) => rule !== null) as PermissionRule[]
  );
}

/**
 * 检查工具是否完全匹配规则
 */
function toolMatchesRule(
  tool: Pick<Tool, 'name'>,
  rule: PermissionRule
): boolean {
  if (rule.ruleValue.ruleContent !== undefined) {
    return false;
  }
  return rule.ruleValue.toolName === tool.name;
}

/**
 * 检查工具是否在允许规则中
 */
export function toolAlwaysAllowedRule(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>
): PermissionRule | null {
  return (
    getAllowRules(context).find((rule) => toolMatchesRule(tool, rule)) || null
  );
}

/**
 * 检查工具是否在拒绝规则中
 */
export function getDenyRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>
): PermissionRule | null {
  return (
    getDenyRules(context).find((rule) => toolMatchesRule(tool, rule)) || null
  );
}

/**
 * 检查工具是否在询问规则中
 */
export function getAskRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>
): PermissionRule | null {
  return (
    getAskRules(context).find((rule) => toolMatchesRule(tool, rule)) || null
  );
}

/**
 * 创建权限请求消息
 */
export function createPermissionRequestMessage(
  toolName: string,
  decisionReason?: PermissionDecisionReason
): string {
  if (decisionReason) {
    switch (decisionReason.type) {
      case 'rule': {
        const ruleString = decisionReason.rule
          ? `${decisionReason.rule.ruleValue.toolName}${decisionReason.rule.ruleValue.ruleContent ? `(${decisionReason.rule.ruleValue.ruleContent})` : ''}`
          : '';
        return `Permission rule '${ruleString}' requires approval for this ${toolName} command`;
      }
      case 'hook': {
        const hookMessage = decisionReason.reason
          ? `Hook '${decisionReason.hookName}' blocked this action: ${decisionReason.reason}`
          : `Hook '${decisionReason.hookName}' requires approval for this ${toolName} command`;
        return hookMessage;
      }
      case 'classifier': {
        return `Classifier '${decisionReason.classifier}' requires approval for this ${toolName} command: ${decisionReason.reason}`;
      }
      case 'mode': {
        const modeTitle = decisionReason.mode;
        return `Current permission mode (${modeTitle}) requires approval for this ${toolName} command`;
      }
      case 'safetyCheck':
      case 'other':
        return (
          decisionReason.reason || `This ${toolName} command requires approval`
        );
    }
  }
  return `PY_APP requested permissions to use ${toolName}, but you haven't granted it yet.`;
}

/**
 * 持久化拒绝跟踪状态
 */
function persistDenialState(
  context: ToolUseContext,
  newState: DenialTrackingState
): void {
  if (context.localDenialTracking) {
    Object.assign(context.localDenialTracking, newState);
  } else {
    context.setAppState((prev) => {
      if (prev.denialTracking === newState) return prev;
      return { ...prev, denialTracking: newState };
    });
  }
}

/**
 * 处理拒绝限制超出
 */
function handleDenialLimitExceeded(
  denialState: DenialTrackingState,
  appState: {
    toolPermissionContext: { shouldAvoidPermissionPrompts?: boolean };
  },
  classifierReason: string,
  tool: Tool,
  result: PermissionDecision,
  context: ToolUseContext
): PermissionDecision | null {
  if (!shouldFallbackToPrompting(denialState)) {
    return null;
  }

  const hitTotalLimit = denialState.totalDenials >= DENIAL_LIMITS.maxTotal;
  const isHeadless =
    appState.toolPermissionContext.shouldAvoidPermissionPrompts;
  const totalCount = denialState.totalDenials;
  const consecutiveCount = denialState.consecutiveDenials;
  const warning = hitTotalLimit
    ? `${totalCount} actions were blocked this session. Please review the transcript before continuing.`
    : `${consecutiveCount} consecutive actions were blocked. Please review the transcript before continuing.`;

  logger.warn(`Denial limit exceeded: ${warning}`);

  if (isHeadless) {
    context.abortController.abort();
    return createDenyDecision(
      'Agent aborted: too many denials in headless mode'
    );
  }

  if (hitTotalLimit) {
    persistDenialState(context, {
      consecutiveDenials: 0,
      totalDenials: 0,
    });
  }

  return createAskDecision(
    `${warning}\n\nLatest blocked action: ${classifierReason}`,
    {
      type: 'classifier',
      classifier: 'auto-mode',
      reason: `${warning}\n\nLatest blocked action: ${classifierReason}`,
    }
  );
}

/**
 * 检查规则基础权限
 */
export async function checkRuleBasedPermissions(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext
): Promise<PermissionDecision | null> {
  const appState = context.getAppState();

  // 1. 检查整个工具是否被拒绝
  const denyRule = getDenyRuleForTool(appState.toolPermissionContext, tool);
  if (denyRule) {
    return createDenyDecision(
      `Permission to use ${tool.name} has been denied.`,
      {
        type: 'rule',
        rule: denyRule,
      }
    );
  }

  // 2. 检查整个工具是否需要询问
  const askRule = getAskRuleForTool(appState.toolPermissionContext, tool);
  if (askRule) {
    return createAskDecision(createPermissionRequestMessage(tool.name), {
      type: 'rule',
      rule: askRule,
    });
  }

  // 3. 工具特定的权限检查
  let toolPermissionResult: PermissionResult = createPassthroughDecision(
    createPermissionRequestMessage(tool.name)
  );

  try {
    const parsedInput = tool.inputSchema.parse(input);
    toolPermissionResult = await tool.checkPermissions(parsedInput, context);
  } catch (error) {
    logger.error('Error checking tool permissions:', error);
  }

  if (
    toolPermissionResult.behavior === 'allow' ||
    toolPermissionResult.behavior === 'deny' ||
    toolPermissionResult.behavior === 'ask'
  ) {
    return toolPermissionResult;
  }

  return null;
}

/**
 * 检查工具使用权限
 */
export async function hasPermissionsToUseTool(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext
): Promise<PermissionDecision> {
  const appState = context.getAppState();
  const permissionContext = appState.toolPermissionContext;

  // 1. 检查工具是否总是允许
  const allowRule = toolAlwaysAllowedRule(permissionContext, tool);
  if (allowRule) {
    return createAllowDecision(undefined, {
      type: 'rule',
      rule: allowRule,
    });
  }

  // 2. 检查规则基础权限
  const ruleBasedResult = await checkRuleBasedPermissions(tool, input, context);
  if (ruleBasedResult) {
    // 处理不同的权限模式
    if (ruleBasedResult.behavior === 'ask') {
      // 处理dontAsk模式
      if (permissionContext.mode === 'dontAsk') {
        return createDenyDecision(
          `Permission denied: ${tool.name} requires approval, but don't ask mode is enabled`,
          {
            type: 'mode',
            mode: 'dontAsk',
          }
        );
      }

      // 处理auto模式
      if (isAutoMode(permissionContext.mode)) {
        // 检查工具是否需要用户交互
        if (
          tool.requiresUserInteraction?.() &&
          ruleBasedResult.behavior === 'ask'
        ) {
          return ruleBasedResult;
        }

        // 获取拒绝跟踪状态
        const denialState =
          context.localDenialTracking ||
          appState.denialTracking ||
          createDenialTrackingState();

        // 简单的自动模式决策（实际应用中可能需要更复杂的分类器）
        // 这里使用一个简单的规则：如果是文件编辑工具，自动允许
        if (tool.name === 'EditTool' || tool.name === 'WriteTool') {
          const newDenialState = recordSuccess(denialState);
          persistDenialState(context, newDenialState);
          return createAllowDecision(undefined, {
            type: 'mode',
            mode: permissionContext.mode,
          });
        } else {
          // 其他工具默认拒绝
          const newDenialState = recordDenial(denialState);
          persistDenialState(context, newDenialState);

          // 检查拒绝限制
          const denialLimitResult = handleDenialLimitExceeded(
            newDenialState,
            appState,
            'Auto mode denied this action',
            tool,
            ruleBasedResult,
            context
          );
          if (denialLimitResult) {
            return denialLimitResult;
          }

          return createDenyDecision('Auto mode denied this action', {
            type: 'classifier',
            classifier: 'auto-mode',
            reason: 'Auto mode denied this action',
          });
        }
      }

      // 处理headless模式
      if (permissionContext.shouldAvoidPermissionPrompts) {
        return createDenyDecision(
          'Permission prompts are not available in this context',
          {
            type: 'other',
            reason: 'Permission prompts are not available in this context',
          }
        );
      }
    }

    return ruleBasedResult;
  }

  // 默认允许
  return createAllowDecision();
}
