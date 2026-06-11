// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Keychain预读取
 * macOS平台优化，减少后续Keychain读取延迟
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
