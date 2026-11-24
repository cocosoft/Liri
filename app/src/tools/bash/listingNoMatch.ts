/**
 * 「列举无匹配」判定 + 失败可观测性提示（2026-11-24，会话 `session_mwurduuh1b0b38db30` 复盘）
 *
 * **真机背景**：模型用 `dir /b /s "...*SessionStateMachine*" 2>nul & dir ...` 探测文件，
 * 目标确实没有匹配（文件实际在 `packages/infra/...`）⇒ cmd 返回 `File Not Found` + 退出码 1；
 * 但 `2>nul` 把唯一的诊断吞掉 ⇒ stdout/stderr 双空。既有两条判定都不命中：
 *   - `searchNoMatch`：只认末段为 `findstr`/`grep` 等**检索**命令；
 *   - `pathNotFound`：要求错误文本含 `File Not Found`（已被 `2>nul` 抹掉）。
 * 结果：一句 `Command failed（退出码: 1）` 被记为工具失败，模型误判"路径不存在"并反复重试。
 *
 * 本模块做三件**不改判定链**的事：
 *   ① `isListingNoMatch`：`dir` 无匹配/空目录（exit 1 + 双空 + 末段为 dir + stderr 被 `2>nul` 抑制
 *      + 目标目录经 fs 探测**确实存在**）⇒ 事实结果，不当执行失败；
 *   ② `buildStderrSuppressedHint`：非 0 退出且 `2>nul` 吞掉 stderr ⇒ 提示去掉重定向再试（判定不变）；
 *   ③ `buildAndChainHint`：命令含 `&&` ⇒ 明示"前段非 0 会跳过其后所有段"（避免"未执行"被读成"不存在"）。
 *
 * **刻意收窄（避免把真失败洗白）**：
 *   - 退出码必须恰为 1（2+ 是语法/IO 错误）；
 *   - stdout/stderr 必须都空，且末段确有 `2>nul`（否则空 stderr 解释不通）；
 *   - 末段不得含其它输出重定向（`>file` / `>>file`）；
 *   - **命令含 `&&` 时不判无匹配**：无法确定是哪一段失败，末段可能根本没执行（只给提示）。
 *
 * 纯函数 + fs 探测；平台可注入，便于单测。
 */

import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** `2>nul` / `2> nul`（cmd 的 stderr 丢弃） */
const STDERR_TO_NUL_RE = /2>\s*nul\b/i;

/** 输出重定向（判完 `2>nul` 后仍残留 ⇒ 有写盘意图，不判"无匹配"） */
const OUTPUT_REDIRECT_RE = />>?/;

/** 按引号外的 `&` / `|` / `;` 切段（`&&`、`||` 整体切掉） */
function splitSegments(command: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '&' || ch === '|' || ch === ';') {
      out.push(buf);
      buf = '';
      // `&&` / `||` 的下一个同字符一并吃掉
      if (command[i + 1] === ch) i++;
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

function lastSegment(command: string): string {
  const segs = splitSegments(command);
  return segs[segs.length - 1] ?? '';
}

/** 命令里最后一次 `cd` 的目标（`cd /d X` / `cd "X"` / `cd X`） */
function lastCdTarget(command: string): string | undefined {
  let target: string | undefined;
  for (const seg of splitSegments(command)) {
    const m = /^cd(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|([^\s&|;]+))/i.exec(seg);
    if (m) target = m[1] ?? m[2] ?? m[3];
  }
  return target;
}

interface DirTarget {
  /** 用于 fs 探测的路径（带通配符时取所在目录；无通配符时取目标本身） */
  probePath: string;
  hasWildcard: boolean;
}

/** 解析 `dir` 末段的目标路径（跳过 `/b` `/s` 等开关；缺省 ⇒ 当前目录） */
function parseDirTarget(
  segment: string,
  baseCwd: string
): DirTarget | undefined {
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const first = (tokens[0] ?? '').replace(/^["']|["']$/g, '').toLowerCase();
  if (first !== 'dir') return undefined;
  let raw: string | undefined;
  for (const t of tokens.slice(1)) {
    const token = t.replace(/^["']|["']$/g, '');
    if (!token) continue;
    // 重定向（`2>nul` / `>file`）不是路径参数 ⇒ 目标到此为止
    if (/^\d*>>?/.test(token)) break;
    if (token.startsWith('/')) continue;
    raw = token;
    break;
  }
  if (!raw) return { probePath: baseCwd, hasWildcard: false };
  // 通配符通常只出现在最后一段：取所在目录做存在性探测
  const sep = Math.max(raw.lastIndexOf('\\'), raw.lastIndexOf('/'));
  if (/[*?]/.test(raw)) {
    const dirPart = sep >= 0 ? raw.slice(0, sep) : '.';
    return {
      probePath: isAbsolute(dirPart) ? dirPart : resolve(baseCwd, dirPart),
      hasWildcard: true,
    };
  }
  return {
    probePath: isAbsolute(raw) ? raw : resolve(baseCwd, raw),
    hasWildcard: false,
  };
}

function isExistingDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // @ignore-catch — 探测失败按"不存在"处理（fail-closed：不把真失败洗白）
    return false;
  }
}

/**
 * 是否属于「`dir` 无匹配 / 空目录」这一**事实结果**（不是执行失败）。
 *
 * 判据见模块头注（exit=1 + 双空 + 末段 dir + `2>nul` + 无其它重定向 + 目标目录存在 + 无 `&&`）。
 */
export function isListingNoMatch(params: {
  command: string | undefined;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  cwd?: string;
}): boolean {
  if (params.exitCode !== 1) return false;
  if ((params.stdout ?? '').trim() || (params.stderr ?? '').trim())
    return false;
  const command = params.command ?? '';
  if (!command) return false;
  // 含 `&&` ⇒ 无法确定哪段失败（末段可能根本没跑）⇒ 不判无匹配，只给提示
  if (command.includes('&&')) return false;
  const segment = lastSegment(command);
  if (!STDERR_TO_NUL_RE.test(segment)) return false;
  // 去掉 `2>nul` 后仍有输出重定向 ⇒ 有写盘意图，不能当"无匹配"
  if (OUTPUT_REDIRECT_RE.test(segment.replace(STDERR_TO_NUL_RE, ''))) {
    return false;
  }
  const cd = lastCdTarget(command);
  const base = cd
    ? resolve(params.cwd ?? process.cwd(), cd)
    : (params.cwd ?? process.cwd());
  const target = parseDirTarget(segment, base);
  return !!target && isExistingDir(target.probePath);
}

/**
 * 「stderr 被 `2>nul` 吞掉」提示：非 0 退出 + stderr 空 + 命令确含 `2>nul`。
 *
 * 只补**事实与出路**，不改判定（真失败照样是失败）。
 */
export function buildStderrSuppressedHint(params: {
  command: string | undefined;
  exitCode?: number;
  stderr?: string;
}): string {
  if (params.exitCode === undefined || params.exitCode === 0) return '';
  if ((params.stderr ?? '').trim()) return '';
  if (!STDERR_TO_NUL_RE.test(params.command ?? '')) return '';
  return (
    '\n提示: 命令里的 `2>nul` 丢弃了错误输出 —— 退出码非 0 时无法区分「无匹配」与「路径/权限错误」。' +
    '请去掉 `2>nul` 重试；若只是想按名字找文件，用 glob 工具更快。'
  );
}

/**
 * 「`&&` 串联短路」提示：命令含 `&&` 且非 0 退出。
 *
 * 只陈述 cmd 语义（前段失败 ⇒ 后续段不执行），不猜测具体哪段失败（CS06）。
 */
export function buildAndChainHint(params: {
  command: string | undefined;
  exitCode?: number;
}): string {
  if (params.exitCode === undefined || params.exitCode === 0) return '';
  if (!(params.command ?? '').includes('&&')) return '';
  return (
    '\n提示: 命令含 `&&` 串联 —— 任一段非 0 退出都会**跳过其后所有段**' +
    '（例如 `dir` 无匹配即退出码 1）。若后续段本应执行，请分开调用，或改用 `&`（无条件串联）。'
  );
}
