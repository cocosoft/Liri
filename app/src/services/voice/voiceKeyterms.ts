/**
 * 语音关键词
 * 提升语音识别准确率的关键词列表
 * */

import { basename } from 'path';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services:voice:voiceKeyterms',
  level: LogLevel.INFO,
});

const GLOBAL_KEYTERMS: readonly string[] = [
  'MCP',
  'symlink',
  'grep',
  'regex',
  'localhost',
  'codebase',
  'TypeScript',
  'JSON',
  'OAuth',
  'webhook',
  'gRPC',
  'dotfiles',
  'subagent',
  'worktree',
];

const MAX_KEYTERMS = 50;

/**
 * 拆分标识符为单词
 * 支持camelCase、PascalCase、kebab-case、snake_case
 */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_./\s]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && w.length <= 20);
}

/**
 * 获取语音关键词列表
 * @param recentFiles 最近打开的文件列表
 */
export async function getVoiceKeyterms(
  recentFiles?: ReadonlySet<string>
): Promise<string[]> {
  const terms = new Set<string>(GLOBAL_KEYTERMS);

  try {
    const projectRoot = process.cwd();
    if (projectRoot) {
      const name = basename(projectRoot);
      if (name.length > 2 && name.length <= 50) {
        terms.add(name);
      }
    }
  } catch (err) {
    // ignore

    handleError(err, {
      module: 'services:voice',
      action: 'scanDirectoryTerms',
    });
  }

  if (recentFiles) {
    for (const filePath of recentFiles) {
      if (terms.size >= MAX_KEYTERMS) break;
      const stem = basename(filePath).replace(/\.[^.]+$/, '');
      for (const word of splitIdentifier(stem)) {
        terms.add(word);
      }
    }
  }

  return Array.from(terms).slice(0, MAX_KEYTERMS);
}
