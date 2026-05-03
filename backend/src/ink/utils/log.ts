import { logForDebugging } from './debug.js';

export function logError(message: string, error?: unknown): void {
  const details = error instanceof Error ? error.message : String(error ?? '');
  logForDebugging(`[ERROR] ${message}${details ? ': ' + details : ''}`, { level: 'error' });
}
