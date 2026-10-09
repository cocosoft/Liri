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

import { describe, expect, it } from 'bun:test';
import {
  killProcessTree,
  type KillableChild,
} from '../../src/sandbox/utils/killProcessTree';

/**
 * R21（2026-10-09）：取消/中止时必须终止**进程树**（Unix 杀进程组 / Windows `taskkill /T`），
 * 否则 `landlock-run → /bin/sh → 孙进程` 会孤儿化续跑。全部经注入替身断言（**不真杀进程**）。
 */
function stubChild(pid?: number): {
  child: KillableChild;
  killed: string[];
} {
  const killed: string[] = [];
  return {
    killed,
    child: {
      pid,
      kill: (sig?: NodeJS.Signals): boolean => {
        killed.push(sig ?? 'SIGTERM');
        return true;
      },
    },
  };
}

describe('killProcessTree（R21 进程树终止）', () => {
  it('Unix + 有 pid ⇒ 杀**进程组**（不落在直接子进程上）', () => {
    const { child, killed } = stubChild(4321);
    const groups: number[] = [];
    killProcessTree(child, {
      platform: 'linux',
      killGroup: (pid) => groups.push(pid),
    });
    expect(groups).toEqual([4321]);
    expect(killed).toEqual([]); // 未降级到 child.kill
  });

  it('Windows + 有 pid ⇒ 走 taskkill 整树（无信号语义）', () => {
    const { child, killed } = stubChild(999);
    const taskkilled: number[] = [];
    killProcessTree(child, {
      platform: 'win32',
      runTaskkill: (pid) => taskkilled.push(pid),
    });
    expect(taskkilled).toEqual([999]);
    expect(killed).toEqual([]);
  });

  it('无 pid（spawn 尚未给出）⇒ 降级为 child.kill(SIGKILL)', () => {
    const { child, killed } = stubChild(undefined);
    killProcessTree(child, { platform: 'linux', killGroup: () => {} });
    expect(killed).toEqual(['SIGKILL']);
  });

  it('组杀失败（进程组不存在等）⇒ 降级 child.kill，且**不抛错**', () => {
    const { child, killed } = stubChild(7);
    expect(() =>
      killProcessTree(child, {
        platform: 'linux',
        killGroup: () => {
          throw new Error('ESRCH');
        },
      })
    ).not.toThrow();
    expect(killed).toEqual(['SIGKILL']);
  });

  it('child.kill 也抛错 ⇒ 仍不抛错（清理路径不得打断主流程）', () => {
    const child: KillableChild = {
      pid: undefined,
      kill: () => {
        throw new Error('already exited');
      },
    };
    expect(() => killProcessTree(child, { platform: 'win32' })).not.toThrow();
  });
});
