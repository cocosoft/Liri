// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
