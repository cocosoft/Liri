/**
 * 规则 CRUD / 只读视图（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager` 原样搬出：规则增删、settings 来源只读视图、批量兼容接口、
 * 摘要与解释。排序、来源标注与返回值**逐字不变**；差异只有一处 —— 实例依赖
 * （`ruleManager` / `toolPermissionContext` / 当前模式）改为显式传入。
 */
import type { RuleManager } from '../RuleManager';
import type { PermissionMode } from '../PermissionMode';
import type { RuleMatcherPermissionContext } from '../utils/RuleMatcher';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  permissionRuleValueFromString,
} from '../types/PermissionRule';

/**
 * 添加权限规则
 *
 * LRO-07（2026-10-26）：**落盘来源必须是 `ruleStore`**。此前走 `createPermissionRule`
 * 的默认值 `userSettings` ⇒ `tool_rules.json` 里的规则全被标成「用户设置」，
 * deny 文案随之指错地方（磁盘上没有 settings.json）。这里显式标注真实来源。
 * @param behavior 权限行为
 * @param toolName 工具名称
 * @param contentPattern 内容模式（可选）
 */
export function addRule(
  ruleManager: RuleManager,
  behavior: PermissionBehavior,
  toolName: string,
  contentPattern?: string
): void {
  const rule = createPermissionRule({
    behavior,
    toolName,
    contentPattern,
    source: PermissionRuleSource.RULE_STORE,
  });
  ruleManager.addRule(rule);
}

/**
 * 移除权限规则
 * @param ruleId 规则ID
 */
export function removeRule(ruleManager: RuleManager, ruleId: string): void {
  const rule = ruleManager.getRuleById(ruleId);
  if (rule) {
    ruleManager.removeRule(rule);
  }
}

/**
 * 获取所有权限规则
 * @returns 权限规则数组
 */
export function getRules(ruleManager: RuleManager): any[] {
  return ruleManager.getRules();
}

/**
 * PR-2（2026-10-23）：settings 文件来源的权限规则（**只读视图**，供合并展示）。
 *
 * 背景（方案 §3.7.2）：工具规则有两条来源 —— 运行期 `tool_rules.json`（可写）与
 * settings `permissions.{allow,ask,deny}`（手工维护，启动时并入决策上下文）。
 * `GET /v1/permissions/rules` 必须同时返回两者并标注 `source`，否则 UI 与用户认知不一致
 * （用户在 settings 里写了 allow，面板却显示"默认"）。
 *
 * 本方法只读；写入口仍是 `tool_rules.json`（单一写路径）。
 */
export function getSettingsRuleEntries(toolPermissionContext: unknown): Array<{
  behavior: PermissionBehavior;
  toolName: string;
  contentPattern?: string;
  source: PermissionRuleSource;
}> {
  const ctx = toolPermissionContext as {
    alwaysAllowRules: Record<PermissionRuleSource, string[]>;
    alwaysDenyRules: Record<PermissionRuleSource, string[]>;
    alwaysAskRules: Record<PermissionRuleSource, string[]>;
  };
  return [
    ...[
      [PermissionBehavior.ALLOW, ctx.alwaysAllowRules] as const,
      [PermissionBehavior.DENY, ctx.alwaysDenyRules] as const,
      [PermissionBehavior.ASK, ctx.alwaysAskRules] as const,
    ].flatMap(([behavior, record]) =>
      Object.entries(record ?? {}).flatMap(([source, list]) =>
        (list ?? []).map((raw) => {
          const value = permissionRuleValueFromString(raw);
          return {
            behavior,
            toolName: value.toolName,
            contentPattern: value.ruleContent,
            source: source as PermissionRuleSource,
          };
        })
      )
    ),
  ];
}

/** 重置所有规则：清空内存与持久化文件，并返回空工具权限上下文 */
export function resetRules(
  ruleManager: RuleManager
): RuleMatcherPermissionContext {
  ruleManager.clearRules();
  return createEmptyToolPermissionContext();
}

/** 空工具权限上下文（三档来源表均为空） */
export function createEmptyToolPermissionContext(): RuleMatcherPermissionContext {
  return {
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
  };
}

/**
 * 添加规则字符串到指定来源
 * @param behavior 规则行为
 * @param source 规则来源
 * @param ruleString 规则字符串
 */
export function addRuleString(
  toolPermissionContext: RuleMatcherPermissionContext,
  behavior: PermissionBehavior,
  source: PermissionRuleSource,
  ruleString: string
): void {
  const key =
    behavior === PermissionBehavior.ALLOW
      ? 'alwaysAllowRules'
      : behavior === PermissionBehavior.DENY
        ? 'alwaysDenyRules'
        : 'alwaysAskRules';

  if (!toolPermissionContext[key][source]) {
    toolPermissionContext[key][source] = [];
  }

  toolPermissionContext[key][source]!.push(ruleString);
}

/** 保存权限规则 */
export function saveRules(ruleManager: RuleManager): void {
  ruleManager.saveRules(ruleManager.getRules());
}

/** 加载权限规则 */
export function loadRules(ruleManager: RuleManager): void {
  ruleManager.loadRules();
}

/**
 * 批量添加权限规则（兼容ToolManager接口）
 * @param rules 权限规则数组
 * @param behavior 权限行为
 * @param source 规则来源
 */
export function addRules(
  ruleManager: RuleManager,
  rules: any[],
  behavior: 'allow' | 'deny' | 'ask',
  source?: string
): void {
  for (const rule of rules) {
    const toolName = rule.name || rule.toolName;
    if (toolName) {
      addRule(
        ruleManager,
        behavior as PermissionBehavior,
        toolName,
        rule.contentPattern
      );
    }
  }
}

/**
 * 批量移除权限规则（兼容ToolManager接口）
 * @param rules 权限规则数组
 * @param behavior 权限行为
 * @param source 规则来源
 */
export function removeRules(
  ruleManager: RuleManager,
  rules: any[],
  behavior: 'allow' | 'deny' | 'ask',
  source?: string
): void {
  for (const rule of rules) {
    const toolName = rule.name || rule.toolName;
    if (toolName) {
      const existingRules = ruleManager.getRules();
      const ruleToRemove = existingRules.find(
        (r) => r.toolName === toolName && r.behavior === behavior
      );
      if (ruleToRemove) {
        ruleManager.removeRule(ruleToRemove);
      }
    }
  }
}

/**
 * 获取规则摘要（兼容ToolManager接口）
 * @returns 规则摘要信息
 */
export function getRulesSummary(ruleManager: RuleManager): {
  total: number;
  allow: number;
  deny: number;
  ask: number;
} {
  const rules = ruleManager.getRules();
  let allow = 0;
  let deny = 0;
  let ask = 0;
  for (const rule of rules) {
    switch (rule.behavior) {
      case 'allow':
        allow++;
        break;
      case 'deny':
        deny++;
        break;
      case 'ask':
        ask++;
        break;
    }
  }
  return { total: rules.length, allow, deny, ask };
}

/**
 * 解释权限决策（兼容ToolManager接口）
 * @param toolName 工具名称
 * @param input 输入参数
 * @returns 权限解释字符串
 */
export function explainPermission(
  ruleManager: RuleManager,
  mode: PermissionMode,
  toolName: string,
  input: Record<string, unknown> = {}
): string {
  const rules = ruleManager.getRules();
  const toolRules = rules.filter((r) => r.toolName === toolName);
  if (toolRules.length > 0) {
    const rule = toolRules[0];
    return `Permission for '${toolName}': ${rule.behavior}${rule.contentPattern ? ` - Pattern: ${rule.contentPattern}` : ''}`;
  }
  return `No explicit rule for '${toolName}', default behavior: ${mode}`;
}
