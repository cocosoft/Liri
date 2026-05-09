export type OutputRedirection = {
  target: string;
  operator: '>' | '>>';
};

export type EnvAssignment = {
  name: string;
  value: string;
};

export type RedirectInfo = {
  op: string;
  target: string;
  fd?: number;
};

export type CommandSegment = {
  command: string;
  argv: string[];
  redirections: OutputRedirection[];
  envVars?: EnvAssignment[];
};

/**
 * SimpleCommand — AST级命令行解析结果（与BashAST.ts对齐）
 * 基于CC源码 SimpleCommand 结构
 */
export type SimpleCommand = {
  argv: string[];
  envVars: EnvAssignment[];
  redirects: RedirectInfo[];
  text: string;
};

export interface IParsedCommand {
  readonly originalCommand: string;
  toString(): string;
  getPipeSegments(): string[];
  getSegments(): CommandSegment[];
  withoutOutputRedirections(): string;
  getOutputRedirections(): OutputRedirection[];
}

class ParsedCommandImpl implements IParsedCommand {
  readonly originalCommand: string;

  constructor(command: string) {
    this.originalCommand = command;
  }

  toString(): string {
    return this.originalCommand;
  }

  getPipeSegments(): string[] {
    return splitPipes(this.originalCommand);
  }

  getSegments(): CommandSegment[] {
    return this.getPipeSegments().map((segment) => {
      const { commandWithoutRedirections, redirections } =
        extractOutputRedirections(segment);
      return {
        command: commandWithoutRedirections,
        argv: commandWithoutRedirections.split(/\s+/).filter(Boolean),
        redirections,
      };
    });
  }

  withoutOutputRedirections(): string {
    if (!this.originalCommand.includes('>')) {
      return this.originalCommand;
    }
    const { commandWithoutRedirections, redirections } =
      extractOutputRedirections(this.originalCommand);
    return redirections.length > 0
      ? commandWithoutRedirections
      : this.originalCommand;
  }

  getOutputRedirections(): OutputRedirection[] {
    const { redirections } = extractOutputRedirections(this.originalCommand);
    return redirections;
  }
}

const QUOTE_STATES = {
  NONE: 0,
  SINGLE: 1,
  DOUBLE: 2,
} as const;

type QuoteState = (typeof QUOTE_STATES)[keyof typeof QUOTE_STATES];

function splitPipes(command: string): string[] {
  if (!command.includes('|')) {
    return [command];
  }

  const segments: string[] = [];
  let current = '';
  let state: QuoteState = QUOTE_STATES.NONE;
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (escapeNext) {
      current += c;
      escapeNext = false;
      continue;
    }

    if (c === '\\') {
      current += c;
      escapeNext = true;
      continue;
    }

    if (state === QUOTE_STATES.SINGLE) {
      current += c;
      if (c === "'") state = QUOTE_STATES.NONE;
      continue;
    }

    if (state === QUOTE_STATES.DOUBLE) {
      current += c;
      if (c === '"') state = QUOTE_STATES.NONE;
      continue;
    }

    if (c === "'") {
      current += c;
      state = QUOTE_STATES.SINGLE;
      continue;
    }

    if (c === '"') {
      current += c;
      state = QUOTE_STATES.DOUBLE;
      continue;
    }

    if (c === '|') {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = '';
      continue;
    }

    current += c;
  }

  const trimmed = current.trim();
  if (trimmed) segments.push(trimmed);

  return segments.length > 0 ? segments : [command];
}

const REDIRECT_OPERATORS = ['>>', '>'];

function extractOutputRedirections(command: string): {
  commandWithoutRedirections: string;
  redirections: OutputRedirection[];
} {
  const redirections: OutputRedirection[] = [];

  const parts = command.split(/\s+/);
  const keptParts: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    let matched = false;

    for (const op of REDIRECT_OPERATORS) {
      if (part === op) {
        if (i + 1 < parts.length) {
          redirections.push({
            target: parts[i + 1],
            operator: op as '>' | '>>',
          });
          i++;
          matched = true;
          break;
        }
      }

      if (part.startsWith(op) && part.length > op.length) {
        redirections.push({
          target: part.slice(op.length),
          operator: op as '>' | '>>',
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      keptParts.push(part);
    }
  }

  return {
    commandWithoutRedirections: keptParts.join(' '),
    redirections,
  };
}

export function parseCommand(command: string): IParsedCommand {
  return new ParsedCommandImpl(command);
}

export const ParsedCommand = {
  parse: (command: string): IParsedCommand => {
    return new ParsedCommandImpl(command);
  },
};
