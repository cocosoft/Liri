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
 * Landlock 能力探测（P1，2026-08-25）
 *
 * 检测顺序（对齐方案 §4.2(3)）：
 *   1. 平台门控（非 Linux 直接不可用）
 *   2. `/sys/kernel/security/lsm` 快速预检（是否含 landlock）
 *   3. 功能 probe：`landlock-run --probe`（真实构建 ruleset，验证内核实际允许 enforce）
 *
 * 结果缓存：运行期内核能力不变，避免每次命令执行都 spawn probe。
 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { LandlockCapability } from './types';
import { MAX_SUPPORTED_ABI, MIN_FS_ABI } from './LandlockPolicyBuilder';

const DEFAULT_HELPER = 'landlock-run';
const LSM_PATH = '/sys/kernel/security/lsm';
const DEFAULT_PROBE_TIMEOUT_MS = 5000;
/** fail-closed：helper 初始化失败退出码（对齐参考仓库 cli-contract.md） */
const EXIT_SANDBOX_INIT_FAILED = 125;

let cached: LandlockCapability | null = null;

export class LandlockDetector {
  /**
   * 探测 Landlock 可用性（平台门控 + LSM 预检 + 功能 probe）。
   * 结果缓存；`clearCache()` 供测试重置。
   */
  static async detect(
    options: { helperPath?: string; probeTimeoutMs?: number } = {}
  ): Promise<LandlockCapability> {
    if (cached) return cached;
    const cap = await detectInternal(options);
    cached = cap;
    return cap;
  }

  /** 测试用：清空缓存 */
  static clearCache(): void {
    cached = null;
  }
}

async function detectInternal(options: {
  helperPath?: string;
  probeTimeoutMs?: number;
}): Promise<LandlockCapability> {
  // 1. 平台门控（Windows/macOS 直接不可用，含当前开发机）
  if (process.platform !== 'linux') {
    return { available: false, abi: 0, reason: 'no-linux' };
  }
  // 2. LSM 快速预检
  const inLsm = await landlockInLsm();
  if (!inLsm) {
    return { available: false, abi: 0, reason: 'not-in-lsm' };
  }
  // 3. 功能 probe：真实构建 ruleset 验证 enforce 被允许（LSM 列表有盲区）
  return probeLandlock(
    options.helperPath ?? DEFAULT_HELPER,
    options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  );
}

async function landlockInLsm(): Promise<boolean> {
  try {
    const content = await readFile(LSM_PATH, 'utf8');
    return content.split(',').some((s) => s.trim().includes('landlock'));
  } catch {
    return false;
  }
}

function probeLandlock(
  helper: string,
  timeoutMs: number
): Promise<LandlockCapability> {
  return new Promise((resolve) => {
    const child = spawn(helper, ['--probe'], { timeout: timeoutMs });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({ available: false, abi: 0, reason: 'helper-missing' });
      } else {
        resolve({ available: false, abi: 0, reason: 'probe-failed' });
      }
    });
    child.on('close', (code) => {
      if (code === EXIT_SANDBOX_INIT_FAILED) {
        resolve({ available: false, abi: 0, reason: 'probe-failed' });
        return;
      }
      // stdout 契约（参考仓库 main.c）：'landlock: fully enforced' / 'partially enforced (older ABI)'
      if (stdout.includes('fully')) {
        resolve({ available: true, abi: MAX_SUPPORTED_ABI });
        return;
      }
      if (stdout.includes('partial')) {
        // 旧 ABI：保守取 v1（策略经 clampAccessByAbi 裁剪）
        resolve({ available: true, abi: MIN_FS_ABI });
        return;
      }
      resolve({ available: false, abi: 0, reason: 'enforce-denied' });
    });
  });
}
