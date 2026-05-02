/**
 * Bash 工具模块入口
 */
export {
  SHELL_KEYWORDS,
  SAFE_ENV_VARS,
  isNoOpText,
  extractEnvVars,
  extractRedirections,
  createSimpleCommand,
} from './ast'
export type { SimpleCommand, Redirect, ParseForSecurityResult } from './ast'

export { parseForSecurity, splitPipeChain, tokenize } from './parser'
export { extractHeredocs, restoreHeredocs } from './heredoc'
export type { HeredocInfo } from './heredoc'

export { createCommandPrefixExtractor, createSubcommandPrefixExtractor } from './commands'
export type { CommandPrefixResult } from './commands'

export {
  getCommandSpec,
  getAllCommandNames,
  isDangerousCommand,
  isWrapperCommand,
  isCommandArgument,
  findSubcommandSpec,
} from './registry'
export type { CommandSpec, Argument, Option } from './registry'

export { getCommandPrefixStatic } from './prefix'
