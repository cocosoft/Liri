/**
 * Keychain预读取
 * macOS平台优化，减少后续Keychain读取延迟
 * 参考CC_CODE secureStorage/keychainPrefetch.ts实现
 */

import { execFile } from 'child_process';

const KEYCHAIN_PREFETCH_TIMEOUT_MS = 10000;

let legacyApiKeyPrefetch: { stdout: string | null } | null = null;
let prefetchPromise: Promise<void> | null = null;

interface SpawnResult {
  stdout: string | null;
  timedOut: boolean;
}

function spawnSecurity(
  serviceName: string,
  username: string
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-a', username, '-w', '-s', serviceName],
      { encoding: 'utf-8', timeout: KEYCHAIN_PREFETCH_TIMEOUT_MS },
      (err, stdout) => {
        resolve({
          stdout: err ? null : stdout?.trim() || null,
          timedOut: Boolean(
            err &&
            'killed' in err &&
            (err as NodeJS.ErrnoException).code === 'ETIMEDOUT'
          ),
        });
      }
    );
  });
}

export function startKeychainPrefetch(
  serviceNames: string[],
  username: string
): void {
  if (process.platform !== 'darwin' || prefetchPromise) return;

  const spawnPromises = serviceNames.map((name) =>
    spawnSecurity(name, username)
  );

  prefetchPromise = Promise.all(spawnPromises).then((results) => {
    results.forEach((result, index) => {
      if (!result.timedOut && index === 0) {
        legacyApiKeyPrefetch = { stdout: result.stdout };
      }
    });
  });
}

export async function ensureKeychainPrefetchCompleted(): Promise<void> {
  if (prefetchPromise) await prefetchPromise;
}

export function getLegacyApiKeyPrefetchResult(): {
  stdout: string | null;
} | null {
  return legacyApiKeyPrefetch;
}

export function clearLegacyApiKeyPrefetch(): void {
  legacyApiKeyPrefetch = null;
}
