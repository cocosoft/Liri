// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令**等价组**归一表（2026-11-11；P1 起由 `commandSpecs.ts` 派生）。
 *
 * 背景：权限表此前逐个枚举命令名，各种写法总会漏 —— 先漏短别名（`ac`/`sc`/`clc`、
 * `cpi`/`mi`），再漏 **classic CLI → cmdlet** 方向（`ren` 已收而 `Rename-Item` 放行、
 * `sc create` 已拦而 `New-Service` 放行）。本模块把「同一操作的全部写法」集中一处，
 * 判定时对**代表令牌**展开同组其余成员一起判 ⇒ 新增写法只改 `COMMAND_SPECS`。
 *
 * 使用方：`AutoModeClassifier`（`expandTokenAliases()` + `containsCommandToken()`）。
 *
 * ⚠️ 边界：
 *  - **原始命令名永远先判**：`sc create`（服务控制）仍由硬拦令牌先命中，不受
 *    `sc → set-content` 归一影响；
 *  - 只作用于**命令位首词**（锚定由 `containsCommandToken` 保证），不做全文替换；
 *  - 歧义写法（`sc` 既是 Set-Content 又是服务控制）按"两种身份都判"：任一侧命中即生效；
 *  - **组内成员必须同档**（全 deny 或全 ask）：跨档归一会让 `rm` 的审批被
 *    `remove-item` 的硬拦顶掉 ⇒ 因此 `rm` 不与 `remove-item` 同组。
 */

import { equivalenceGroupsFromSpecs } from './commandSpecs';

/** 等价组（每组首项为代表写法），来源：`COMMAND_SPECS` */
export const COMMAND_EQUIVALENCE_GROUPS: readonly (readonly string[])[] =
  equivalenceGroupsFromSpecs();

/**
 * 组内**非代表成员 → 代表成员**（每个等价组的第一项为代表名）。
 *
 * 仅作可读视图与兼容导出；判定用的是 `COMMAND_EQUIVALENCE_GROUPS`。
 */
export const COMMAND_ALIASES: ReadonlyMap<string, string> = new Map(
  COMMAND_EQUIVALENCE_GROUPS.flatMap(([canonical, ...aliases]) =>
    aliases.map((alias) => [alias, canonical] as const)
  )
);

/** 成员名 → 所在等价组（构造期算一次） */
const GROUP_BY_MEMBER: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, readonly string[]>();
  for (const group of COMMAND_EQUIVALENCE_GROUPS) {
    for (const member of group) map.set(member, group);
  }
  return map;
})();

/**
 * 把令牌展开成**同组等价写法**（保留令牌余下部分，排除自身）。
 *
 * 例：`'set-content'` ⇒ `['sc', 'add-content', 'ac', …]`；
 * `'ren '` ⇒ `['move-item', 'mi', 'mv', 'move', 'rename-item', 'rni']`；
 * 非等价组令牌（`'git push'` / 元字符令牌）⇒ `[]`。
 */
export function expandTokenAliases(token: string): string[] {
  const matched = token.match(/^([A-Za-z0-9_-]+)(.*)$/);
  if (!matched) return [];
  const head = matched[1].toLowerCase();
  const group = GROUP_BY_MEMBER.get(head);
  if (!group) return [];
  return group
    .filter((member) => member !== head)
    .map((member) => `${member}${matched[2]}`);
}
