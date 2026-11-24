/**
 * cmd 内置命令 → 等价命令提示（P2-2，2026-11-04）
 *
 * 背景（《运行态问题排查与修复方案》P2-2）：Windows 上模型常用 `dir /b …` 一类 **cmd 内置命令**，
 * 而 bash 工具在非 cmd shell 下没有这些内建 ⇒ 命令直接不存在。
 *
 * **只在"命令未找到"证据成立时才提示**（exit 127 / `not found` / `不是内部或外部命令` /
 * `not recognized`）——实测里 `dir /b` 也有 exit 1（路径不存在）的形态，那种情况加
 * "这是 cmd 内置命令"会误导模型，故本模块对 exit 1 不产出任何提示。
 *
 * 纯函数、无 I/O；平台可通过参数注入，便于跨平台单测。
 */

/** 常见 cmd 内置命令 → 建议（bash / PowerShell / 专用工具） */
const CMD_BUILTIN_EQUIVALENTS: Readonly<Record<string, string>> = {
  dir: 'ls（bash）/ Get-ChildItem（PowerShell）/ glob 工具（按模式列文件）',
  type: 'cat（bash）/ Get-Content（PowerShell）/ read 工具',
  copy: 'cp（bash）/ Copy-Item（PowerShell）',
  move: 'mv（bash）/ Move-Item（PowerShell）',
  ren: 'mv（bash）/ Rename-Item（PowerShell）',
  del: 'rm（bash）/ Remove-Item（PowerShell）',
  erase: 'rm（bash）/ Remove-Item（PowerShell）',
  md: 'mkdir -p（bash）/ New-Item -ItemType Directory（PowerShell）',
  rd: 'rm -r（bash）/ Remove-Item -Recurse（PowerShell）',
  cls: 'clear（bash）/ Clear-Host（PowerShell）',
  where: 'which / command -v（bash）/ Get-Command（PowerShell）',
  findstr: 'grep（bash）/ Select-String（PowerShell）/ grep 工具',
};

/** 取命令的第一个 token（去引号；空命令 ⇒ ''） */
function firstToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const match = /^["']?([\w.-]+)/.exec(trimmed);
  return match ? match[1].toLowerCase() : '';
}

/**
 * 是否已有"**命令未找到**"的证据（exit 127 或各 shell 的既定文案）。
 *
 * 独立成函数的原因：提示的**误报边界**全在这里 —— 必须有"命令未找到"的硬证据，
 * 而不能把 `dir /b` 的 exit 1（路径不存在）当同一类失败（见模块头注）。
 */
export function isCommandNotFoundError(
  exitCode: number | undefined,
  rawMsg: string
): boolean {
  if (exitCode === 127) return true;
  return /command not found|not recognized|不是内部或外部命令|无法将.*识别为/i.test(
    rawMsg
  );
}

/**
 * 构造提示文本；不适用 ⇒ **空字符串**（调用方据此不追加）。
 *
 * @param command                 原始命令（`undefined` ⇒ 无提示：命令尚未解析出来）
 * @param options.platform        当前平台（默认 `process.platform`）
 * @param options.commandNotFound 是否已有"命令未找到"证据（由调用方按退出码/错误文案判定）
 */
export function buildCmdBuiltinHint(
  command: string | undefined,
  options: { platform?: NodeJS.Platform; commandNotFound: boolean }
): string {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32' || !options.commandNotFound) return '';
  const token = firstToken(command ?? '');
  const equivalent = CMD_BUILTIN_EQUIVALENTS[token];
  if (!equivalent) return '';
  return (
    `\n提示: 「${token}」是 Windows cmd 内置命令，当前 shell 下不存在。` +
    `等价写法: ${equivalent}。` +
    '若只需判断路径是否存在/列目录，优先用 glob / list 工具（不必为此调用终端）。'
  );
}

// ─── 反方向：POSIX 命令用在 Windows cmd 上（2026-11-24，会话 session_mwurduuh1b0b38db30） ───

/**
 * POSIX 常用命令 → cmd 等价写法。
 *
 * 背景：真机会话里模型在 Windows 上写了 `pwd`（seq=180）与 `… | head -3`（seq=143），
 * 报 `'pwd' is not recognized as an internal or external command` / `'head' is not recognized…`，
 * 两条都白跑一轮。既有 `cmdBuiltinHint` 只覆盖**反方向**（bash 里写 cmd 内置命令），
 * 且只认 `dir` 等 cmd 名字 ⇒ 这类失败没有任何出路信息。
 */
const POSIX_ON_CMD_EQUIVALENTS: Readonly<Record<string, string>> = {
  pwd: 'cd（不带参数即显示当前目录）',
  ls: 'dir',
  cat: 'type',
  head: 'powershell -Command "Get-Content <file> -TotalCount <n>"',
  tail: 'powershell -Command "Get-Content <file> -Tail <n>"',
  grep: 'findstr（或直接用 grep 工具）',
  which: 'where',
  rm: 'del（删目录用 rmdir /s /q）',
  cp: 'copy',
  mv: 'move',
  mkdir: 'mkdir（cmd 会自动逐级创建）',
  clear: 'cls',
  env: 'set',
  ps: 'tasklist',
  kill: 'taskkill /PID <pid>',
};

/**
 * cmd.exe 专属的"命令未找到"文案。
 *
 * ⚠️ 刻意**不**复用 `isCommandNotFoundError`：它也匹配 POSIX shell 的 `command not found`
 * —— 那种场景给 cmd 等价写法是错的方向（模型在 bash 里）。这里只认 cmd 的两句原文。
 */
const CMD_SHELL_NOT_FOUND_RE =
  /not recognized as an internal or external command|不是内部或外部命令/i;

/**
 * 取"真正没找到"的那个词：从 cmd 报错原文里取（`'head' is not recognized …`），
 * 取不到再回落命令首 token。
 *
 * 为什么不能只看首 token：真机形态是 `cd X && … | head -3` —— 失败的是**管道末段**的
 * `head`，首 token 是 `cd`，只按首 token 查表会漏掉提示。
 *
 * 为什么不用"消息里第一个引号词"：命令本身可能带引号路径（`cd /d "E:\…"`），
 * 会先命中路径片段。这里只认**紧邻"未找到"文案**的那个词。
 */
const CMD_OFFENDING_EN =
  /['"`“‘]([A-Za-z][\w.-]*)['"`”’]\s+is not recognized as an internal or external command/i;
const CMD_OFFENDING_ZH = /['"`“‘]([A-Za-z][\w.-]*)['"`”’]\s*不是内部或外部命令/;

function offendingToken(command: string | undefined, message: string): string {
  const m = CMD_OFFENDING_EN.exec(message) ?? CMD_OFFENDING_ZH.exec(message);
  if (m) return m[1].toLowerCase();
  return firstToken(command ?? '');
}

/**
 * 构造「POSIX 命令写在 cmd 上」的提示；不适用 ⇒ 空字符串。
 *
 * @param command 原始命令（报错原文取不到 token 时的回落来源）
 * @param options.platform 当前平台（默认 `process.platform`）
 * @param options.message 命令失败原文（必须含 **cmd 专属**"未找到"文案才提示）
 */
export function buildPosixOnCmdHint(
  command: string | undefined,
  options: { platform?: NodeJS.Platform; message: string }
): string {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return '';
  if (!CMD_SHELL_NOT_FOUND_RE.test(options.message)) return '';
  const token = offendingToken(command, options.message);
  const equivalent = POSIX_ON_CMD_EQUIVALENTS[token];
  if (!equivalent) return '';
  return (
    `\n提示: 当前 shell 是 Windows cmd.exe，没有「${token}」。等价写法: ${equivalent}。` +
    '需要 POSIX 语法时可用 `powershell -Command "…"`；按名字找文件优先用 glob 工具。'
  );
}
