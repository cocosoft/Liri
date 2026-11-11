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
 * `cmd /c "…"`）⇒ 内部命令也处于"命令位"，需要把**脚本体**当作新的命令面再扫一遍
 * （否则内层 `node -e` 会被"只认命令位"漏掉）。
 *
 * ⚠️ 2026-11-11：此前用 `normalized.includes(trimmed)` 做裸子串兜底，而 `trimmed`
 * 已把令牌尾随空格裁掉 ⇒ 单/双字符令牌退化成"词内任意出现"：`'w '`→`'w'` 命中
 * `powershell` 的 w、`'at '`→`'at'` 命中 `Path`、`'ri '`→`'ri'`、`'dir '`→`'dir'`。
 * 真机 auto 档因此把 `powershell -Command "Get-Content …"` 判成危险命令（44 次 deny）。
 * 现改为**提取脚本体 + 递归锚定匹配**，内层同样只认命令位。
 */
const NESTED_SHELL_BODY =
  /(?:^|[\s;&|])(?:bash|sh|zsh|ksh|powershell|pwsh)(?:\s+-[A-Za-z][\w-]*)*\s+-(?:EncodedCommand|Command|lc|c)\b\s+([\s\S]+)|\bcmd(?:\.exe)?\s+\/c\b\s+([\s\S]+)/gi;

/** 递归上限：防止脚本里再套脚本导致无限展开 */
const MAX_NESTED_DEPTH = 3;

/** 去掉包裹脚本体的一层引号（`"node -e x"` ⇒ `node -e x`） */
function stripWrappingQuotes(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  if ((first === '"' || first === "'") && text[text.length - 1] === first) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * 提取嵌套 shell 的脚本体（可多处；`bash -c` / `powershell -Command` / `cmd /c`）。
 * 返回空数组表示"不是嵌套 shell 形态"。
 */
export function extractNestedShellBodies(surface: string): string[] {
  const bodies: string[] = [];
  const re = new RegExp(NESTED_SHELL_BODY.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(surface)) !== null) {
    const body = (match[1] ?? match[2] ?? '').trim();
    if (body) bodies.push(stripWrappingQuotes(body));
    // 零长匹配保护（理论上不会发生，防御正则回退）
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return bodies;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 令牌是否出现在**命令位**（或"位置无关令牌"是否出现） */
export function containsCommandToken(
  surface: string,
  token: string,
  depth = 0
): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  // 引号先归一：`"node" -e` / `'node' -e` 与 `node -e` 等价（引号不改变被执行者）
  const normalized = surface.replace(/["']/g, '');
  if (!/^[a-z0-9_]/i.test(trimmed)) {
    // 元字符令牌：**按原文**匹配（不做裁剪）—— `'. '`/`' ; '` 这类令牌的空白正是它
    // 降低误报的手段，裁成 `'.'`/`';'` 会命中任何句点/分号（真机 `node --check
    // snake.js; Write-Output …` 因此被判危险命令）。大小写不敏感（2026-11-11）：
    // `-ItemType SymbolicLink` / `-itemtype symboliclink` 必须同样命中，否则换个
    // 大小写就能绕过（命令位锚定分支本就带 `i` 标志，此处对齐）。
    //
    // 例外（2026-11-11）：`'.'` 是 **dot-source 命令**（`. ./env.sh`），语义在命令位；
    // 按子串匹配会把 `find . -name "*.tmp" -delete`、`tar -cf a .` 这类正常命令判死
    // （点 + 空格到处都有）⇒ 交给下方锚定分支，只在命令位命中。
    if (trimmed !== '.') {
      return normalized.toLowerCase().includes(token.toLowerCase());
    }
  }
  // 嵌套 shell：把脚本体当作新的命令面**递归锚定**匹配，绝不退回裸子串
  if (depth < MAX_NESTED_DEPTH) {
    const bodies = extractNestedShellBodies(normalized);
    if (bodies.length > 0) {
      return bodies.some((body) =>
        containsCommandToken(body, token, depth + 1)
      );
    }
  }
  const anchored = new RegExp(
    `(?:^|[\\n;|&(){])\\s*(?:(?:${WRAPPER_WORDS})\\s+(?:-[^\\s]+\\s+)*)*` +
      `${escapeRegExp(trimmed)}(?![a-z0-9_-])`,
    'i'
  );
  return anchored.test(normalized);
}
