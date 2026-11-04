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
