/**
 * 命令常量定义（来自CC源码）
 */

/**
 * 远程安全命令列表（可在远程模式下使用的命令）
 */
export const REMOTE_SAFE_COMMANDS = new Set<string>([
  'session', 'exit', 'clear', 'help', 'theme',
  'color', 'vim', 'cost', 'usage', 'copy',
  'btw', 'feedback', 'plan', 'keybindings',
]);

/**
 * Bridge安全命令列表（可在Bridge模式下使用的命令）
 */
export const BRIDGE_SAFE_COMMANDS = new Set<string>([
  'compact', 'clear', 'cost', 'summary',
  'releaseNotes', 'files',
]);

/**
 * 命令类型常量
 */
export const COMMAND_TYPES = {
  PROMPT: 'prompt' as const,
  ACTION: 'action' as const,
  TOOL: 'tool' as const,
  CHAT: 'chat' as const,
  LOCAL: 'local' as const,
  LOCAL_JSX: 'local-jsx' as const,
};

/**
 * 命令来源常量
 */
export const COMMAND_SOURCES = {
  BUILTIN: 'builtin',
  SKILL: 'skill',
  PLUGIN: 'plugin',
  MCP: 'mcp',
  WORKFLOW: 'workflow',
} as const;