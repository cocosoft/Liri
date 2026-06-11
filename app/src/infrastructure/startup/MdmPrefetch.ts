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
 * MDM预读取
 * Windows/macOS平台优化，减少后续注册表/plist读取延迟
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';

const MDM_SUBPROCESS_TIMEOUT_MS = 5000;

export interface MdmRawReadResult {
  plistStdouts: Array<{ stdout: string; label: string }> | null;
  hklmStdout: string | null;
  hkcuStdout: string | null;
}

let rawReadPromise: Promise<MdmRawReadResult> | null = null;

function execFilePromise(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { encoding: 'utf-8', timeout: MDM_SUBPROCESS_TIMEOUT_MS },
      (err, stdout) => {
        resolve({ stdout: stdout ?? '', code: err ? 1 : 0 });
      }
    );
  });
}

function fireRawRead(): Promise<MdmRawReadResult> {
  return (async (): Promise<MdmRawReadResult> => {
    if (process.platform === 'darwin') {
      const plistPaths = [
        {
          path: '/Library/Managed Preferences/com.apple.mdm.plist',
          label: 'system',
        },
        { path: '/Users/Shared/com.apple.mdm.plist', label: 'shared' },
      ];

      const allResults = await Promise.all(
        plistPaths.map(async ({ path, label }) => {
          if (!existsSync(path)) {
            return { stdout: '', label, ok: false };
          }
          const { stdout, code } = await execFilePromise('/usr/bin/plutil', [
            '-convert',
            'xml1',
            '-o',
            '-',
            path,
          ]);
          return { stdout, label, ok: code === 0 && !!stdout };
        })
      );

      const winner = allResults.find((r) => r.ok);
      return {
        plistStdouts: winner
          ? [{ stdout: winner.stdout, label: winner.label }]
          : [],
        hklmStdout: null,
        hkcuStdout: null,
      };
    }

    if (process.platform === 'win32') {
      const [hklm, hkcu] = await Promise.all([
        execFilePromise('reg', [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Provisioning',
          '/v',
          'MdmIdentifier',
        ]),
        execFilePromise('reg', [
          'query',
          'HKCU\\SOFTWARE\\Microsoft\\Provisioning',
          '/v',
          'MdmIdentifier',
        ]),
      ]);
      return {
        plistStdouts: null,
        hklmStdout: hklm.code === 0 ? hklm.stdout : null,
        hkcuStdout: hkcu.code === 0 ? hkcu.stdout : null,
      };
    }

    return { plistStdouts: null, hklmStdout: null, hkcuStdout: null };
  })();
}

export function startMdmPrefetch(): void {
  if (rawReadPromise) return;
  rawReadPromise = fireRawRead();
}

export function getMdmPrefetchPromise(): Promise<MdmRawReadResult> | null {
  return rawReadPromise;
}

export async function ensureMdmPrefetchCompleted(): Promise<MdmRawReadResult | null> {
  if (rawReadPromise) {
    return rawReadPromise;
  }
  return null;
}
