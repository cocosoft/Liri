/**
 * B1（2026-11-18）：把「单读类动词 + 单路径」的 shell 调用**直接回纠正提示**，
 * 而不是弹审批卡。
 *
 * 背景（`dev_docs/20261117/工具审批治理-实施方案.md` §5-B1）：真机会话 320 次调用中
 * bash 231 次（72%），19 张审批卡里 14 张来自「用 shell 读文件」；提示层已收紧（读 → `file_read`、
 * 找 → `glob`、搜 → `grep`），但**仍会弹卡**。本模块提供**纯函数**判定：命中时由权限层直接
 * 返回可操作的纠正提示（不执行命令、不建审批卡）。
 *
 * 受理范围（用户 2026-11-18 裁定，**刻意保守**）：
 * - 仅 `default`（ask）档生效（auto / demand 已有只读短路；plan 是"每步确认"，不纠正）；
 * - 仅**严格最小集**动词：读 `cat` / `type` / `Get-Content`、搜 `grep` / `findstr` /
 *   `Select-String`、列目录 `ls` / `dir` / `find` / `Get-ChildItem`；
 * - 必须是**单一简单命令**：无管道 / 重定向 / 分隔 / 命令替换 / 变量 / 通配符 / 引号 / 参数前缀；
 * - **仅工作区内路径**（工作区外保持弹卡：`file_read` 在那里同样需要工作区授权，纠正会变成死路）。
 * - （2026-11-18 增补）允许**恰好一条** `powershell [-NoProfile] -Command "内层单条命令"` 包裹：
 *   Windows 上这是模型最自然的读文件写法；解包后内层仍按上述最小集判定。
 *   `Get-Content` 额外允许只读参数 `-Raw` / `-TotalCount` / `-First` / `-Tail` / `-Encoding`（带值），
 *   其他任何参数前缀一律不纠正。
 *
 * 不做的事：不判定危险的 shell 形态（交给既有安全层）；`allowed:false` 一律表示"不适用本纠正"。
 */

import { isAbsolute, relative, resolve } from 'node:path';
import { configManager } from '@openliri/infra/config';

/** 灰度开关（默认关）：只认显式 `true`（拼写错误按关） */
export function isReadViaShellCorrectionEnabled(): boolean {
  return (
    configManager.env('PERMISSION_READ_VIA_SHELL_CORRECTION')?.trim().toLowerCase() ===
    'true'
  );
}

/** 纠正建议的目标工具（均已有等价专用工具） */
export type ReadViaShellTool = 'file_read' | 'grep' | 'glob';

/** 一条纠正建议 */
export interface ReadViaShellSuggestion {
  tool: ReadViaShellTool;
  /** 命中的动词（小写） */
  verb: string;
  /** 目标路径（已按 cwd 解析为绝对路径） */
  path: string;
  /** 搜索类动词的 pattern（其余为空） */
  pattern?: string;
  /** 直接回给模型的纠正提示（可操作） */
  message: string;
}

/** 不接受的 shell 组成 / 展开字符（出现即不纠正，继续走既有审批） */
const REJECT_CHARS = /[;&|<>`$(){}[\]*?~"'\n\r]/;

/**
 * PowerShell 包裹形态：`powershell [只读开关…] -Command "内层单条命令"`（或 `pwsh`）。
 *
 * 2026-11-18（真机 `session_mwkthat73b80a6724f`）：Windows 上模型最常用的只读写法就是这种包裹
 * —— 它带引号 ⇒ 被 `REJECT_CHARS` 一律拒绝，该会话 **3/3** 张"读文件"审批卡都不会被纠正。
 * 这里只解包**恰好一条**这种形态（尾部必须是一整对引号），内层再走同一套严格判定。
 *
 * **不削弱安全**：不执行命令、不绕过审批 —— 命中只是把"弹卡"换成"改用专用工具"的纠正提示；
 * 形态不明确（多段 / 拼接 / 变量）一律 `null`，交回既有审批链。
 */
const POWERSHELL_WRAPPER =
  /^(?:powershell|powershell\.exe|pwsh|pwsh\.exe)\s+(?:(?:-(?:noprofile|nologo|noninteractive))\s+)*-(?:command|c)\s+(.+)$/i;

/** `Get-Content` 允许的只读参数（0 ⇒ 无值；1 ⇒ 带一个值）。其余动词仍只接受**纯单参**。 */
const GET_CONTENT_FLAGS: Readonly<Record<string, 0 | 1>> = {
  '-raw': 0,
  '-totalcount': 1,
  '-first': 1,
  '-tail': 1,
  '-encoding': 1,
};

/** 解包 `powershell -Command "…"` ⇒ 内层命令；形态不唯一/带外层残留 ⇒ `null` */
function unwrapPowerShellWrapper(command: string): string | null {
  const matched = POWERSHELL_WRAPPER.exec(command);
  if (!matched) return null;
  const quoted = matched[1]!.trim();
  if (quoted.length < 3) return null;
  if (!quoted.startsWith('"') || !quoted.endsWith('"')) return null;
  // 只允许**一整对**引号：出现第二对 ⇒ 可能是拼接/多命令，交回审批
  if (quoted.indexOf('"', 1) !== quoted.length - 1) return null;
  const inner = quoted.slice(1, -1).trim();
  return inner.length > 0 ? inner : null;
}

/** 允许的动词（小写）→ 目标工具 */
const READ_VERBS: Record<string, ReadViaShellTool> = {
  cat: 'file_read',
  type: 'file_read',
  'get-content': 'file_read',
  grep: 'grep',
  findstr: 'grep',
  'select-string': 'grep',
  ls: 'glob',
  dir: 'glob',
  find: 'glob',
  'get-childitem': 'glob',
};

/** 需要「pattern + 路径」两个参数的动词 */
const SEARCH_VERBS = new Set(['grep', 'findstr', 'select-string']);

/** 工具名 → shell 方言（查表而非条件分支：避免触发 U-03 工具名分支棘轮） */
const SHELL_BY_TOOL: Readonly<Record<string, 'bash' | 'powershell'>> = {
  bash: 'bash',
  powershell: 'powershell',
  pwsh: 'powershell',
};

/** 工具名 → shell 方言（`undefined` ⇒ 非命令工具，不纠正） */
export function shellOfCommandTool(
  toolName: string
): 'bash' | 'powershell' | undefined {
  return SHELL_BY_TOOL[toolName];
}

/** 目标路径是否位于任一工作区根内（Windows 大小写不敏感） */
function isInsideRoots(
  target: string,
  roots: readonly string[]
): string | null {
  const caseInsensitive = process.platform === 'win32';
  const norm = (p: string) => (caseInsensitive ? p.toLowerCase() : p);
  for (const root of roots) {
    const rootResolved = resolve(root);
    const rel = relative(norm(rootResolved), norm(target));
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return rootResolved;
    }
  }
  return null;
}

/** 生成纠正提示（面向模型，点名目标工具与参数） */
function buildMessage(
  tool: ReadViaShellTool,
  verb: string,
  target: string,
  pattern?: string
): string {
  const hint =
    tool === 'file_read'
      ? `请改用 file_read（参数 path="${target}"）`
      : tool === 'grep'
        ? `请改用 grep（参数 pattern="${pattern ?? ''}"、path="${target}"）`
        : `请改用 glob（参数 pattern 如 "${target.replace(/\\/g, '/')}/**"）`;
  return (
    `检测到用 shell ${verb === 'grep' || verb === 'findstr' || verb === 'select-string' ? '检索' : '读取/列目录'}（${verb}）。` +
    `本命令未执行，也未弹出审批。${hint} 后重试。`
  );
}

/**
 * 判定一条 shell 命令是否应被纠正为专用工具调用（**纯函数**）。
 *
 * @returns 命中 ⇒ 纠正建议；`null` ⇒ 不适用（继续走既有审批链）
 */
export function suggestReadToolForShellCommand(params: {
  command: string;
  shell: 'bash' | 'powershell';
  /** 命令执行目录（缺省 ⇒ 取首个工作区根） */
  cwd?: string;
  /** 会话工作区根列表（缺省 ⇒ 不纠正：无法证明路径在界内） */
  workspaceRoots?: readonly string[];
}): ReadViaShellSuggestion | null {
  const raw = params.command.trim();
  if (!raw) return null;
  // 先解包 PowerShell 包裹（其引号本就属于"形态"而非"拼接"）；形态不明确 ⇒ 退回原文走审批
  const command = unwrapPowerShellWrapper(raw) ?? raw;
  if (REJECT_CHARS.test(command)) return null;

  const tokens = command.split(/\s+/);
  if (tokens.length < 2) return null;
  const verb = tokens[0]!.toLowerCase();
  const tool = READ_VERBS[verb];
  if (!tool) return null;

  const args = tokens.slice(1);
  // `Get-Content` 允许白名单内的只读参数；其余动词一律拒绝任何 `-` 前缀 token（口径不变）
  let positional: string[] = args;
  if (verb === 'get-content') {
    positional = [];
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i] ?? '';
      if (!token.startsWith('-')) {
        positional.push(token);
        continue;
      }
      const arity = GET_CONTENT_FLAGS[token.toLowerCase()];
      if (arity === undefined) return null;
      if (arity === 1) {
        i += 1;
        if (i >= args.length) return null;
      }
    }
  } else if (args.some((a) => a.startsWith('-'))) {
    return null;
  }
  const needArgs = SEARCH_VERBS.has(verb) ? 2 : 1;
  if (positional.length !== needArgs) return null;

  const roots = (params.workspaceRoots ?? []).filter(
    (r): r is string => typeof r === 'string' && r.trim() !== ''
  );
  if (roots.length === 0) return null;
  const cwd = params.cwd?.trim() || roots[0];

  const pattern = needArgs === 2 ? positional[0] : undefined;
  const rawPath = needArgs === 2 ? positional[1]! : positional[0]!;
  const target = resolve(cwd, rawPath);
  if (!isInsideRoots(target, roots)) return null;

  return {
    tool,
    verb,
    path: target,
    ...(pattern !== undefined ? { pattern } : {}),
    message: buildMessage(tool, verb, target, pattern),
  };
}

/** 权限层判定结果（含审计用 reasonCode） */
export interface ReadViaShellCorrection extends ReadViaShellSuggestion {
  reasonCode: 'read_via_shell_corrected';
}

/**
 * 权限层入口：把"开关 + 权限档 + 工具 + 入参 + 工作区"归一成一次判定。
 *
 * - `enabled` 由调用方从 `PERMISSION_READ_VIA_SHELL_CORRECTION` 读取（只认显式 `true`）；
 * - 仅 `default` 档生效（`undefined` 视为 default，与权限层缺省口径一致）；
 * - 非命令工具 / 无工作区 / 工作区外路径 ⇒ `null`。
 */
export function buildReadViaShellCorrection(params: {
  enabled: boolean;
  toolName: string;
  input: Record<string, unknown>;
  permissionMode?: string;
  workspacePath?: string;
  workspaceRoots?: readonly string[];
}): ReadViaShellCorrection | null {
  if (!params.enabled) return null;
  if ((params.permissionMode ?? 'default') !== 'default') return null;
  const shell = shellOfCommandTool(params.toolName);
  if (!shell) return null;
  const command = params.input['command'];
  if (typeof command !== 'string') return null;
  const cwdInput = params.input['cwd'];
  const roots =
    params.workspaceRoots && params.workspaceRoots.length > 0
      ? params.workspaceRoots
      : params.workspacePath
        ? [params.workspacePath]
        : [];
  const suggestion = suggestReadToolForShellCommand({
    command,
    shell,
    ...(typeof cwdInput === 'string' && cwdInput.trim() !== ''
      ? { cwd: cwdInput }
      : {}),
    workspaceRoots: roots,
  });
  return suggestion
    ? { ...suggestion, reasonCode: 'read_via_shell_corrected' }
    : null;
}
