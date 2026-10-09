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
 * Landlock **真负向集成**（R2 / 第九轮审查 §2.1-C）—— 验证"**实际操作被阻止**"，
 * 而非仅断言返回了某个策略/字段。
 *
 * 与既有 `tests/sandbox/*`（**离线策略形状断言**，不 spawn）互补：本文件在真实
 * Landlock 域内运行命令，断言**越权读/越权写/越权子进程**确被内核拒绝。
 *
 * ⚠️ **平台门控（如实）**：Landlock 仅 Linux 内核 5.13+ 且需 `landlock-run` helper
 * （源码 `app/src/sandbox/landlock/native/main.c`，编译产物不入库）。
 * 非 Linux / helper 缺失 ⇒ **显式 skip 并给出原因**（不静默通过）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LandlockDetector, runWithLandlock } from '../../src/sandbox';
import type { LandlockPolicy } from '../../src/sandbox';

const cap = await LandlockDetector.detect({
  helperPath: process.env.LANDLOCK_RUN_HELPER || 'landlock-run',
});

/** `null` = 可运行；否则为 skip 原因（如实，不静默通过） */
const SKIP_REASON: string | null =
  process.platform !== 'linux'
    ? `非 Linux（Landlock 仅 Linux 内核 5.13+）：platform=${process.platform}`
    : !cap.available
      ? `本机 Landlock 不可用（reason=${cap.reason}）；需安装 landlock-run helper`
      : null;

describe.skipIf(SKIP_REASON !== null)(
  `Landlock 真负向集成${SKIP_REASON ? ` —— SKIP: ${SKIP_REASON}` : ''}`,
  () => {
    let workdir = '';
    let outside = '';

    beforeAll(async () => {
      workdir = await mkdtemp(join(tmpdir(), 'll-wd-'));
      outside = await mkdtemp(join(tmpdir(), 'll-out-'));
      await writeFile(join(workdir, 'ok.txt'), 'INSIDE_OK');
      await writeFile(join(outside, 'secret.txt'), 'OUTSIDE_SECRET');
    });

    afterAll(async () => {
      if (workdir) await rm(workdir, { recursive: true, force: true });
      if (outside) await rm(outside, { recursive: true, force: true });
    });

    /** 最小策略：只放行 workdir（读写）+ 运行 `/bin/sh` 与 `cat` 所需系统路径（只读执行） */
    function policy(): LandlockPolicy {
      return {
        cwd: workdir,
        abi: cap.abi,
        fs: [
          {
            path: workdir,
            allow: ['read', 'write', 'make_dir', 'make_reg', 'remove', 'refer'],
          },
          { path: '/bin', allow: ['read', 'execute'] },
          { path: '/usr', allow: ['read', 'execute'] },
          { path: '/lib', allow: ['read', 'execute'] },
          { path: '/lib64', allow: ['read', 'execute'] },
        ],
      };
    }

    it('正向对照：策略内文件可读（防"恒拒"假绿）', async () => {
      const r = await runWithLandlock(policy(), 'cat ok.txt', { cwd: workdir });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('INSIDE_OK');
    });

    it('【负向】越权读：策略外文件读取被阻止（内容不泄露）', async () => {
      const r = await runWithLandlock(policy(), `cat ${outside}/secret.txt`, {
        cwd: workdir,
      });
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout).not.toContain('OUTSIDE_SECRET');
    });

    it('【负向】越权写：策略外写入被阻止（文件未创建）', async () => {
      const target = join(outside, 'pwned.txt');
      const r = await runWithLandlock(policy(), `echo pwned > ${target}`, {
        cwd: workdir,
      });
      expect(r.exitCode).not.toBe(0);
      expect(existsSync(target)).toBe(false);
    });

    it('【负向】越权子进程：域内子进程的越权写同样被阻止（子进程继承域）', async () => {
      const target = join(outside, 'pwned-child.txt');
      const r = await runWithLandlock(
        policy(),
        `/bin/sh -c 'echo pwned > ${target}'`,
        { cwd: workdir }
      );
      expect(r.exitCode).not.toBe(0);
      expect(existsSync(target)).toBe(false);
    });
  }
);
