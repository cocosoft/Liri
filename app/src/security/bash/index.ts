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

export {
  parseForSecurity,
  isDangerousCommand,
  hasRedirects,
  extractCommandName,
  type SimpleCommand,
  type Redirect,
  type ParseForSecurityResult,
} from './BashAST';

// Sed编辑命令解析与安全验证（对标CC源码 utils/bash/sedEditParser.ts + sedValidation.ts）
export {
  parseSedCommand,
  parseSedExpression,
  isSedCommand,
  containsDangerousSedPattern,
  extractSedFileTargets,
  type SedScript,
  type SedEditCommand,
  type SedAddress,
  type SedSubstituteCommand,
  type SedDeleteCommand,
  type SedPrintCommand,
  type SedWriteCommand,
  type SedInsertCommand,
  type SedTransformCommand,
  type SedReadCommand,
  type SedBranchCommand,
  type SedLabelCommand,
  type SedQuitCommand,
  type SedNextCommand,
  type SedHoldCommand,
} from './sedEditParser';

export {
  validateSedCommand,
  validateSedExpression,
  makeSedValidationResult,
  isSedInPlaceEdit,
  getSedTargetFiles,
  type SedValidationOptions,
  type SedValidationResult,
  type SedIssue,
  type SedIssueType,
  DEFAULT_SED_OPTIONS,
} from './sedValidation';

// 命令执行模式验证（对标CC源码 utils/bash/modeValidation.ts）
export {
  ModeValidator,
  getModeConfig,
  getAllModes,
  getModeLevel,
  type ExecutionMode,
  type ModeValidationOptions,
  type ModeValidationResult,
  EXECUTION_MODES,
} from './modeValidation';

// 注释标签解析（对标CC源码 utils/bash/commentLabel.ts）
export {
  extractCommentLabels,
  hasCommentLabel,
  getLabelValue,
  stripCommentLabels,
  classifyCommandByLabels,
  addCommentLabel,
  getLabelPriority,
  isHighConfidenceLabel,
  type CommentLabel,
  type CommentLabelType,
  type CommentLabelPattern,
} from './commentLabel';
