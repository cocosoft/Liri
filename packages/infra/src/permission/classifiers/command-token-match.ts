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

/**
 * 2026-11-12（P0 · L2 词法归一）：**转义不改变语义**。
 *
 * 三种 shell 的转义符都能把命令名拆开而不改变"被执行者"：
 *  - bash：`r\m -rf /`（反斜杠）；
 *  - cmd：`r^m`（脱字符）；
 *  - PowerShell：`` r`m ``（反引号）。
 *
 * 归一后**与原文并列判定**（任一命中即算命中），而不是替换原文 ——
 * 否则 Windows 路径 `C:\Users\x` 会被剥成 `C:Usersx`，破坏路径类令牌与敏感路径判定的可读性。
 */
function deEscape(text: string): string {
  return text
    .replace(/\\([A-Za-z0-9])/g, '$1')
    .replace(/\^([A-Za-z0-9])/g, '$1')
    .replace(/`([A-Za-z0-9])/g, '$1');
}

/** 单条命令面上限：超长直接不展开（宁可交给 fail-closed 的未知档） */
const MAX_SURFACE_LENGTH = 20000;
/** 最多解码几条编码载荷（防解码炸弹） */
const MAX_ENCODED_BODIES = 3;

/**
 * 2026-11-12（P0 · L6/L1）：提取 `powershell -EncodedCommand <base64>` 的载荷并解码。
 *
 * 背景（实测）：`powershell -EncodedCommand <base64>` 与 `pwsh -enc …` 此前**整体放行**
 * —— 只把 base64 当普通文本匹配，等于给任意代码执行留了后门。
 *
 * 口径：
 *  - 只认 `-EncodedCommand` 及其**无歧义前缀**（`-e` / `-en` / `-ec` / `-enc` …）；
 *  - PowerShell 用 UTF-16LE 传脚本，bash 侧多为 UTF-8 ⇒ 两种都试，取"坏字符更少"的；
 *  - **解码失败 ⇒ `undecodable=true`**（调用方 fail-closed，不得当成"没东西"）。
 */
export function extractEncodedBodies(surface: string): {
  bodies: string[];
  undecodable: boolean;
} {
  const bodies: string[] = [];
  if (surface.length > MAX_SURFACE_LENGTH) return { bodies, undecodable: true };

  const pattern =
    /-(?:e|en|ec|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\b\s+["']?([A-Za-z0-9+/=]{8,})/gi;
  let undecodable = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(surface)) !== null) {
    if (bodies.length >= MAX_ENCODED_BODIES) break;
    const decoded = decodeBase64Payload(match[1]);
    if (decoded) bodies.push(decoded);
    else undecodable = true;
  }
  // 出现了 `-EncodedCommand` 却一条都没解出来（载荷非法 / 全被截断）⇒ 同样不放行
  if (
    bodies.length === 0 &&
    /-(?:ec|enc|encodedcommand)\b/i.test(surface)
  ) {
    undecodable = true;
  }
  return { bodies, undecodable };
}

/** 有界 base64 解码（UTF-16LE / UTF-8 择一）；失败返回 null */
function decodeBase64Payload(payload: string): string | null {
  const cleaned = payload.replace(/[^A-Za-z0-9+/=]/g, '');
  if (cleaned.length < 8) return null;
  try {
    const buffer = Buffer.from(cleaned, 'base64');
    if (buffer.length === 0) return null;
    // 编码判据看**字节形态**而不是"字符串里有没有坏字符"：
    // UTF-16LE 的 ASCII 文本每隔一个字节就是 0x00（`ls -la` → 6c 00 73 00 …）；
    // 若用"坏字符更少"来选，`ls -la` 解成 UTF-16 会得到合法但无意义的中日韩字符，
    // 从而被误判成"非只读"（实测 `-EncodedCommand <ls 的 base64>` 因此转 ask）。
    let zerosAtOdd = 0;
    for (let i = 1; i < buffer.length; i += 2) {
      if (buffer[i] === 0) zerosAtOdd += 1;
    }
    const looksUtf16 = zerosAtOdd * 4 >= buffer.length;
    const text = (looksUtf16
      ? buffer.toString('utf16le')
      : buffer.toString('utf8')
    )
      .replace(/\u0000/g, '')
      .trim();
    if (!text) return null;
    if (text.length > MAX_SURFACE_LENGTH) return null;
    return text;
  } catch {
    // @ignore-catch — 非法 base64 视为"解码失败"，由调用方 fail-closed
    return null;
  }
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
  // 2026-11-12（P0 · L2）：原文与"去转义"变体并列判定（`r\m` / `r^m` / `r`m`）
  const variants = [normalized];
  const deEscaped = deEscape(normalized);
  if (deEscaped !== normalized) variants.push(deEscaped);
  return variants.some((variant) =>
    matchesAnchoredToken(variant, trimmed, depth)
  );
}

/** 在**一个**命令面上做命令位锚定匹配（含嵌套 shell 递归） */
function matchesAnchoredToken(
  normalized: string,
  trimmed: string,
  depth: number
): boolean {
  // 嵌套 shell：把脚本体当作新的命令面**递归锚定**匹配，绝不退回裸子串。
  // 2026-11-11（P3 复查）：原实现「找到脚本体就只判脚本体」⇒ `git config --global
  // core.sshCommand "sh -c id"` 这类「外壳命令 + 内层 shell 参数」的外层令牌被整段跳过
  // （`git config ` 因此漏判）。现改为 **外层锚定命中 或 任一内层命中**。
  const anchored = new RegExp(
    `(?:^|[\\n;|&(){])\\s*(?:(?:${WRAPPER_WORDS})\\s+(?:-[^\\s]+\\s+)*)*` +
      `${escapeRegExp(trimmed)}(?![a-z0-9_-])`,
    'i'
  );
  const outerHit = anchored.test(normalized);
  if (depth < MAX_NESTED_DEPTH) {
    const bodies = extractNestedShellBodies(normalized);
    if (bodies.length > 0) {
      return (
        outerHit ||
        bodies.some((body) => containsCommandToken(body, trimmed, depth + 1))
      );
    }
  }
  return outerHit;
}
