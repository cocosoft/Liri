/**
 * 规则管理器
 * 负责管理权限规则的加载、保存、添加、删除等操作
 */
import {
  PermissionRule,
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  permissionRuleValueFromString,
  permissionRuleValueToString,
  isRuleMatch,
  isToolNameMatch,
} from '../types/PermissionRule';

/**
 * 规则上下文接口
 */
export interface RuleContext {
  /**
   * 总是允许的规则（按来源分组）
   */
  alwaysAllowRules: Partial<Record<PermissionRuleSource, string[]>>;
  /**
   * 总是拒绝的规则（按来源分组）
   */
  alwaysDenyRules: Partial<Record<PermissionRuleSource, string[]>>;
  /**
   * 总是询问的规则（按来源分组）
   */
  alwaysAskRules: Partial<Record<PermissionRuleSource, string[]>>;
}

/**
 * 规则管理器类
 */
export class RuleManager {
  /**
   * 权限规则数组
   */
  private rules: PermissionRule[] = [];

  /**
   * 规则存储路径
   */
  private ruleSource: string = './data/permission_rules.json';

  /**
   * 所有规则来源的优先级（数值越大优先级越高）
   */
  private static readonly SOURCE_PRIORITIES: Record<PermissionRuleSource, number> = {
    [PermissionRuleSource.SYSTEM]: 9,
    [PermissionRuleSource.SESSION]: 8,
    [PermissionRuleSource.COMMAND]: 7,
    [PermissionRuleSource.CLI_ARG]: 6,
    [PermissionRuleSource.POLICY_SETTINGS]: 5,
    [PermissionRuleSource.FLAG_SETTINGS]: 4,
    [PermissionRuleSource.LOCAL_SETTINGS]: 3,
    [PermissionRuleSource.PROJECT_SETTINGS]: 2,
    [PermissionRuleSource.USER_SETTINGS]: 1,
  };

  /**
   * 所有规则来源列表
   */
  private static readonly ALL_SOURCES: PermissionRuleSource[] = Object.values(PermissionRuleSource);

  /**
   * 加载权限规则
   * @returns 权限规则数组
   */
  loadRules(): PermissionRule[] {
    try {
      const fs = require('fs');
      const path = require('path');

      // 确保数据目录存在
      const dataDir = path.dirname(this.ruleSource);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // 读取规则文件
      if (fs.existsSync(this.ruleSource)) {
        const rulesData = fs.readFileSync(this.ruleSource, 'utf8');
        this.rules = JSON.parse(rulesData);

        // 转换日期字符串为Date对象
        this.rules.forEach((rule) => {
          if (typeof rule.createdAt === 'string') {
            rule.createdAt = new Date(rule.createdAt);
          }
          if (typeof rule.updatedAt === 'string') {
            rule.updatedAt = new Date(rule.updatedAt);
          }
        });
      }
    } catch (error) {
      console.error('Failed to load permission rules:', error);
    }
    return this.rules;
  }

  /**
   * 保存权限规则
   * @param rules 权限规则数组
   */
  saveRules(rules: PermissionRule[]): void {
    try {
      const fs = require('fs');
      const path = require('path');

      // 确保数据目录存在
      const dataDir = path.dirname(this.ruleSource);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // 保存规则文件
      const rulesData = JSON.stringify(rules, null, 2);
      fs.writeFileSync(this.ruleSource, rulesData);
      this.rules = rules;
    } catch (error) {
      console.error('Failed to save permission rules:', error);
    }
  }

  /**
   * 添加规则
   * @param rule 权限规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
    this.saveRules(this.rules);
  }

  /**
   * 删除规则
   * @param rule 权限规则
   */
  removeRule(rule: PermissionRule): void {
    this.rules = this.rules.filter((r) => r.id !== rule.id);
    this.saveRules(this.rules);
  }

  /**
   * 获取规则
   * @param source 规则来源（可选）
   * @param behavior 权限行为（可选）
   * @returns 权限规则数组
   */
  getRules(
    source?: PermissionRuleSource,
    behavior?: PermissionBehavior
  ): PermissionRule[] {
    let filteredRules = [...this.rules];

    if (source) {
      filteredRules = filteredRules.filter((rule) => rule.source === source);
    }

    if (behavior) {
      filteredRules = filteredRules.filter(
        (rule) => rule.behavior === behavior
      );
    }

    // 按优先级排序，优先级高的在前
    return filteredRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 解析规则字符串
   * @param ruleString 规则字符串
   * @returns 权限规则
   */
  parseRuleString(ruleString: string): PermissionRule {
    // 解析规则字符串，例如："allow:Bash" 或 "deny:Bash:rm -rf"
    const parts = ruleString.split(':');
    const behavior = parts[0] as PermissionBehavior;
    const toolName = parts[1];
    const contentPattern = parts.slice(2).join(':');

    return {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      behavior,
      toolName,
      contentPattern: contentPattern || undefined,
      source: PermissionRuleSource.USER_SETTINGS,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 规则字符串化
   * @param rule 权限规则
   * @returns 规则字符串
   */
  stringifyRule(rule: PermissionRule): string {
    let ruleString = `${rule.behavior}:${rule.toolName}`;
    if (rule.contentPattern) {
      ruleString += `:${rule.contentPattern}`;
    }
    return ruleString;
  }

  /**
   * 更新规则
   * @param rule 权限规则
   */
  updateRule(rule: PermissionRule): void {
    const index = this.rules.findIndex((r) => r.id === rule.id);
    if (index !== -1) {
      rule.updatedAt = new Date();
      this.rules[index] = rule;
      this.saveRules(this.rules);
    }
  }

  /**
   * 根据ID获取规则
   * @param ruleId 规则ID
   * @returns 权限规则或undefined
   */
  getRuleById(ruleId: string): PermissionRule | undefined {
    return this.rules.find((rule) => rule.id === ruleId);
  }

  /**
   * 设置规则存储路径
   * @param ruleSource 规则存储路径
   */
  setRuleSource(ruleSource: string): void {
    this.ruleSource = ruleSource;
  }

  /**
   * 获取规则存储路径
   * @returns 规则存储路径
   */
  getRuleSource(): string {
    return this.ruleSource;
  }

  /**
   * 从规则上下文加载规则
   * @param context 规则上下文
   */
  loadFromContext(context: RuleContext): void {
    const newRules: PermissionRule[] = [];

    // 加载 allow 规则
    for (const source of RuleManager.ALL_SOURCES) {
      const rules = context.alwaysAllowRules[source];
      if (rules) {
        for (const ruleString of rules) {
          const ruleValue = permissionRuleValueFromString(ruleString);
          newRules.push(
            createPermissionRule({
              behavior: PermissionBehavior.ALLOW,
              toolName: ruleValue.toolName,
              contentPattern: ruleValue.ruleContent,
              source,
              priority: RuleManager.SOURCE_PRIORITIES[source],
            })
          );
        }
      }
    }

    // 加载 deny 规则
    for (const source of RuleManager.ALL_SOURCES) {
      const rules = context.alwaysDenyRules[source];
      if (rules) {
        for (const ruleString of rules) {
          const ruleValue = permissionRuleValueFromString(ruleString);
          newRules.push(
            createPermissionRule({
              behavior: PermissionBehavior.DENY,
              toolName: ruleValue.toolName,
              contentPattern: ruleValue.ruleContent,
              source,
              priority: RuleManager.SOURCE_PRIORITIES[source],
            })
          );
        }
      }
    }

    // 加载 ask 规则
    for (const source of RuleManager.ALL_SOURCES) {
      const rules = context.alwaysAskRules[source];
      if (rules) {
        for (const ruleString of rules) {
          const ruleValue = permissionRuleValueFromString(ruleString);
          newRules.push(
            createPermissionRule({
              behavior: PermissionBehavior.ASK,
              toolName: ruleValue.toolName,
              contentPattern: ruleValue.ruleContent,
              source,
              priority: RuleManager.SOURCE_PRIORITIES[source],
            })
          );
        }
      }
    }

    // 合并现有规则和从上下文加载的规则
    this.rules = [...this.rules, ...newRules];
  }

  /**
   * 获取指定行为的规则
   * @param behavior 权限行为
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getRulesByBehavior(
    behavior: PermissionBehavior,
    context?: RuleContext
  ): PermissionRule[] {
    let rules = this.getRules(undefined, behavior);

    // 如果提供了上下文，添加从上下文中获取的规则
    if (context) {
      const contextRules: PermissionRule[] = [];
      let contextRulesSource: Partial<Record<PermissionRuleSource, string[]>>;

      switch (behavior) {
        case PermissionBehavior.ALLOW:
          contextRulesSource = context.alwaysAllowRules;
          break;
        case PermissionBehavior.DENY:
          contextRulesSource = context.alwaysDenyRules;
          break;
        case PermissionBehavior.ASK:
          contextRulesSource = context.alwaysAskRules;
          break;
      }

      for (const source of RuleManager.ALL_SOURCES) {
        const ruleStrings = contextRulesSource[source];
        if (ruleStrings) {
          for (const ruleString of ruleStrings) {
            const ruleValue = permissionRuleValueFromString(ruleString);
            contextRules.push(
              createPermissionRule({
                behavior,
                toolName: ruleValue.toolName,
                contentPattern: ruleValue.ruleContent,
                source,
                priority: RuleManager.SOURCE_PRIORITIES[source],
              })
            );
          }
        }
      }

      rules = [...rules, ...contextRules];
    }

    // 按优先级排序
    return rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取 allow 规则
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getAllowRules(context?: RuleContext): PermissionRule[] {
    return this.getRulesByBehavior(PermissionBehavior.ALLOW, context);
  }

  /**
   * 获取 deny 规则
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getDenyRules(context?: RuleContext): PermissionRule[] {
    return this.getRulesByBehavior(PermissionBehavior.DENY, context);
  }

  /**
   * 获取 ask 规则
   * @param context 规则上下文（可选）
   * @returns 权限规则数组
   */
  getAskRules(context?: RuleContext): PermissionRule[] {
    return this.getRulesByBehavior(PermissionBehavior.ASK, context);
  }

  /**
   * 检查工具是否匹配规则（整体工具匹配）
   * @param toolName 工具名称
   * @param rule 权限规则
   * @returns 是否匹配
   */
  toolMatchesRule(toolName: string, rule: PermissionRule): boolean {
    // 如果规则有内容模式，则不匹配整体工具
    if (rule.contentPattern) {
      return false;
    }
    return isToolNameMatch(toolName, rule.toolName);
  }

  /**
   * 检查工具是否总是被允许
   * @param toolName 工具名称
   * @param context 规则上下文（可选）
   * @returns 允许规则或 null
   */
  toolAlwaysAllowedRule(
    toolName: string,
    context?: RuleContext
  ): PermissionRule | null {
    const allowRules = this.getAllowRules(context);
    return allowRules.find((rule) => this.toolMatchesRule(toolName, rule)) || null;
  }

  /**
   * 检查工具是否被拒绝
   * @param toolName 工具名称
   * @param context 规则上下文（可选）
   * @returns 拒绝规则或 null
   */
  getDenyRuleForTool(
    toolName: string,
    context?: RuleContext
  ): PermissionRule | null {
    const denyRules = this.getDenyRules(context);
    return denyRules.find((rule) => this.toolMatchesRule(toolName, rule)) || null;
  }

  /**
   * 检查工具是否应该询问
   * @param toolName 工具名称
   * @param context 规则上下文（可选）
   * @returns 询问规则或 null
   */
  getAskRuleForTool(
    toolName: string,
    context?: RuleContext
  ): PermissionRule | null {
    const askRules = this.getAskRules(context);
    return askRules.find((rule) => this.toolMatchesRule(toolName, rule)) || null;
  }

  /**
   * 检查工具输入是否匹配规则（包含内容模式）
   * @param toolName 工具名称
   * @param input 工具输入
   * @param behavior 权限行为
   * @param context 规则上下文（可选）
   * @returns 匹配的规则或 null
   */
  getMatchingRule(
    toolName: string,
    input: Record<string, unknown>,
    behavior: PermissionBehavior,
    context?: RuleContext
  ): PermissionRule | null {
    const rules = this.getRulesByBehavior(behavior, context);
    for (const rule of rules) {
      if (isRuleMatch(rule, toolName, input)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * 获取规则内容映射（用于按内容匹配工具）
   * @param toolName 工具名称
   * @param behavior 权限行为
   * @param context 规则上下文（可选）
   * @returns 内容模式到规则的映射
   */
  getRuleByContentsForTool(
    toolName: string,
    behavior: PermissionBehavior,
    context?: RuleContext
  ): Map<string, PermissionRule> {
    const ruleByContents = new Map<string, PermissionRule>();
    const rules = this.getRulesByBehavior(behavior, context);

    for (const rule of rules) {
      if (isToolNameMatch(toolName, rule.toolName) && rule.contentPattern) {
        ruleByContents.set(rule.contentPattern, rule);
      }
    }

    return ruleByContents;
  }
}
