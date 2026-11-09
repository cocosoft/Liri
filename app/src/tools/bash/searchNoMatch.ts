/**
 * 「检索无匹配」判定（P3，2026-11-04 前端会话跟踪）
 *
 * **背景（真机会话实证）**：`dir /b /s /ad 2>nul | findstr /i "mario"` 退出码 1、stdout/stderr
 * 均空 —— 这是 `findstr` / `grep` 的**约定语义**（"没有匹配项"即退出码 1），不是执行失败。
 * 旧实现一律走 `bash: execute_error` + failure 结果 ⇒ 每轮计入 `all-tools-failed`
 * （实测 3 次即触发熔断），模型只能反复重试同一条命令。
 *
 * **判据刻意收窄**（避免把真失败当成功）：
 *   ① 退出码**恰为 1**（2 及以上是语法/IO 错误，照旧失败）；
 *   ② stdout 与 stderr **均为空**（有输出说明检索到了内容或报错）；
 *   ③ 管道/串联的**最后一段**是检索类命令（`findstr` / `grep` / `rg` / `select-string` 等）；
 *   ④ 最后一段**没有输出重定向**（`> file` 时"无匹配"与"写进文件"无法区分）。
 *
 * 2026-11-09（会话 `session_mw8fwx3a48ba9e07f9` 复盘）：无管道形态原先**一律不判无匹配**
 * （怕 `findstr x missing.txt` 把"缺文件"洗成成功）⇒ `cd /d X && findstr /n /c:"…" tests\run-tests.mjs`
 * 这类"目标文件确实存在"的检索仍被记为工具失败，推高熔断计数。现由调用方用
 * `hasExistingSearchFileTarget()` 探测目标文件是否真实存在，成立才放行无管道判据。
 */

// P1-1（2026-11-06）：末段提取与「检查未通过」判定共用（CS01，单一实现）
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { lastCommandSegment } from './exitSemantics';

/** 检索类命令（最后一段的首个词） */
const SEARCH_COMMANDS = [
  'findstr',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'select-string',
];

/** 解析末段检索命令（首个词 + 参数）；非检索命令 / 含输出重定向 ⇒ `null` */
function parseLastSearchSegment(
  command: string
): { first: string; args: string[] } | null {
  const segment = lastCommandSegment(command);
  if (!segment) return null;
  // 输出重定向 ⇒ "无匹配"与"结果写进文件"不可区分
  if (segment.includes('>')) return null;
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const head = tokens[0];
  if (!head) return null;
  // 去掉可能的引号包裹与 `.exe` 后缀
  const first = head
    .replace(/^["']|["']$/g, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
  if (!SEARCH_COMMANDS.includes(first)) return null;
  return { first, args: tokens.slice(1) };
}

/** 命令里最后一次 `cd` 的目标目录（`cd /d "X"` / `cd "X"` / `cd X`） */
function lastCdTarget(command: string): string | undefined {
  const re =
    /(?:^|&&|&|;|\|)\s*cd(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|([^\s&|;]+))/gi;
  let match: RegExpExecArray | null;
  let target: string | undefined;
  while ((match = re.exec(command)) !== null) {
    target = match[1] ?? match[2] ?? match[3];
  }
  return target;
}

export function isSearchNoMatch(params: {
  command: string | undefined;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /**
   * 2026-11-09：无管道时，末段检索命令的**目标文件确实存在**（调用方经 fs 探测）。
   * 成立 ⇒ `exit 1 + 双空` 同样是无匹配；不成立 ⇒ 维持旧口径（无法区分"缺文件"）。
   */
  hasExistingFileTarget?: boolean;
}): boolean {
  if (params.exitCode !== 1) return false;
  if ((params.stdout ?? '').trim() || (params.stderr ?? '').trim())
    return false;
  const command = params.command ?? '';
  // F3b（2026-11-04，真实执行对照发现）：无管道时必须有"目标文件存在"证据 ——
  // 反例 `findstr x missing.txt`（文件不存在）在本机同样是 exit 1 + 双空。
  if (!command.includes('|') && params.hasExistingFileTarget !== true)
    return false;
  return parseLastSearchSegment(command) !== null;
}

/**
 * 末段检索命令是否指向**真实存在的文件**（供 `isSearchNoMatch` 的无管道判据使用）。
 *
 * 解析口径：跳过 `findstr` 的 `/开关`、`grep` 族的 `-开关`、变量/通配参数；
 * 其余参数按"相对最后一次 `cd` 目标（缺省 `cwd`）"解析，任一命中真实文件即返回 true。
 * 任何探测失败都按"不存在"处理（fail-closed：维持旧口径，不把真失败洗白）。
 */
export function hasExistingSearchFileTarget(
  command: string,
  cwd?: string
): boolean {
  const parsed = parseLastSearchSegment(command);
  if (!parsed) return false;
  const cdDir = lastCdTarget(command);
  const base = cdDir
    ? resolve(cwd ?? process.cwd(), cdDir)
    : (cwd ?? process.cwd());
  for (const raw of parsed.args) {
    const arg = raw.replace(/^["']|["']$/g, '');
    if (!arg) continue;
    if (parsed.first === 'findstr' && /^\/[A-Za-z]/.test(arg)) continue;
    if (arg.startsWith('-')) continue;
    if (/[%$`]/.test(arg)) continue;
    if (/[*?]/.test(arg)) continue;
    const target = isAbsolute(arg) ? arg : resolve(base, arg);
    try {
      if (statSync(target).isFile()) return true;
    } catch {
      // @ignore-catch — 参数不是可读文件 ⇒ 继续看下一个参数（最终返回 false）
    }
  }
  return false;
}
