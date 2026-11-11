// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令别名归一表（2026-11-11）——「按命令名枚举」的结构性补丁。
 *
 * 背景：权限表此前逐个枚举命令名，各 shell 的**短别名**总会漏（本轮连续出现
 * `ac`/`sc`/`clc`、`cpi`/`mi` 等）。本表把「别名 → 规范名」集中一处；判定时对
 * **规范名令牌**展开别名一起判 ⇒ 新增别名只改这张表，不改两张令牌表。
 *
 * 使用方：`AutoModeClassifier`（`expandTokenAliases()` + `containsCommandToken()`）。
 *
 * ⚠️ 边界：
 *  - **原始命令名永远先判**：`sc create`（服务控制）仍由硬拦令牌先命中，不受
 *    `sc → set-content` 归一影响；
 *  - 只作用于**命令位首词**（锚定由 `containsCommandToken` 保证），不做全文替换；
 *  - 歧义别名（`sc` 既是 Set-Content 又是服务控制）按"两种身份都判"：任一侧命中即生效。
 */

/** 别名 → 规范名（全部小写；PowerShell / cmd 为主） */
export const COMMAND_ALIASES: ReadonlyMap<string, string> = new Map([
  // PowerShell 写盘 / 文件操作别名
  ['ac', 'add-content'],
  ['sc', 'set-content'],
  ['clc', 'clear-content'],
  ['ni', 'new-item'],
  ['ri', 'remove-item'],
  ['cpi', 'copy-item'],
  ['mi', 'move-item'],
]);

/** 规范名 → 别名列表（反向索引，构造期算一次） */
const ALIASES_BY_CANONICAL: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [alias, canonical] of COMMAND_ALIASES) {
    const list = map.get(canonical) ?? [];
    list.push(alias);
    map.set(canonical, list);
  }
  return map;
})();

/**
 * 把**规范名令牌**展开成别名等价写法（保留令牌余下部分）。
 *
 * 例：`'set-content'` ⇒ `['sc']`；`'copy-item'` ⇒ `['cpi']`；非规范名 ⇒ `[]`。
 */
export function expandTokenAliases(token: string): string[] {
  const matched = token.match(/^([A-Za-z0-9_-]+)(.*)$/);
  if (!matched) return [];
  const aliases = ALIASES_BY_CANONICAL.get(matched[1].toLowerCase());
  if (!aliases) return [];
  return aliases.map((alias) => `${alias}${matched[2]}`);
}
