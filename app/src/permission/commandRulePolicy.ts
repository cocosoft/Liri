// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * commandRulePolicy — 用户「命令级黑白名单」（B 体系）的**判定单点**（2026-10-27，权限归一化 P0-2）
 *
 * 背景：`permission.customRules.commandRules` 一直只存在于配置类型与设置页，
 * 匹配语义 `utils/commandRuleMatch.ts` 也早已就绪（前缀/regex，缺省 prefix），
 * 但**运行时零消费者** ⇒ 用户按文档配置不生效（方案 §2 B3）。
 *
 * 本模块把它接到 Bash 安全门（`tools/bash/bashSecurityGate.ts`），口径：
 * - **黑名单命中 ⇒ deny**（原因码 `custom_blacklist`，带命中规则）；
 * - `mode === 'whitelist'` 且**命中白名单 ⇒ allow（免审批）**，由调用方跳过后继 ask；
 * - `mode === 'whitelist'` 且**未命中 ⇒ deny**（原因码 `custom_whitelist_miss`）；
 * - **白名单模式但白名单为空 ⇒ 视为未配置**（不拦），并记一次 warn 防"误切换把 shell 全锁死"。
 *
 * 纯函数（除 `readCommandRulesConfig` 的配置读取）⇒ 可直接单测。
 */

import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { matchesCommandRule } from '@modules/utils/commandRuleMatch';

const logger = getLogger('permission:commandRulePolicy');

/** 与 `config.types.CommandRule` 结构兼容（只取判定所需字段） */
export interface CommandRuleLike {
  pattern: string;
  matchType?: 'prefix' | 'regex';
  type?: 'blacklist' | 'whitelist';
  label?: string;
}

export interface CommandRulesSettings {
  blacklist: CommandRuleLike[];
  whitelist: CommandRuleLike[];
  mode: 'whitelist' | 'blacklist';
}

export type CommandRuleVerdict =
  | { behavior: 'deny'; reasonCode: 'custom_blacklist'; rule: CommandRuleLike }
  | { behavior: 'deny'; reasonCode: 'custom_whitelist_miss' }
  | {
      behavior: 'allow';
      reasonCode: 'custom_whitelist_hit';
      rule: CommandRuleLike;
    };

/**
 * 读取用户配置（`permission.customRules.commandRules`）。
 *
 * 缺省 / 空对象 ⇒ `undefined`（= 未配置，判定为"无意见"），避免默认把命令拦掉。
 */
export function readCommandRulesConfig(): CommandRulesSettings | undefined {
  try {
    const permission = configManager.getConfigValue<{
      customRules?: { commandRules?: Partial<CommandRulesSettings> };
    }>('permission');
    const raw = permission?.customRules?.commandRules;
    if (!raw) return undefined;
    const blacklist = Array.isArray(raw.blacklist) ? raw.blacklist : [];
    const whitelist = Array.isArray(raw.whitelist) ? raw.whitelist : [];
    const mode = raw.mode === 'whitelist' ? 'whitelist' : 'blacklist';
    if (blacklist.length === 0 && whitelist.length === 0) return undefined;
    return { blacklist, whitelist, mode };
  } catch (err) {
    // 配置读取失败不得改变安全姿态：按未配置处理并留痕（CS03-002）
    logger.warn('命令级规则读取失败，按未配置处理', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * 判定一条命令是否被用户命令级规则拦截/放行。
 *
 * @returns `null` = 无意见（继续走后续安全门）；否则为明确判定
 */
export function evaluateCommandRules(
  command: string,
  settings?: CommandRulesSettings
): CommandRuleVerdict | null {
  if (!settings) return null;
  const trimmed = command.trim();
  if (!trimmed) return null;

  const blackHit = settings.blacklist.find((rule) =>
    matchesCommandRule(trimmed, rule)
  );
  if (blackHit) {
    // 黑名单永远优先（与"deny 先于 allow"同口径）
    return { behavior: 'deny', reasonCode: 'custom_blacklist', rule: blackHit };
  }

  if (settings.mode === 'whitelist') {
    if (settings.whitelist.length === 0) {
      // 空白名单 = 未配置：若按字面执行会把所有命令拦死（误切换代价过高）
      logger.warn('命令级规则为 whitelist 模式但白名单为空，本次按未配置处理', {
        commandPreview: trimmed.slice(0, 120),
      });
      return null;
    }
    const whiteHit = settings.whitelist.find((rule) =>
      matchesCommandRule(trimmed, rule)
    );
    if (whiteHit) {
      return {
        behavior: 'allow',
        reasonCode: 'custom_whitelist_hit',
        rule: whiteHit,
      };
    }
    return { behavior: 'deny', reasonCode: 'custom_whitelist_miss' };
  }

  return null;
}
