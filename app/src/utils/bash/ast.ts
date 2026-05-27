/**
 * Bash 命令 AST 分析
 *
 * 使用正则和字符串解析方式分析 Bash 命令结构。
 * 参考 CC源码 cc_code/backend/utils/bash/ast.ts
 * 不使用 tree-sitter（第三方原生模块），改用轻量级实现。
 */

export const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'case',
  'esac',
  'for',
  'while',
  'until',
  'do',
  'done',
  'in',
  'function',
  'select',
  'time',
  'coproc',
]);

export const SAFE_ENV_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'PWD',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'EDITOR',
]);

export interface SimpleCommand {
  argv: string[];
  envVars: Map<string, string>;
  redirects: Redirect[];
  text: string;
}

export interface Redirect {
  operator: string;
  target: string;
  fd: string | null;
}

export function createSimpleCommand(text: string): SimpleCommand {
  return {
    argv: [],
    envVars: new Map(),
    redirects: [],
    text,
  };
}

export type ParseForSecurityResult =
  | { kind: 'simple'; commandText: string; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string }
  | { kind: 'parse-unavailable'; reason: string };

export function isNoOpText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('#')) return true;
  return false;
}

export function extractEnvVars(
  token: string
): { name: string; value: string } | null {
  const match = token.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  return { name: match[1]!, value: match[2]! };
}

export function extractRedirections(tokens: string[]): {
  cmdTokens: string[];
  redirects: Redirect[];
} {
  const cmdTokens: string[] = [];
  const redirects: Redirect[] = [];
  let currentFd: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    const fdMatch = token.match(/^(\d+)?(>>?|<<<?|>&|<>)$/);
    if (fdMatch) {
      currentFd = fdMatch[1] || null;
      const operator = fdMatch[2]!;
      if (i + 1 < tokens.length) {
        i++;
        redirects.push({ operator, target: tokens[i]!, fd: currentFd });
        currentFd = null;
      }
      continue;
    }

    if (token === '2>&1' || token === '1>&2') {
      redirects.push({
        operator: '>&',
        target: token.includes('1') ? '1' : '2',
        fd: token.startsWith('2') ? '2' : '1',
      });
      continue;
    }

    if (currentFd) {
      redirects.push({ operator: '>', target: token, fd: currentFd });
      currentFd = null;
      continue;
    }

    cmdTokens.push(token);
  }

  return { cmdTokens, redirects };
}
