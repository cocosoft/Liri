import { join } from 'path';
import { getOriginalCwd } from '@modules/bootstrap/state.js';
import { getPyAppConfigHomeDir } from '@modules/utils/envUtils.js';
import { getProjectDir } from '@modules/utils/sessionStorage.js';

/**
 * Get the auto memory directory path.
 */
export function getAutoMemPath(): string {
  const cwd = getOriginalCwd();
  const projectDir = getProjectDir(cwd);
  return join(projectDir, 'memory');
}

/**
 * Get the user memory directory path.
 */
export function getUserMemPath(): string {
  const configHome = getPyAppConfigHomeDir();
  return join(configHome, 'memory');
}

/**
 * Check if auto memory is enabled.
 */
export function isAutoMemoryEnabled(): boolean {
  // TODO: Implement proper auto memory enabled check
  // This could be based on environment variables or settings
  return true;
}

/**
 * Resolve memory directory path based on type.
 */
export function resolveMemoryDir(type: 'auto' | 'user'): string {
  return type === 'auto' ? getAutoMemPath() : getUserMemPath();
}
