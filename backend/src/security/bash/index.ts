//
export {
  parseCommand,
  type IParsedCommand,
  type CommandSegment,
  type OutputRedirection,
} from './ParsedCommand';

export {
  analyzeBashCommand,
  getCommandText,
  getCommandName,
  isSimpleCommand,
  type BashASTNode,
  type BashToken,
  type BashAnalysisResult,
  type BashParsedCommand,
  type CommandArg,
  type RedirectInfo,
  type EnvAssignment,
} from './BashAST';

export {
  extractHeredocs,
  restoreHeredocs,
  hasHeredoc,
  isHeredocSafe,
  type HeredocInfo,
  type HeredocExtractionResult,
} from './HeredocHandler';

export {
  classifyCommand,
  getCommandInfo,
  registerCommand,
  getAllCommands,
  getCommandsByCategory,
  type CommandCategory,
  type CommandEntry,
} from './CommandRegistry';

export {
  parseCompletionContext,
  matchVariables,
  matchCommands,
  generateShellCompletion,
  type CompletionType,
  type CompletionContext,
  type CompletionItem,
} from './ShellCompletion';

export {
  quoteArg,
  quoteArgs,
  tryQuoteArgs,
  unquoteArg,
  hasUnterminatedQuote,
  hasShellQuoteBug,
  escapeForShell,
  escapeForDoubleQuotes,
  type QuoteResult,
  type UnquoteResult,
} from './QuoteHandler';

// 新增：安全分析（基于CC源码 AST模式）
export {
  parseForSecurity,
  isDangerousCommand,
  hasRedirects,
  extractCommandName,
  type SimpleCommand,
  type Redirect,
  type ParseForSecurityResult,
} from './BashAST';
