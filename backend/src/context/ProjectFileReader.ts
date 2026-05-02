/**
 * 项目文件读取器（参考CC源码 context.ts getClaudeMds）
 * 读取 PY_APP.md（对应CC的CLAUDE.md，遵循规则K品牌约束）
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectFiles {
  pyAppMd: string | null;
  memoryMd: string | null;
  readme: string | null;
}

const MAX_FILE_CHARS = 10_000;

function safeReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return null;
    if (stat.size > 1024 * 1024) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.length > MAX_FILE_CHARS) {
      return content.substring(0, MAX_FILE_CHARS) + '\n...(truncated)';
    }
    return content;
  } catch {
    return null;
  }
}

const PY_APP_MD_PATHS = [
  'PY_APP.md',
  '.py_app/PY_APP.md',
  '.github/PY_APP.md',
];

const MEMORY_MD_PATHS = [
  'MEMORY.md',
  '.py_app/MEMORY.md',
];

export function readProjectFiles(cwd: string): ProjectFiles {
  let pyAppMd: string | null = null;
  for (const relPath of PY_APP_MD_PATHS) {
    const fullPath = path.join(cwd, relPath);
    const content = safeReadFile(fullPath);
    if (content) {
      pyAppMd = content;
      break;
    }
  }

  let memoryMd: string | null = null;
  for (const relPath of MEMORY_MD_PATHS) {
    const fullPath = path.join(cwd, relPath);
    const content = safeReadFile(fullPath);
    if (content) {
      memoryMd = content;
      break;
    }
  }

  const readme = safeReadFile(path.join(cwd, 'README.md'));

  return { pyAppMd, memoryMd, readme };
}

export function readUserPyAppMd(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return null;
  return safeReadFile(path.join(home, '.py_app', 'PY_APP.md'))
    || safeReadFile(path.join(home, 'PY_APP.md'));
}
