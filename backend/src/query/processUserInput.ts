/**
 * 用户输入处理
 * 参考CC源码实现用户输入预处理功能
 */

export interface ProcessedInput {
  text: string;
  isCommand: boolean;
  commandName?: string;
  commandArgs?: string;
  isMeta: boolean;
  permissions?: string[];
}

const COMMAND_PREFIXES = ['/', '!'];

const META_COMMANDS = new Set([
  'clear', 'reset', 'help', 'exit', 'quit',
  'status', 'skills', 'tools', 'buddy',
]);

/**
 * 检查是否是指令
 * @param input 用户输入
 * @returns 是否是指令
 */
export function isCommand(input: string): boolean {
  return COMMAND_PREFIXES.some((prefix) => input.trim().startsWith(prefix));
}

/**
 * 提取指令信息
 * @param input 用户输入
 * @returns 指令名称和参数
 */
export function extractCommandInfo(input: string): {
  name: string;
  args: string;
} {
  const trimmed = input.trim();
  const prefix = COMMAND_PREFIXES.find((p) => trimmed.startsWith(p));
  if (!prefix) {
    return { name: '', args: trimmed };
  }
  const withoutPrefix = trimmed.slice(prefix.length).trim();
  const parts = withoutPrefix.split(/\s+/);
  const name = parts[0] || '';
  const args = parts.slice(1).join(' ');
  return { name, args };
}

/**
 * 检查是否是元指令
 * @param input 用户输入
 * @returns 是否是元指令
 */
export function isMetaCommand(input: string): boolean {
  const { name } = extractCommandInfo(input);
  return META_COMMANDS.has(name.toLowerCase());
}

/**
 * 处理用户输入
 * @param input 原始输入
 * @returns 处理后的输入
 */
export function processUserInput(input: string): ProcessedInput {
  const trimmed = input.trim();
  const cmd = isCommand(trimmed);
  const meta = isMetaCommand(trimmed);
  const { name, args } = extractCommandInfo(trimmed);

  return {
    text: trimmed,
    isCommand: cmd,
    commandName: name || undefined,
    commandArgs: args || undefined,
    isMeta: meta,
  };
}

/**
 * 清理用户输入
 * @param input 用户输入
 * @returns 清理后的输入
 */
export function sanitizeUserInput(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}