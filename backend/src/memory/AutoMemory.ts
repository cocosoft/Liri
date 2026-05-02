/**
 * 自动记忆开关（基于CC源码 memdir/paths.ts isAutoMemoryEnabled）
 */
import * as fs from 'fs';
import * as path from 'path';

export function getAutoMemPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.py_app', 'MEMORY.md');
}

export function isAutoMemoryEnabled(cwd: string = process.cwd()): boolean {
  if (process.env.PY_APP_DISABLE_AUTO_MEMORY === 'true') return false;
  return fs.existsSync(getAutoMemPath(cwd));
}

export function hasAutoMemPathOverride(): boolean {
  return !!process.env.PY_APP_AUTO_MEM_PATH;
}

export function getAutoMemPathOverride(): string | null {
  return process.env.PY_APP_AUTO_MEM_PATH || null;
}
