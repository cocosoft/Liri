// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令令牌匹配（2026-11-10，用户裁定方案①：解释器名令牌按**命令位**锚定）。
 *
 * 背景：`AutoModeClassifier` 与 `detectCommandInjection` 原本都用 `includes()` 子串匹配
 * 危险令牌 ⇒ 解释器名作为**参数**出现也会命中：
 * `Get-Command node -ErrorAction SilentlyContinue` 命中 `node -e`（真机
 * `session_mwagfxw09146ea473f` 因此被拒），`echo repeat value` 命中 `at `。
 *
 * 口径：
 *  - 令牌是**命令词**（字母/数字/下划线开头）⇒ 必须出现在**命令位**：串首 / 行首 /
 *    分隔符（`; | & ( ) {` 换行）之后，且允许跨 `sudo`/`env`/`xargs` 等外壳命令；
 *  - 令牌以元字符开头（`&&`、`|`、`>/etc/passwd`、`$(`、`${`）⇒ 位置无关，保持子串匹配。
 *
 * ⚠️ 入参必须是**执行面原文**（`command` / `code`），不能是 `JSON.stringify` 的文本：
 * 后者以 `{"command":"` 开头，任何"句首"锚点都会失效。
 */

/** 可跳过继续扫描的外壳命令（`sudo rm -rf /` 仍要命中 `rm -rf`） */
const WRAPPER_WORDS =
  'sudo|doas|env|nohup|nice|ionice|time|stdbuf|xargs|exec|command';

/**
 * 嵌套 shell：命令体本身就是一段脚本（`bash -c "…"` / `powershell -Command "…"` /
 * `cmd /c "…"`）⇒ 内部命令也处于"命令位"，需要按子串再扫一遍（否则内层 `node -e`
 * 会被"只认命令位"漏掉）。
 */
const NESTED_SHELL =
  /(?:^|[\s;&|])(?:bash|sh|zsh|ksh|powershell|pwsh)(?:\s+-\S+)*\s+(?:-c|-lc|-Command|-EncodedCommand)\b|\bcmd(?:\.exe)?\s+\/c\b/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 令牌是否出现在**命令位**（或"位置无关令牌"是否出现） */
export function containsCommandToken(surface: string, token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  // 引号先归一：`"node" -e` / `'node' -e` 与 `node -e` 等价（引号不改变被执行者）
  const normalized = surface.replace(/["']/g, '');
  if (!/^[a-z0-9_]/i.test(trimmed)) {
    // 元字符令牌：**按原文**匹配（不做裁剪）—— `'. '`/`' ; '` 这类令牌的空白正是它
    // 降低误报的手段，裁成 `'.'`/`';'` 会命中任何句点/分号（真机 `node --check
    // snake.js; Write-Output …` 因此被判危险命令）。
    return normalized.includes(token);
  }
  // 嵌套 shell 的脚本体：内层命令同样处于命令位
  if (NESTED_SHELL.test(normalized) && normalized.includes(trimmed)) return true;
  const anchored = new RegExp(
    `(?:^|[\\n;|&(){])\\s*(?:(?:${WRAPPER_WORDS})\\s+(?:-[^\\s]+\\s+)*)*` +
      `${escapeRegExp(trimmed)}(?![a-z0-9_-])`,
    'i'
  );
  return anchored.test(normalized);
}
