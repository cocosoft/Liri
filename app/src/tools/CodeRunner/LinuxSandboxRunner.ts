/**
 * CodeRunner Linux landlock 执行器（CM-3a）
 *
 * 复用 wrapper（公共层，与 CM-3b 同一 wrapper 保证两平台 API 面一致），
 * 进程隔离手段用 landlock-run（Linux）：
 *   landlock-run <policy args> -- /bin/sh -c "<bun> run wrapper.ts user.ts"
 *
 * 最小 bun 执行 policy（评审建议 1，P0 + 三轮 P0-1）：
 *   - bun 解释器路径 --ro
 *   - 运行目录（wrapper/user.ts/产物）--rw
 *   - ~/.bun 缓存 --rw（bun 首次运行写缓存，未放行会沙箱内启动失败）
 *   - /tmp --rw、/proc --ro（bun 运行时临时文件/运行时读取）
 *   - 无网络规则（net 缺省 → 全禁）
 *
 * 不可用（非 Linux / LSM 未启用 / helper 缺失）→ 返回 null，调用方降级到跨平台执行器。
 * 平台差异仅在进程隔离手段（landlock vs 无），API 面一致（五轮评审 P1-4）。
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';

import { LandlockDetector } from '@modules/sandbox/landlock/LandlockDetector';
import { buildLandlockArgv } from '@modules/sandbox/landlock/runWithLandlock';
import type { LandlockPolicy } from '@modules/sandbox/landlock/types';
import { getLogger } from '@modules/monitoring';

import {
  prepareRunDir,
  runRpcChildProcess,
  type CodeRunnerExecOptions,
} from './CrossPlatformRunner';
import type { CodeRunResult } from './types';

const logger = getLogger('tools:CodeRunner:landlock');

/** landlock-run helper（环境变量可覆盖，默认 PATH 查找） */
const LANDLOCK_HELPER = process.env.LANDLOCK_RUN_HELPER || 'landlock-run';

/**
 * 构造最小 bun 执行 policy（CM-3a）
 */
function buildBunLandlockPolicy(runDir: string, abi: number): LandlockPolicy {
  const fs: LandlockPolicy['fs'] = [
    // bun 解释器（只读+执行）
    { path: dirname(process.execPath), allow: ['read', 'execute'] },
    // 运行目录（wrapper/user.ts/产物）——可写
    {
      path: runDir,
      allow: ['read', 'write', 'execute', 'make_dir', 'make_reg', 'refer'],
    },
    // bun 缓存（首次运行写 ~/.bun）
    {
      path: join(homedir(), '.bun'),
      allow: ['read', 'write', 'make_dir', 'make_reg', 'refer'],
    },
    // /tmp：bun 运行时临时文件
    {
      path: '/tmp',
      allow: ['read', 'write', 'make_dir', 'make_reg', 'remove', 'refer'],
    },
    // /proc：bun 运行时读取
    { path: '/proc', allow: ['read'] },
  ];
  return { cwd: runDir, fs, abi };
}

/**
 * 在 landlock 域中执行编排代码。
 * @returns 执行结果；landlock 不可用时返回 null（调用方降级）
 */
export async function runCodeRunnerWithLandlock(
  opts: CodeRunnerExecOptions
): Promise<CodeRunResult | null> {
  const cap = await LandlockDetector.detect({ helperPath: LANDLOCK_HELPER });
  if (!cap.available) {
    logger.debug('landlock unavailable, fallback to cross-platform runner', {
      reason: cap.reason,
    });
    return null;
  }

  const { runDir, wrapperPath } = await prepareRunDir(opts);
  const policy = buildBunLandlockPolicy(runDir, cap.abi);
  const argv = [
    ...buildLandlockArgv(policy),
    '--',
    '/bin/sh',
    '-c',
    `"${process.execPath}" run "${wrapperPath}" user.ts`,
  ];

  const child = spawn(LANDLOCK_HELPER, argv, {
    cwd: runDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return runRpcChildProcess(child, {
    bridge: opts.bridge,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * 执行编排代码（安全选择器）：Linux + landlock 可用 → landlock；否则跨平台。
 */
export async function runCodeRunnerSafely(
  opts: CodeRunnerExecOptions
): Promise<CodeRunResult> {
  const landlockResult = await runCodeRunnerWithLandlock(opts);
  if (landlockResult) return landlockResult;
  const { runCodeRunner } = await import('./CrossPlatformRunner');
  return runCodeRunner(opts);
}
