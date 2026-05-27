import { join } from 'path';
import { getPyAppConfigHomeDir } from '@modules/utils/envUtils.js';

/**
 * Get the team memory directory path.
 */
export function getTeamMemPath(): string {
  const configHome = getPyAppConfigHomeDir();
  return join(configHome, 'team-memory');
}

/**
 * Get the shared team memory directory path.
 */
export function getSharedTeamMemPath(): string {
  const configHome = getPyAppConfigHomeDir();
  return join(configHome, 'team-memory', 'shared');
}
