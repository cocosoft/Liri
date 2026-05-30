import * as fs from 'fs';
import * as path from 'path';
import { resolveMemoryDir } from '@modules/config/paths';

export function getAutoMemPath(): string {
  return path.join(resolveMemoryDir(), 'MEMORY.md');
}

export function isAutoMemoryEnabled(): boolean {
  if (process.env.Liri_DISABLE_AUTO_MEMORY === 'true') return false;
  return fs.existsSync(getAutoMemPath());
}

export function hasAutoMemPathOverride(): boolean {
  return !!process.env.Liri_AUTO_MEM_PATH;
}

export function getAutoMemPathOverride(): string | null {
  return process.env.Liri_AUTO_MEM_PATH || null;
}
