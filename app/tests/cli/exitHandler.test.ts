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
import { ExitHandler, createExitHandler } from '../../src/cli/exitHandler';

/**
 * O6（2026-10-06）回归守卫：`runExitCleanup()` 只执行清理、**不调用 `process.exit`**。
 *
 * 原 `cli/index.ts` 的 `process.on('exit', () => exitHandler.exit(0))` 会在退出钩子内
 * 调 `process.exit(0)`，把**已确定的退出码强制改为 0**（实测 `process.exitCode=3` ⇒ 退出码 0）
 * ⇒ commander 的 `exit(1)` 与失败码全部失效。修复后钩子改调本方法。
 *
 * 判据（可证伪）：若 `runExitCleanup()` 内出现 `process.exit`，本文件的用例**不会走到断言**。
 */
describe('ExitHandler.runExitCleanup（O6：不改退出码）', () => {
  it('按注册顺序执行全部清理处理器', async () => {
    const h = new ExitHandler();
    const calls: string[] = [];
    h.registerExitHandler(async () => {
      calls.push('a');
    });
    h.registerExitHandler(async () => {
      calls.push('b');
    });

    await h.runExitCleanup();

    expect(calls).toEqual(['a', 'b']);
  });

  it('单个处理器抛错不阻断其余（亦不终止进程）', async () => {
    const h = new ExitHandler();
    const calls: string[] = [];
    h.registerExitHandler(async () => {
      throw new Error('boom');
    });
    h.registerExitHandler(async () => {
      calls.push('after');
    });

    await h.runExitCleanup();

    expect(calls).toEqual(['after']);
  });

  it('createExitHandler 返回实例，注册/注销计数正确', () => {
    const h = createExitHandler();
    const fn = async (): Promise<void> => {};
    h.registerExitHandler(fn);
    expect(h.getHandlerCount()).toBe(1);
    h.unregisterExitHandler(fn);
    expect(h.getHandlerCount()).toBe(0);
  });
});
