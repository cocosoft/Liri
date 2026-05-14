/**
 * Sed Edit Parser
 * 对标CC源码 utils/bash/sedEditParser.ts
 * 解析sed编辑命令为结构化数据，用于安全验证
 */

export interface SedAddress {
  type: 'number' | 'regex' | 'last' | 'step' | 'none';
  value?: string | number;
}

export interface SedSubstituteCommand {
  type: 'substitute';
  pattern: string;
  replacement: string;
  flags: string[];
  address: SedAddress;
  endAddress?: SedAddress;
}

export interface SedDeleteCommand {
  type: 'delete';
  address: SedAddress;
  endAddress?: SedAddress;
}

export interface SedPrintCommand {
  type: 'print';
  address: SedAddress;
  endAddress?: SedAddress;
}

export interface SedWriteCommand {
  type: 'write';
  filename: string;
  address: SedAddress;
  endAddress?: SedAddress;
}

export interface SedInsertCommand {
  type: 'insert' | 'append' | 'change';
  text: string;
  address: SedAddress;
}

export interface SedTransformCommand {
  type: 'transform';
  from: string;
  to: string;
  address: SedAddress;
}

export interface SedReadCommand {
  type: 'read';
  filename: string;
  address: SedAddress;
}

export interface SedBranchCommand {
  type: 'branch' | 'test' | 'substituteBranch';
  label?: string;
  address: SedAddress;
}

export interface SedLabelCommand {
  type: 'label';
  name: string;
}

export interface SedQuitCommand {
  type: 'quit' | 'immediateQuit';
  address: SedAddress;
}

export interface SedNextCommand {
  type: 'next' | 'immediateNext';
  address: SedAddress;
}

export interface SedHoldCommand {
  type: 'hold' | 'get' | 'exchange' | 'holdGet' | 'getHold' | 'exchangeHold';
  address: SedAddress;
}

export interface SedUnknownCommand {
  type: 'unknown';
  raw: string;
  address: SedAddress;
}

export type SedEditCommand =
  | SedSubstituteCommand
  | SedDeleteCommand
  | SedPrintCommand
  | SedWriteCommand
  | SedInsertCommand
  | SedTransformCommand
  | SedReadCommand
  | SedBranchCommand
  | SedLabelCommand
  | SedQuitCommand
  | SedNextCommand
  | SedHoldCommand
  | SedUnknownCommand;

export interface SedScript {
  commands: SedEditCommand[];
  rawScript: string;
  hasInPlaceFlag: boolean;
  backupExtension?: string;
}

const SED_COMMAND_LETTERS = new Set([
  's', 'd', 'p', 'w', 'i', 'a', 'c', 'y', 'r', 'b', 't', ':', 'q', 'Q',
  'n', 'N', 'h', 'H', 'g', 'G', 'x', 'l', '=', 'F', 'v', 'z', 'D', 'P',
  'e', 'T',
]);

function parseAddress(expression: string, startIdx: number): { address: SedAddress; nextIdx: number } {
  let idx = startIdx;
  while (idx < expression.length && expression[idx] === ' ') {
    idx++;
  }
  if (idx >= expression.length) {
    return { address: { type: 'none' }, nextIdx: idx };
  }
  if (expression[idx] === '$') {
    return { address: { type: 'last' }, nextIdx: idx + 1 };
  }
  if (expression[idx] === '/' || expression[idx] === '\\') {
    const delimiter = expression[idx] === '\\' ? '/' : expression[idx];
    const startDelim = expression[idx];
    idx++;
    let escaped = false;
    const patternChars: string[] = [];
    while (idx < expression.length) {
      const ch = expression[idx];
      if (escaped) {
        patternChars.push(ch);
        escaped = false;
        idx++;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        idx++;
        continue;
      }
      if (ch === startDelim) {
        idx++;
        break;
      }
      patternChars.push(ch);
      idx++;
    }
    return { address: { type: 'regex', value: patternChars.join('') }, nextIdx: idx };
  }
  if (/\d/.test(expression[idx])) {
    const numChars: string[] = [];
    while (idx < expression.length && /\d/.test(expression[idx])) {
      numChars.push(expression[idx]);
      idx++;
    }
    if (idx < expression.length && expression[idx] === '~') {
      idx++;
      const stepChars: string[] = [];
      while (idx < expression.length && /\d/.test(expression[idx])) {
        stepChars.push(expression[idx]);
        idx++;
      }
      return {
        address: { type: 'step', value: parseInt(numChars.join(''), 10) },
        nextIdx: idx,
      };
    }
    return {
      address: { type: 'number', value: parseInt(numChars.join(''), 10) },
      nextIdx: idx,
    };
  }
  return { address: { type: 'none' }, nextIdx: idx };
}

function extractDelimitedPattern(expression: string, startIdx: number, delimiter: string): { result: string; nextIdx: number } {
  let idx = startIdx;
  const chars: string[] = [];
  let escaped = false;
  while (idx < expression.length) {
    const ch = expression[idx];
    if (escaped) {
      chars.push(ch);
      escaped = false;
      idx++;
      continue;
    }
    if (ch === '\\') {
      chars.push(ch);
      escaped = true;
      idx++;
      continue;
    }
    if (ch === delimiter) {
      idx++;
      break;
    }
    chars.push(ch);
    idx++;
  }
  return { result: chars.join(''), nextIdx: idx };
}

function parseSubstitute(expression: string, startIdx: number): { command: SedSubstituteCommand; nextIdx: number } | null {
  let idx = startIdx;
  const delimiter = expression[idx];
  if (!delimiter || delimiter === ' ' || SED_COMMAND_LETTERS.has(delimiter)) {
    return null;
  }
  idx++;
  const patternResult = extractDelimitedPattern(expression, idx, delimiter);
  idx = patternResult.nextIdx;
  if (idx > expression.length) {
    return null;
  }
  const replResult = extractDelimitedPattern(expression, idx, delimiter);
  idx = replResult.nextIdx;
  const flags: string[] = [];
  while (idx < expression.length && /[gipnoswlme0-9]/.test(expression[idx])) {
    if (/\d/.test(expression[idx])) {
      let numStr = '';
      while (idx < expression.length && /\d/.test(expression[idx])) {
        numStr += expression[idx];
        idx++;
      }
      flags.push(numStr);
    } else {
      flags.push(expression[idx]);
      idx++;
    }
  }
  const address: SedAddress = { type: 'none' };
  return {
    command: {
      type: 'substitute',
      pattern: patternResult.result,
      replacement: replResult.result,
      flags,
      address,
    },
    nextIdx: idx,
  };
}

export function parseSedExpression(expression: string): SedEditCommand | null {
  const trimmed = expression.trim();
  if (!trimmed) {
    return null;
  }
  let idx = 0;
  let address: SedAddress = { type: 'none' };
  let endAddress: SedAddress | undefined;
  const addrResult = parseAddress(trimmed, idx);
  address = addrResult.address;
  idx = addrResult.nextIdx;
  if (idx < trimmed.length && trimmed[idx] === ',') {
    idx++;
    const endResult = parseAddress(trimmed, idx);
    endAddress = endResult.address;
    idx = endResult.nextIdx;
  }
  while (idx < trimmed.length && trimmed[idx] === ' ') {
    idx++;
  }
  if (idx >= trimmed.length) {
    return {
      type: 'unknown',
      raw: trimmed,
      address,
    };
  }
  const cmdChar = trimmed[idx];
  idx++;
  switch (cmdChar) {
    case 's': {
      const subResult = parseSubstitute(trimmed, idx);
      if (!subResult) {
        return {
          type: 'unknown',
          raw: trimmed,
          address,
        };
      }
      subResult.command.address = address;
      subResult.command.endAddress = endAddress;
      return subResult.command;
    }
    case 'd':
      return { type: 'delete', address, endAddress };
    case 'p':
      return { type: 'print', address, endAddress };
    case 'w': {
      const filename = trimmed.slice(idx).trim();
      return { type: 'write', filename, address, endAddress };
    }
    case 'i':
      return { type: 'insert', text: trimmed.slice(idx).trim(), address };
    case 'a':
      return { type: 'append', text: trimmed.slice(idx).trim(), address };
    case 'c':
      return { type: 'change', text: trimmed.slice(idx).trim(), address };
    case 'y': {
      const delim = trimmed[idx];
      if (!delim) {
        return { type: 'unknown', raw: trimmed, address };
      }
      idx++;
      const fromResult = extractDelimitedPattern(trimmed, idx, delim);
      idx = fromResult.nextIdx;
      const toResult = extractDelimitedPattern(trimmed, idx, delim);
      return {
        type: 'transform',
        from: fromResult.result,
        to: toResult.result,
        address,
      };
    }
    case 'r': {
      const readFile = trimmed.slice(idx).trim();
      return { type: 'read', filename: readFile, address };
    }
    case 'b':
      return { type: 'branch', label: trimmed.slice(idx).trim() || undefined, address };
    case 't':
      return { type: 'test', label: trimmed.slice(idx).trim() || undefined, address };
    case 'T':
      return { type: 'substituteBranch', label: trimmed.slice(idx).trim() || undefined, address };
    case ':': {
      const label = trimmed.slice(idx).trim();
      return label ? { type: 'label', name: label } : { type: 'unknown', raw: trimmed, address };
    }
    case 'q':
      return { type: 'quit', address };
    case 'Q':
      return { type: 'immediateQuit', address };
    case 'n':
      return { type: 'next', address };
    case 'N':
      return { type: 'immediateNext', address };
    case 'h':
      return { type: 'hold', address };
    case 'H':
      return { type: 'holdGet', address };
    case 'g':
      return { type: 'get', address };
    case 'G':
      return { type: 'getHold', address };
    case 'x':
      return { type: 'exchange', address };
    default: {
      const rest = trimmed.slice(idx).trim();
      return {
        type: 'unknown',
        raw: cmdChar + rest,
        address,
      };
    }
  }
}

export function parseSedCommand(commandLine: string): SedScript {
  const trimmed = commandLine.trim();
  const inPlaceMatch = trimmed.match(/^sed\s+(-i(\.[^\s]+)?)/);
  const hasInPlaceFlag = !!inPlaceMatch;
  const backupExtension = inPlaceMatch?.[2] || undefined;
  let scriptPart = trimmed;
  const eMatch = trimmed.match(/(-e\s+|--expression=)['"]?(.[^'"\s]+)['"]?/);
  if (eMatch) {
    scriptPart = eMatch[2];
  } else if (hasInPlaceFlag) {
    scriptPart = trimmed.replace(/^sed\s+-i(\.[^\s]+)?\s*/g, '');
  } else {
    scriptPart = trimmed.replace(/^sed\s+/g, '');
  }
  const commands: SedEditCommand[] = [];
  if (scriptPart.includes('-e') || scriptPart.includes('--expression')) {
    const exprRegex = /(-e\s+|--expression=)['"]?([^'"\s]+)['"]?/g;
    let match: RegExpExecArray | null;
    while ((match = exprRegex.exec(scriptPart)) !== null) {
      const parsed = parseSedExpression(match[2]);
      if (parsed) {
        commands.push(parsed);
      }
    }
  } else {
    const lines = scriptPart.split(';');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        const parsed = parseSedExpression(trimmedLine);
        if (parsed) {
          commands.push(parsed);
        }
      }
    }
  }
  return {
    commands,
    rawScript: trimmed,
    hasInPlaceFlag,
    backupExtension,
  };
}

export function isSedCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return /^sed\s/.test(trimmed);
}

export function extractSedFileTargets(script: SedScript): string[] {
  const targets: string[] = [];
  for (const cmd of script.commands) {
    if (cmd.type === 'write' && cmd.filename) {
      targets.push(cmd.filename);
    }
    if (cmd.type === 'read' && cmd.filename) {
      targets.push(cmd.filename);
    }
  }
  return targets;
}

export function containsDangerousSedPattern(script: SedScript): { dangerous: boolean; reason?: string } {
  for (const cmd of script.commands) {
    if (cmd.type === 'substitute') {
      if (cmd.replacement.includes('/e') || cmd.flags.includes('e')) {
        return { dangerous: true, reason: 'e flag allows command execution in substitution' };
      }
      if (cmd.replacement.includes('\\`') || cmd.replacement.includes('\\"')) {
        return { dangerous: true, reason: 'Backtick or double-quote in replacement may allow injection' };
      }
    }
    if (cmd.type === 'write' && cmd.filename) {
      const dangerousPaths = ['/etc/', '/dev/', '/proc/', '/sys/'];
      for (const dp of dangerousPaths) {
        if (cmd.filename.includes(dp)) {
          return { dangerous: true, reason: `Write target '${cmd.filename}' is a system path` };
        }
      }
    }
    if (cmd.type === 'read') {
      if (cmd.filename === '/dev/stdin' || cmd.filename === '/dev/tcp' || cmd.filename?.startsWith('/dev/')) {
        return { dangerous: true, reason: `Read from '${cmd.filename}' may be unsafe` };
      }
    }
  }
  return { dangerous: false };
}
