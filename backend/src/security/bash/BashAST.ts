/**
 * Bash AST 安全分析（基于CC源码 utils/bash/ast.ts FAIL-CLOSED模式）
 * 白名单节点类型策略：未知结构 -> 询问用户
 */

export type SimpleCommand = {
  argv: string[];
  envVars: { name: string; value: string }[];
  redirects: Redirect[];
  text: string;
};

export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<' | '|';
  target: string;
  fd?: number;
};

export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' };

const STRUCTURAL_TYPES = new Set(['program', 'list', 'pipeline', 'redirected_statement']);
const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&']);

import { hasHeredoc, stripHeredocs } from './HeredocHandler';

export function parseForSecurity(command: string): ParseForSecurityResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { kind: 'too-complex', reason: 'empty command' };
  }

  // Heredoc预处理：去除heredoc内容后分析
  const cleanedCommand = hasHeredoc(trimmed) ? stripHeredocs(trimmed) : trimmed;

  try {
    const commands = splitCommands(cleanedCommand);
    if (commands.length === 0) {
      return { kind: 'parse-unavailable' };
    }

    const simpleCommands = commands.map(parseSimpleCommand);
    const anyComplex = simpleCommands.some(c => c.argv.length === 0);

    if (anyComplex) {
      return { kind: 'parse-unavailable' };
    }

    return { kind: 'simple', commands: simpleCommands };
  } catch (e: any) {
    return { kind: 'too-complex', reason: e.message || 'parse error' };
  }
}

function splitCommands(input: string): string[] {
  const commands: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuote) {
      current += ch;
      if (ch === inQuote && input[i - 1] !== '\\') {
        inQuote = null;
      }
    } else if (ch === '"' || ch === "'") {
      current += ch;
      inQuote = ch;
    } else if ((ch === '|' && input[i + 1] !== '|') || ch === ';' || ch === '&') {
      if (current.trim()) commands.push(current.trim());
      current = '';
    } else {
      current += ch;
    }

    i++;
  }

  if (current.trim()) commands.push(current.trim());
  return commands;
}

function parseSimpleCommand(cmd: string): SimpleCommand {
  const envVars: { name: string; value: string }[] = [];
  const redirects: Redirect[] = [];
  const argv: string[] = [];
  let remaining = cmd.trim();
  let text = remaining;

  const redirectRegex = /(\d?)(>>|>&|&>>|&>|>|\|<|<|<<<|<<)\s*(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = redirectRegex.exec(remaining)) !== null) {
    redirects.push({
      fd: match[1] ? parseInt(match[1]) : undefined,
      op: match[2] as Redirect['op'],
      target: match[3],
    });
  }

  remaining = remaining.replace(redirectRegex, '').trim();

  const assignmentRegex = /^(\w+)=(\S+)/;
  while ((match = assignmentRegex.exec(remaining)) !== null) {
    envVars.push({ name: match[1], value: match[2] });
    remaining = remaining.replace(assignmentRegex, '').trim();
  }

  argv.push(...tokenizeArgs(remaining));

  return { argv, envVars, redirects, text };
}

function tokenizeArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === inQuote && input[i - 1] !== '\\') {
        inQuote = null;
        if (current) args.push(current);
        current = '';
      } else if (ch !== '\\' || (ch === '\\' && input[i + 1] === inQuote)) {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      if (current.trim()) args.push(current.trim());
      current = '';
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current.trim()) args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

export function extractCommandName(argv: string[]): string {
  return argv[0] || '';
}

export function isDangerousCommand(argv: string[]): boolean {
  const name = extractCommandName(argv).toLowerCase();
  const dangerous = new Set([
    'rm', 'mkfs', 'dd', 'shutdown', 'reboot', 'halt',
    'chmod', 'chown', 'fdisk', 'parted', ':(){ :|:& };:',
  ]);
  return dangerous.has(name);
}

export function hasRedirects(commands: SimpleCommand[]): boolean {
  return commands.some(c => c.redirects.length > 0);
}

// ============ 向后兼容导出 (原 BashAST.ts 接口) ============

import type { IParsedCommand } from './ParsedCommand';
export type CommandArg = string;
export type RedirectInfo = Redirect;
export type EnvAssignment = { name: string; value: string };
export type BashASTNode = { type: string; text: string; children?: BashASTNode[] };
export type BashToken = { type: string; value: string };
export type BashAnalysisResult = {
  command: string;
  name: string;
  args: string[];
  isSimple: boolean;
  isDangerous: boolean;
  redirects: RedirectInfo[];
};
export { type IParsedCommand as BashParsedCommand } from './ParsedCommand';

export function analyzeBashCommand(command: string): BashAnalysisResult {
  const result = parseForSecurity(command);
  if (result.kind !== 'simple' || result.commands.length === 0) {
    return { command, name: '', args: [], isSimple: false, isDangerous: false, redirects: [] };
  }
  const cmd = result.commands[0];
  return {
    command,
    name: extractCommandName(cmd.argv),
    args: cmd.argv.slice(1),
    isSimple: true,
    isDangerous: isDangerousCommand(cmd.argv),
    redirects: cmd.redirects,
  };
}

export function getCommandText(result: BashAnalysisResult): string {
  return result.command;
}

export function getCommandName(result: BashAnalysisResult): string {
  return result.name;
}

export function isSimpleCommand(result: BashAnalysisResult): boolean {
  return result.isSimple;
}
