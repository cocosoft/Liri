/**
 * MDM原始数据读取
 * 基于CC源码 cc_code/backend/utils/settings/mdm/rawRead.ts
 * 最小化模块，用于启动MDM子进程读取而不阻塞事件循环
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import {
  getMacOSPlistPaths,
  MDM_SUBPROCESS_TIMEOUT_MS,
  PLUTIL_ARGS_PREFIX,
  PLUTIL_PATH,
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
  WINDOWS_REGISTRY_VALUE_NAME,
} from './constants.js';

/**
 * 原始读取结果
 */
export type RawReadResult = {
  plistStdouts: Array<{ stdout: string; label: string }> | null;
  hklmStdout: string | null;
  hkcuStdout: string | null;
};

let rawReadPromise: Promise<RawReadResult> | null = null;

/**
 * 执行文件命令的Promise封装
 */
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

/**
 * 执行MDM子进程读取
 * macOS: 并行启动plutil读取每个plist路径，取第一个成功结果
 * Windows: 并行启动reg query读取HKLM和HKCU
 * Linux: 返回空结果
 */
export function fireRawRead(): Promise<RawReadResult> {
  return (async (): Promise<RawReadResult> => {
    if (process.platform === 'darwin') {
      const plistPaths = getMacOSPlistPaths();

      const allResults = await Promise.all(
        plistPaths.map(async ({ path, label }) => {
          if (!existsSync(path)) {
            return { stdout: '', label, ok: false };
          }
          const { stdout, code } = await execFilePromise(PLUTIL_PATH, [
            ...PLUTIL_ARGS_PREFIX,
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
          WINDOWS_REGISTRY_KEY_PATH_HKLM,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
        ]),
        execFilePromise('reg', [
          'query',
          WINDOWS_REGISTRY_KEY_PATH_HKCU,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
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

/**
 * 启动时触发一次MDM原始读取
 */
export function startMdmRawRead(): void {
  if (rawReadPromise) return;
  rawReadPromise = fireRawRead();
}

/**
 * 获取启动时的MDM读取Promise
 */
export function getMdmRawReadPromise(): Promise<RawReadResult> | null {
  return rawReadPromise;
}
