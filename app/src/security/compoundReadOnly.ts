/**
 * 复合只读命令判定（P1-3，2026-10-27）
 *
 * 背景：`checkBashAllowlist` 对任何含 shell 操作符（`; & | > < 反引号 $`）的命令一律判不安全，
 * 分析器随之**硬 deny**。真机实测（会话 `session_mvoqs1ho875ea6b95e`）：`cd /d X && dir /b`、
 * `dir /s /b *.ts | find /c /v ""` 这类**纯只读串联**连审批机会都没有，长程任务因此反复空转。
 *
 * 口径（**仅放宽"多段只读"这一种形态**，其余一律维持原硬拒）：
 * - 允许的分隔符：`&&`、`||`、`|`、`;`；
 * - **每段**的首命令必须命中只读白名单（或版本查询 / git 只读子命令）；
 * - 出现以下任一即**拒绝**（fail-closed）：
 *   重定向 `<` `>`、后台 `&`、命令替换 `` ` `` / `$(`、变量展开 `$`、
 *   变量赋值（`VAR=…` 作为段首）、引号未闭合、空段、非常规命令名（含路径/通配）。
 *
 * 设计约束：本函数只回答"是否**全部**为只读串联"，**不**替代危险命令检测
 * （`checkBashDangerousCommand` / 路径检查仍在其之前执行）。
 */

/** 只读基命令（两平台常用者；不含任何可写/可执行/可交互命令） */
const READ_ONLY_BASES = new Set([
  'dir',
  'ls',
  'findstr',
  'type',
  'cat',
  'head',
  'tail',
  'more',
  'less',
  'grep',
  'rg',
  'where',
  'which',
  'find',
  'tree',
  'echo',
  'whoami',
  'hostname',
  'ver',
  'uname',
  'pwd',
  'cd',
  'chcp',
  'systeminfo',
  'tasklist',
  'ps',
  'df',
  'du',
  'wc',
  'sort',
  'uniq',
  'cut',
  'tr',
  'stat',
  'file',
  'md5sum',
  'sha256sum',
  'date',
]);

/** 解释器/构建器的只读版本查询（与 `BashAllowlistMatcher` 同口径） */
const VERSION_ONLY =
  /^(node|npm|npx|pnpm|yarn|bun|deno|python|python3|pip|pip3|go|cargo|rustc|java|mvn|gradle|dotnet|git|tsc)\s+(--version|-v|-V)$/i;

/** git 只读子命令（不含 `git diff --output` 之类写操作：重定向已被上层拒绝） */
const GIT_READ_ONLY =
  /^git\s+(status|log|diff|show|rev-parse|branch\s+--list|--version)(\s|$)/i;

export interface CompoundReadOnlyVerdict {
  allowed: boolean;
  /** 拒绝原因（`allowed=false` 时必填） */
  reason: string;
  /** 切分后的段（`allowed=true` 时至少 1 段） */
  segments: string[];
}

/**
 * 引号感知切段；同时拒绝重定向 / 命令替换 / 变量展开 / 后台执行。
 */
function splitSafely(command: string): {
  segments: string[];
  forbidden?: string;
} {
  const segments: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (inSingle) {
      if (ch === "'") inSingle = false;
      else buf += ch;
      continue;
    }

    if (inDouble) {
      if (
        ch === '\\' &&
        (next === '"' || next === '\\' || next === '$' || next === '`')
      ) {
        buf += next;
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        continue;
      }
      // 双引号内仍会展开 —— 一律拒绝
      if (ch === '`') return { segments, forbidden: '反引号命令替换' };
      if (ch === '$') return { segments, forbidden: '变量/命令替换（$）' };
      if (ch === '>' || ch === '<')
        return { segments, forbidden: `重定向（${ch}）` };
      if (ch === '&' || ch === '|' || ch === ';') {
        // 引号内的 `|`/`&`/`;` 是普通字符（如 findstr 模式），保留
        buf += ch;
        continue;
      }
      buf += ch;
      continue;
    }

    // 普通态
    if (ch === '\\') {
      if (next !== undefined) {
        buf += next;
        i++;
        continue;
      }
      return { segments, forbidden: '结尾反斜杠' };
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') return { segments, forbidden: '反引号命令替换' };
    if (ch === '$') return { segments, forbidden: '变量/命令替换（$）' };
    if (ch === '>' || ch === '<')
      return { segments, forbidden: `重定向（${ch}）` };

    if (ch === '&') {
      if (next === '&') {
        segments.push(buf);
        buf = '';
        i++;
        continue;
      }
      return { segments, forbidden: '后台执行（&）' };
    }
    if (ch === '|') {
      if (next === '|') {
        segments.push(buf);
        buf = '';
        i++;
        continue;
      }
      segments.push(buf);
      buf = '';
      continue;
    }
    if (ch === ';') {
      segments.push(buf);
      buf = '';
      continue;
    }

    buf += ch;
  }

  if (inSingle || inDouble) return { segments, forbidden: '引号未闭合' };
  segments.push(buf);
  return { segments };
}

/**
 * 判定一条命令是否为"全部段皆只读"的串联。
 *
 * @example
 * checkCompoundReadOnly('cd /d E:\\X && dir /b')        // allowed
 * checkCompoundReadOnly('dir /s /b *.ts | find /c /v ""') // allowed
 * checkCompoundReadOnly('dir > out.txt')                // 拒绝：重定向
 * checkCompoundReadOnly('cd X && node script.js')       // 拒绝：node 非只读
 */
export function checkCompoundReadOnly(
  command: string
): CompoundReadOnlyVerdict {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, reason: '空命令', segments: [] };

  const { segments, forbidden } = splitSafely(trimmed);
  if (forbidden) return { allowed: false, reason: forbidden, segments };

  const cleaned: string[] = [];
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) return { allowed: false, reason: '存在空段', segments };

    // 变量赋值（`VAR=1` 会改变后续段的环境）
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(seg)) {
      return { allowed: false, reason: '变量赋值', segments };
    }

    const first = seg.split(/\s+/)[0] ?? '';
    // 只认裸命令名：路径（`./x`、`C:\x`）与通配一律拒绝
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(first)) {
      return { allowed: false, reason: `非常规命令名（${first}）`, segments };
    }

    if (VERSION_ONLY.test(seg) || GIT_READ_ONLY.test(seg)) {
      cleaned.push(seg);
      continue;
    }

    if (!READ_ONLY_BASES.has(first.toLowerCase())) {
      return { allowed: false, reason: `非只读命令（${first}）`, segments };
    }
    cleaned.push(seg);
  }

  return { allowed: true, reason: '', segments: cleaned };
}
