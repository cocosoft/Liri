/**
 * Gitignore 规则解析
 *
 * 解析 .gitignore 文件规则，支持模式匹配和目录遍历检测
 * 参考 git 官方文档的 gitignore pattern 规范
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join, relative, normalize } from 'path';
import { existsSync } from 'fs';
import { resolveGitDir } from './GitFilesystem';

export interface IgnoreRule {
  pattern: string;
  negation: boolean;
  isDirectory: boolean;
  anchored: boolean;
  source: string;
}

const GLOBAL_GITIGNORE_BASE =
  process.platform === 'win32'
    ? join(
        process.env.USERPROFILE || 'C:\\Users\\Default',
        '.config',
        'git',
        'ignore'
      )
    : join(process.env.HOME || '/root', '.config', 'git', 'ignore');

function getGlobalGitignorePath(): string {
  return GLOBAL_GITIGNORE_BASE;
}

export function normalizePattern(pattern: string): string {
  let p = pattern.trim();
  if (p.length === 0) return p;

  const negation = p.startsWith('!');
  if (negation) p = p.slice(1).trim();

  const isDirectory = p.endsWith('/');
  if (isDirectory) p = p.slice(0, -1);

  return (negation ? '!' : '') + p;
}

export async function parseGitignoreFile(
  filePath: string
): Promise<{ rules: IgnoreRule[]; source: string }> {
  const rules: IgnoreRule[] = [];
  try {
    const content = await readFile(filePath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) continue;

      const negation = line.startsWith('!');
      const pattern = negation ? line.slice(1).trim() : line;
      if (pattern.length === 0) continue;

      const isDirectory = pattern.endsWith('/');
      const cleanPattern = isDirectory ? pattern.slice(0, -1) : pattern;
      const anchored = cleanPattern.includes('/');

      rules.push({
        pattern: normalizePattern(line),
        negation,
        isDirectory,
        anchored,
        source: filePath,
      });
    }
  } catch {
    // file doesn't exist, return empty rules
  }

  return { rules, source: filePath };
}

export function patternToRegex(pattern: string): RegExp {
  let regexStr = '';

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    switch (ch) {
      case '*':
        if (pattern[i + 1] === '*') {
          i++;
          if (pattern[i + 1] === '/') {
            i++;
            regexStr += '(.*/)?';
          } else {
            regexStr += '.*';
          }
        } else {
          regexStr += '[^/]*';
        }
        break;
      case '?':
        regexStr += '[^/]';
        break;
      case '.':
      case '+':
      case '^':
      case '$':
      case '(':
      case ')':
      case '{':
      case '}':
      case '|':
      case '[':
      case ']':
      case '\\':
        regexStr += '\\' + ch;
        break;
      default:
        regexStr += ch;
    }
  }

  return new RegExp(`^${regexStr}$`);
}

export function isPathIgnored(
  filePath: string,
  rules: IgnoreRule[],
  cwd: string
): boolean {
  let ignored = false;
  const relPath = relative(cwd, normalize(filePath)).replace(/\\/g, '/');

  for (const rule of rules) {
    const { pattern, negation, anchored } = rule;
    const cleanPattern = negation ? pattern.slice(1) : pattern;

    let regex: RegExp;
    if (anchored) {
      regex = patternToRegex(cleanPattern);
    } else {
      regex = new RegExp(
        `(^|/)${cleanPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
      );
    }

    if (regex.test(relPath) || regex.test(filePath.replace(/\\/g, '/'))) {
      ignored = !negation;
    }
  }

  return ignored;
}

export async function loadAllGitignoreRules(
  cwd: string
): Promise<IgnoreRule[]> {
  const allRules: IgnoreRule[] = [];

  // Load global gitignore
  const globalPath = getGlobalGitignorePath();
  const { rules: globalRules } = await parseGitignoreFile(globalPath);
  allRules.push(...globalRules);

  // Walk up from cwd to git root collecting .gitignore files
  const gitDir = await resolveGitDir(cwd);
  if (!gitDir) return allRules;

  // Load .git/info/exclude
  const excludePath = join(gitDir, 'info', 'exclude');
  const { rules: excludeRules } = await parseGitignoreFile(excludePath);
  allRules.push(...excludeRules);

  // Walk directory tree collecting .gitignore
  const gitRoot = dirname(gitDir);
  let current = normalize(cwd);
  while (current.startsWith(gitRoot) && current !== gitRoot) {
    const ignoreFile = join(current, '.gitignore');
    const { rules } = await parseGitignoreFile(ignoreFile);
    allRules.push(...rules);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Root .gitignore
  const rootIgnore = join(gitRoot, '.gitignore');
  const { rules: rootRules } = await parseGitignoreFile(rootIgnore);
  allRules.push(...rootRules);

  return allRules;
}

export async function isFileGitignored(
  filePath: string,
  cwd: string
): Promise<boolean> {
  const rules = await loadAllGitignoreRules(cwd);
  return isPathIgnored(filePath, rules, cwd);
}

export async function addToGlobalGitignore(pattern: string): Promise<boolean> {
  const globalPath = getGlobalGitignorePath();
  const gitignoreEntry = pattern.includes('/') ? pattern : `**/${pattern}`;

  try {
    await mkdir(dirname(globalPath), { recursive: true });
  } catch {
    // directory already exists or cannot create
  }

  try {
    if (existsSync(globalPath)) {
      const content = await readFile(globalPath, 'utf-8');
      if (content.includes(gitignoreEntry)) return true;
      const newContent = content.endsWith('\n')
        ? `${content}${gitignoreEntry}\n`
        : `${content}\n${gitignoreEntry}\n`;
      await writeFile(globalPath, newContent, 'utf-8');
    } else {
      await writeFile(globalPath, `${gitignoreEntry}\n`, 'utf-8');
    }
    return true;
  } catch {
    return false;
  }
}

export async function checkGitignoreStatus(
  filePath: string,
  cwd: string
): Promise<{
  isIgnored: boolean;
  matchingRules: string[];
  globalIgnoreExists: boolean;
}> {
  const rules = await loadAllGitignoreRules(cwd);
  const relPath = relative(cwd, normalize(filePath)).replace(/\\/g, '/');

  const matchingRules: string[] = [];
  let isIgnored = false;

  for (const rule of rules) {
    const { pattern, negation, anchored } = rule;
    const cleanPattern = negation ? pattern.slice(1) : pattern;

    let regex: RegExp;
    if (anchored) {
      regex = patternToRegex(cleanPattern);
    } else {
      regex = new RegExp(
        `(^|/)${cleanPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
      );
    }

    if (regex.test(relPath)) {
      if (negation) {
        isIgnored = false;
      } else {
        isIgnored = true;
        matchingRules.push(rule.source);
      }
    }
  }

  return {
    isIgnored,
    matchingRules: [...new Set(matchingRules)],
    globalIgnoreExists: existsSync(getGlobalGitignorePath()),
  };
}
