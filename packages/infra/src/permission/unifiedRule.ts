// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 统一 Rule 模型（P2-1，2026-11-03）
 *
 * 背景（`dev_docs/20261027/工具权限体系归一化方案-20261027.md` §5 P2-1）：
 * 工具权限规则有 **4 个有状态的来源**，字段与语义各不相同：
 * - A 体系：`tool_rules.json`（`PermissionRule`）
 * - settings 三件套：`permissions.{allow,deny,ask}`（Claude 风格字符串）
 * - B 体系：`permission.customRules.commandRules`（命令黑白名单）
 * - StandingRuleEngine：任务级内存批准（`StandingRule`）
 *
 * 本模块把它们**只读投影**成一个 `UnifiedRule`（`scope` + `matcher` + `behavior` + `source`），
 * 用于：
 * 1. 面板/API 一次性展示"这个工具调用到底受哪些规则约束"；
 * 2. dry-run 迁移差异（`diffUnifiedRules`）；
 * 3. P3 决策链切换的唯一数据形状。
 *
 * **硬约束**：本模块**纯函数、无 IO**，且**不重写任何来源文件**；
 * 写回只在显式 `--migrate` 的 CLI 中发生（见 `scripts/migrate-permission-rules.ts`）。
 *
 * `source` 必须保留：UI 按来源分组，并据此生成「可删性」文案
 * （规则在 `tool_rules.json` 可删，settings 里要去改文件 —— 见 `PermissionManager` 的 LRO-07 修复）。
 */

import type { PermissionRule } from './types/PermissionRule';
import { PermissionRuleSource } from './types/PermissionRule';
import type { StandingRule } from './StandingRuleEngine';

/** 规则作用域 */
export type UnifiedRuleScope = 'tool' | 'call' | 'command' | 'path' | 'task';

/** 规则行为（与 `PermissionBehavior` 的字符串值一致） */
export type UnifiedRuleBehavior = 'allow' | 'deny' | 'ask';

/** 来源键（A / settings / B / StandingRule） */
export type UnifiedRuleSourceKey =
  | 'ruleStore'
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'system'
  | 'session'
  | 'command'
  | 'commandRules'
  | 'standingRule';

/** 规则匹配器（按 scope 取用其中一项；未用字段为空） */
export interface UnifiedRuleMatcher {
  toolName?: string;
  contentPattern?: string;
  inputFingerprint?: string;
  command?: string;
  commandMatchType?: 'prefix' | 'regex';
  path?: string;
  target?: string;
}

/** 统一规则 */
export interface UnifiedRule {
  /** 稳定 ID（同一来源 + 同一匹配 ⇒ 跨次运行一致，便于 diff） */
  id: string;
  scope: UnifiedRuleScope;
  matcher: UnifiedRuleMatcher;
  behavior: UnifiedRuleBehavior;
  /** 来源（UI 分组 / 可删性文案依据） */
  source: UnifiedRuleSourceKey;
  /** 优先级（高者先判；同一命令的 deny 仍由决策链另行保证优先） */
  priority: number;
  /** 用户在 UI 上的删除入口说明 */
  removableVia: string;
  /** 过期时间（仅 task scope） */
  expiresAt?: number;
}

/** settings 三件套的读取结果（单个文件） */
export interface SettingsRulesInput {
  source: PermissionRuleSource;
  allow: string[];
  deny: string[];
  ask: string[];
}

/** B 体系 `commandRules` 配置（与 `CustomRulesConfig.commandRules` 同构） */
export interface CommandRulesInput {
  blacklist: Array<{ pattern: string; matchType?: 'prefix' | 'regex' }>;
  whitelist: Array<{ pattern: string; matchType?: 'prefix' | 'regex' }>;
  mode: 'whitelist' | 'blacklist';
}

/** 优先级：规则库 > 策略/本地/项目/用户 settings > 命令规则 > 任务级 */
const SOURCE_PRIORITY: Record<UnifiedRuleSourceKey, number> = {
  ruleStore: 100,
  policySettings: 90,
  localSettings: 80,
  projectSettings: 70,
  userSettings: 60,
  flagSettings: 55,
  cliArg: 50,
  commandRules: 40,
  standingRule: 30,
  system: 20,
  session: 10,
  command: 10,
};

/** 可删性文案（UI 用） */
const REMOVABLE_VIA: Record<UnifiedRuleSourceKey, string> = {
  ruleStore: '权限面板 / DELETE /v1/permissions/rules/:id',
  userSettings: '~/.pyapp/settings.json 的 permissions.{allow,deny,ask}',
  projectSettings: '项目 .liri/settings.json 的 permissions',
  localSettings: '~/.pyapp/settings.local.json 的 permissions',
  flagSettings: 'flags 配置（只读，需改配置源）',
  policySettings: '企业策略配置（只读）',
  cliArg: '启动参数（重启生效）',
  command: '运行时命令（不可持久化删除）',
  system: '系统内置（不可删除）',
  session: '会话级规则（结束会话即失效）',
  commandRules: '设置 → 命令黑白名单（config.permission.customRules.commandRules）',
  standingRule: '任务作用域批准（删除任务或等待过期）',
};

/**
 * A/B 体系速查表的表格行（P3-4，2026-11-03）。
 *
 * 唯一事实来源：内置技能 `update-config` 的「Liri 权限体系速查表」直接内插
 * `renderRuleSourceDocRows()` 的输出，避免文档再抄一份入口与规则形态
 * （此前 A 体系路径与 B 体系配置键是两处独立维护，已发生过漂移）。
 * 「审批放行缓存」不属于 Rule 来源（属 `ApprovedCommandRegistry`），仍由调用方列出。
 */
export const RULE_SOURCE_DOC_ROWS: ReadonlyArray<{
  system: string;
  entry: string;
  shape: string;
  timing: string;
}> = [
  {
    system: 'A 工具级规则',
    entry: '`~/.pyapp/data/permissions/tool_rules.json`',
    shape: '`{behavior: allow|deny|ask, toolName, contentPattern?}`',
    timing: '每次工具调用（决策主链路）',
  },
  {
    system: 'B 命令级黑白名单',
    entry: '设置→自定义规则（配置 `permission.customRules.commandRules`）',
    shape: '`{blacklist[], whitelist[], mode: blacklist|whitelist}`',
    timing:
      'bash/shell/command 命令内容级；黑名单命中 deny；whitelist 模式命中 allow（免审批）、未命中 deny',
  },
];

/** 渲染为 Markdown 表格行（不含表头），供内置技能文档内插 */
export function renderRuleSourceDocRows(): string {
  return RULE_SOURCE_DOC_ROWS.map(
    (row) => `| ${row.system} | ${row.entry} | ${row.shape} | ${row.timing} |`
  ).join('\n');
}

/** 规则 id（确定性） */
function ruleId(
  source: UnifiedRuleSourceKey,
  scope: UnifiedRuleScope,
  matcher: UnifiedRuleMatcher
): string {
  const key = Object.keys(matcher)
    .sort()
    .map((k) => `${k}=${String((matcher as Record<string, unknown>)[k])}`)
    .join('&');
  return `unified:${source}:${scope}:${key}`;
}

/** 规则来源 → 来源键（`PermissionRuleSource` 已覆盖 9 项，含 `ruleStore`） */
function sourceKeyOf(source: PermissionRuleSource): UnifiedRuleSourceKey {
  const raw = String(source);
  if (raw in SOURCE_PRIORITY) return raw as UnifiedRuleSourceKey;
  return 'userSettings';
}

/**
 * A 体系（`tool_rules.json`）→ 统一规则。
 *
 * `contentPattern` ⇒ scope=call；`inputFingerprint` ⇒ scope=call（指纹精确匹配）；
 * 两者都无 ⇒ scope=tool。
 */
export function permissionRulesToUnified(rules: PermissionRule[]): UnifiedRule[] {
  return rules.map((rule) => {
    const scope: UnifiedRuleScope =
      rule.contentPattern || rule.inputFingerprint ? 'call' : 'tool';
    const matcher: UnifiedRuleMatcher = { toolName: rule.toolName };
    if (rule.contentPattern) matcher.contentPattern = rule.contentPattern;
    if (rule.inputFingerprint) matcher.inputFingerprint = rule.inputFingerprint;
    const source = sourceKeyOf(rule.source);
    return {
      id: ruleId(source, scope, matcher),
      scope,
      matcher,
      behavior: String(rule.behavior) as UnifiedRuleBehavior,
      source,
      // 来源优先级是**下限**：规则自带 priority 更小也不能低于来源档
      priority: Math.max(rule.priority || 0, SOURCE_PRIORITY[source]),
      removableVia: REMOVABLE_VIA[source],
    };
  });
}

/** 解析 settings 规则文本：`Bash(npm run test:*)` ⇒ {toolName:'Bash', contentPattern:'npm run test:*'} */
export function parseSettingsRuleText(
  text: string
): UnifiedRuleMatcher | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^([A-Za-z][A-Za-z0-9_.-]*)(?:\((.*)\))?$/.exec(trimmed);
  if (!match) return null;
  const matcher: UnifiedRuleMatcher = { toolName: match[1]! };
  if (match[2] !== undefined && match[2] !== '') {
    matcher.contentPattern = match[2];
  }
  return matcher;
}

/** settings 三件套 → 统一规则（allow / deny / ask 各一份，来源保留） */
export function settingsToUnified(input: SettingsRulesInput): UnifiedRule[] {
  const source = sourceKeyOf(input.source);
  const out: UnifiedRule[] = [];
  const groups: Array<[string[], UnifiedRuleBehavior]> = [
    [input.allow, 'allow'],
    [input.deny, 'deny'],
    [input.ask, 'ask'],
  ];
  for (const [texts, behavior] of groups) {
    for (const text of texts) {
      const matcher = parseSettingsRuleText(text);
      if (!matcher) continue;
      const scope: UnifiedRuleScope = matcher.contentPattern ? 'call' : 'tool';
      out.push({
        id: ruleId(source, scope, matcher),
        scope,
        matcher,
        behavior,
        source,
        priority: SOURCE_PRIORITY[source],
        removableVia: REMOVABLE_VIA[source],
      });
    }
  }
  return out;
}

/**
 * B 体系命令规则 → 统一规则（scope=command）。
 *
 * `mode === 'whitelist'` 且 whitelist 非空时，追加一条「未命中即拒绝」的兜底规则
 * （与 `commandRulePolicy` 的运行时语义一致：空白名单视为未配置）。
 */
export function commandRulesToUnified(input: CommandRulesInput): UnifiedRule[] {
  const out: UnifiedRule[] = [];
  const source: UnifiedRuleSourceKey = 'commandRules';
  const push = (
    pattern: string,
    behavior: UnifiedRuleBehavior,
    matchType?: 'prefix' | 'regex'
  ): void => {
    const matcher: UnifiedRuleMatcher = { command: pattern };
    if (matchType) matcher.commandMatchType = matchType;
    out.push({
      id: ruleId(source, 'command', matcher),
      scope: 'command',
      matcher,
      behavior,
      source,
      priority: SOURCE_PRIORITY[source],
      removableVia: REMOVABLE_VIA[source],
    });
  };

  for (const rule of input.blacklist) push(rule.pattern, 'deny', rule.matchType);
  for (const rule of input.whitelist) push(rule.pattern, 'allow', rule.matchType);

  if (input.mode === 'whitelist' && input.whitelist.length > 0) {
    const matcher: UnifiedRuleMatcher = { command: '*' };
    out.push({
      id: ruleId(source, 'command', matcher),
      scope: 'command',
      matcher,
      behavior: 'deny',
      source,
      priority: SOURCE_PRIORITY[source] + 1,
      removableVia: REMOVABLE_VIA[source],
    });
  }
  return out;
}

/** StandingRuleEngine（任务级内存批准）→ 统一规则（scope=task，带 expiresAt） */
export function standingRulesToUnified(rules: StandingRule[]): UnifiedRule[] {
  const source: UnifiedRuleSourceKey = 'standingRule';
  const out: UnifiedRule[] = [];
  for (const rule of rules) {
    const targets =
      rule.allowedTargets.size > 0 ? Array.from(rule.allowedTargets) : ['*'];
    for (const target of targets) {
      const matcher: UnifiedRuleMatcher = { toolName: rule.toolName, target };
      out.push({
        id: ruleId(source, 'task', matcher),
        scope: 'task',
        matcher,
        behavior: 'allow',
        source,
        priority: SOURCE_PRIORITY[source],
        removableVia: REMOVABLE_VIA[source],
        ...(rule.expiresAt ? { expiresAt: rule.expiresAt } : {}),
      });
    }
  }
  return out;
}

/**
 * 合并多来源（**读取合并**，不改任何来源文件）。
 *
 * 去重键：`scope + matcher + behavior`。同一键保留**优先级最高**的一条；
 * 排序：priority 降序 + id 升序（保证 diff 稳定）。
 */
export function mergeUnifiedRules(parts: UnifiedRule[][]): UnifiedRule[] {
  const byKey = new Map<string, UnifiedRule>();
  for (const part of parts) {
    for (const rule of part) {
      const key = `${rule.scope}|${JSON.stringify(rule.matcher)}|${rule.behavior}`;
      const prev = byKey.get(key);
      if (!prev || rule.priority > prev.priority) byKey.set(key, rule);
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id)
  );
}

/** dry-run 差异 */
export interface UnifiedRuleDiff {
  added: UnifiedRule[];
  removed: UnifiedRule[];
  /** 同一 id、不同行为的规则（迁移前后语义变化） */
  changed: Array<{ before: UnifiedRule; after: UnifiedRule }>;
}

/** 计算迁移前后差异（供 `--dry-run` 打印 / 用户核对） */
export function diffUnifiedRules(
  before: UnifiedRule[],
  after: UnifiedRule[]
): UnifiedRuleDiff {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterById = new Map(after.map((r) => [r.id, r]));
  const added = after.filter((r) => !beforeById.has(r.id));
  const removed = before.filter((r) => !afterById.has(r.id));
  const changed: Array<{ before: UnifiedRule; after: UnifiedRule }> = [];
  for (const [id, next] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) continue;
    if (
      prev.behavior !== next.behavior ||
      prev.priority !== next.priority ||
      prev.scope !== next.scope
    ) {
      changed.push({ before: prev, after: next });
    }
  }
  return { added, removed, changed };
}

/** 按来源分组（UI 分组 / 可删性文案） */
export function groupBySource(
  rules: UnifiedRule[]
): Record<string, UnifiedRule[]> {
  const groups: Record<string, UnifiedRule[]> = {};
  for (const rule of rules) {
    (groups[rule.source] ??= []).push(rule);
  }
  return groups;
}
