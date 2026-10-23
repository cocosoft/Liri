// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * commandRuleMatch — 命令自定义规则的**匹配语义单点**（Q-16，2026-10-23）
 *
 * 背景（设计 §3.7.5）：命令黑白名单原先用 `lower.includes(pattern)`，可被构造绕过 ——
 * 白名单 `dir` 会被 `echo dir` 命中，黑名单 `rm` 也会被 `echo rm` 命中。
 *
 * 拍板口径（§9-9）：
 * - 规则新增 `matchType: 'prefix' | 'regex'`，**缺省 `prefix`**；
 * - **存量规则（无 `matchType`）一律按前缀解释**（安全收紧，UI 标注「匹配方式」可改）；
 * - `prefix`：`command.startsWith(pattern)`（大小写不敏感、两端去空白）；
 * - `regex` ：`new RegExp(pattern, 'i')`；**非法正则 ⇒ 不匹配**（记日志，不抛给调用链）。
 *
 * 为什么落在 `utils` 而不是 `permission`：消费方横跨 `permission`（决策链）与
 * `security`（bash 白名单前置检查），落在 `permission` 会让 `security → permission`
 * 的反向依赖变成环；`utils` 是最低层中性位置（与 `toolContract/pathArgs` 同口径）。
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('utils:commandRuleMatch');

/** 规则匹配方式（缺省 `prefix`） */
export type CommandRuleMatchType = 'prefix' | 'regex';

/** 参与匹配的最小规则形状（兼容 `config.types.CommandRule`，只取需要的字段） */
export interface CommandRulePattern {
  pattern: string;
  matchType?: CommandRuleMatchType;
}

/**
 * 单条规则是否命中命令。
 *
 * @param command 原始命令串（内部统一 trim）
 * @param rule    `{ pattern, matchType? }`
 */
export function matchesCommandRule(
  command: string,
  rule: CommandRulePattern
): boolean {
  const pattern = typeof rule.pattern === 'string' ? rule.pattern.trim() : '';
  if (!pattern) return false;

  const trimmed = command.trim();
  if (!trimmed) return false;

  if (rule.matchType === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(trimmed);
    } catch (err) {
      // 配置写坏不该让整条决策链抛错（也不该"当作命中"——白名单会被放大、黑名单会误拦）
      logger.warn('命令规则正则非法，按不匹配处理', {
        pattern,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  return trimmed.toLowerCase().startsWith(pattern.toLowerCase());
}

/** 任一条规则命中即返回 true（空/缺省列表 ⇒ false） */
export function matchesAnyCommandRule(
  command: string,
  rules: readonly CommandRulePattern[] | undefined
): boolean {
  if (!rules || rules.length === 0) return false;
  return rules.some((rule) => matchesCommandRule(command, rule));
}
