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
 * P1/P3（Spec `daily-budget-unification.md`）：日 Token 预算**用量状态持久化**与**本地日界**。
 *
 * 锁定：
 *  - 记账后自动落盘（去抖 ≤1s）⇒ "重启恢复不丢"（堵住"重启即清零"绕过日限额）。
 *  - 恢复时跨**本地**自然日 ⇒ 归零（不把昨日用量带进今日）。
 *  - 状态文件缺失/损坏 ⇒ 从 0 起算，不抛错。
 *  - 落盘日期用**本地**自然日（P3，非 UTC）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  setUserDataDirOverride,
  getUserDataDirOverride,
} from '@openliri/kernel/paths';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
  initDailyBudget,
} from '../../src/query/DailyBudgetManager';
import {
  dailyBudgetStatePath,
  loadDailyBudgetState,
  saveDailyBudgetState,
} from '../../src/query/dailyBudgetPersistence';

/** 本地自然日 YYYY-MM-DD（与实现同口径） */
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 轮询等待"自动落盘"达到期望用量（2026-10-27，CI 实测去抖竞态修复）。
 *
 * 为什么不用固定 sleep：去抖 ≤1s 但 macOS runner 抖动大（实测 1200ms 时仍读到
 * `undefined`）⇒ 固定等待会假红。轮询到期限：断言语义不变（无需显式调用即落盘），
 * 只是不再与 runner 时钟赛跑。
 *
 * @returns 期限内的最后一次读到的 `used`（未落盘 ⇒ `undefined`，由调用方断言）
 */
async function waitForPersistedUsed(
  expected: number,
  timeoutMs = 3_000
): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  let last: number | undefined;
  for (;;) {
    last = (await loadDailyBudgetState())?.used;
    if (last === expected || Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('DailyBudgetManager 用量状态持久化（P1/P3）', () => {
  let baseDir: string;
  const prevOverride = getUserDataDirOverride();
  // `resolveDataDir` 中 `LIRI_DATA_DIR` **优先于** `setUserDataDirOverride` ⇒ 必须同时设置/还原，
  // 否则同进程其他用例泄漏的 `LIRI_DATA_DIR` 会把落盘重定向到别处（测试相互污染）。
  const prevDataDirEnv = process.env.LIRI_DATA_DIR;

  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'daily-budget-test-'));
    setUserDataDirOverride(baseDir);
    process.env.LIRI_DATA_DIR = baseDir;
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
    // 激活落盘（模拟应用启动接线：`initDailyBudget` 开启持久化）
    await initDailyBudget();
  });
  afterEach(async () => {
    // 先 flush 以清掉去抖定时器，避免临时目录移除后定时器仍触发写盘
    await getDailyBudget().persistNow();
    resetDailyBudgetForTest();
    setUserDataDirOverride(prevOverride);
    if (prevDataDirEnv === undefined) delete process.env.LIRI_DATA_DIR;
    else process.env.LIRI_DATA_DIR = prevDataDirEnv;
    rmSync(baseDir, { recursive: true, force: true });
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('重启恢复不丢：持久化后新实例 restore 恢复当日用量', async () => {
    const b1 = getDailyBudget();
    b1.recordUsage(123_456);
    await b1.persistNow();

    resetDailyBudgetForTest(); // 模拟进程重启（单例丢弃，内存态清空）
    await initDailyBudget(); // 启动时恢复
    expect(getDailyBudget().getMode().todayUsed).toBe(123_456);
  });

  it('记账后自动落盘（去抖 ≤1s）：无需显式调用即可恢复', async () => {
    getDailyBudget().recordUsage(7_000);
    // 2026-10-27（CI 实测）：原为固定 `sleep(1200ms)` 断言——macOS runner 上
    // 去抖定时器 + 写盘可能晚于 1200ms（实测该用例 1423ms 时读到 undefined）
    // ⇒ 改为**轮询到期限**（≤3s）：断言语义不变（无需显式调用即可落盘），
    // 只是不再与 runner 时钟赛跑。
    const persisted = await waitForPersistedUsed(7_000);
    expect(persisted).toBe(7_000);
  });

  it('跨本地日界清零：持久化日期 ≠ 今日 ⇒ 恢复为 0', async () => {
    await saveDailyBudgetState({ date: '2000-01-01', used: 999_999 });
    resetDailyBudgetForTest();
    await initDailyBudget();
    expect(getDailyBudget().getMode().todayUsed).toBe(0);
  });

  it('同日 ⇒ 恢复持久化用量', async () => {
    await saveDailyBudgetState({ date: localToday(), used: 42_000 });
    resetDailyBudgetForTest();
    await initDailyBudget();
    expect(getDailyBudget().getMode().todayUsed).toBe(42_000);
  });

  it('落盘日期用**本地**自然日（P3，非 UTC）', async () => {
    const b = getDailyBudget();
    b.recordUsage(1);
    await b.persistNow();
    const persisted = await loadDailyBudgetState();
    expect(persisted?.date).toBe(localToday());
  });

  it('状态文件损坏 ⇒ 从 0 起算且不抛错', async () => {
    await mkdir(dirname(dailyBudgetStatePath()), { recursive: true });
    await writeFile(dailyBudgetStatePath(), '{ not json', 'utf-8');
    resetDailyBudgetForTest();
    await initDailyBudget();
    expect(getDailyBudget().getMode().todayUsed).toBe(0);
  });

  it('状态文件缺失 ⇒ 从 0 起算（首次运行）', async () => {
    resetDailyBudgetForTest();
    await initDailyBudget();
    expect(await loadDailyBudgetState()).toBeNull();
    expect(getDailyBudget().getMode().todayUsed).toBe(0);
  });

  it('reset 后立即落盘（重启不会把旧用量恢复回来）', async () => {
    const b = getDailyBudget();
    b.recordUsage(9_999);
    await b.persistNow();
    b.reset();
    // reset 内部 `void persistNow()` 为异步；等待 microtask/IO 完成后再模拟重启
    await new Promise((r) => setTimeout(r, 50));
    resetDailyBudgetForTest();
    await initDailyBudget();
    expect(getDailyBudget().getMode().todayUsed).toBe(0);
  });

  // ── D-b/D-d 回归（2026-10-11）：读取侧必须与写入侧形状对称 ──
  // `_persistedState()` 写 `{date, used, debt, relief}`，而 `loadDailyBudgetState()`
  // 曾只回 `{date, used}` ⇒ `restore({debt, relief})` 恒拿到 `undefined` ⇒
  // 欠账与放行**重启即丢**（D-d 次日扣回静默失效、D-b 放行丢失）。

  it('持久化往返：欠账 debt 与放行 relief 重启后仍恢复（D-b/D-d）', async () => {
    const future = Date.now() + 60_000;
    await saveDailyBudgetState({
      date: localToday(),
      used: 10_000,
      debt: 5_000,
      relief: { kind: 'boost', expiresAt: future, factor: 2 },
    });

    // ① 读取侧直接断言（回归点：loader 曾丢掉这两个字段）
    const persisted = await loadDailyBudgetState();
    expect(persisted?.debt).toBe(5_000);
    expect(persisted?.relief?.kind).toBe('boost');

    // ② 全链：模拟重启 ⇒ 欠账与未过期放行都还在
    resetDailyBudgetForTest();
    await initDailyBudget();
    expect(getDailyBudget().getDebtTokens()).toBe(5_000);
    expect(getDailyBudget().getRelief()?.kind).toBe('boost');
  });

  it('放行 relief 形状非法 ⇒ 按无放行读取（不抛错、不误当有效放行）', async () => {
    await saveDailyBudgetState({
      date: localToday(),
      used: 1,
      // 缺 `expiresAt` 的 boost：不得当成"永不过期"的放行（否则=重启即提额）
      relief: { kind: 'boost' } as never,
    });
    const persisted = await loadDailyBudgetState();
    expect(persisted?.relief ?? null).toBeNull();
  });

  // ── 撤销放行（DELETE /relief，2026-10-12）：撤销后**重启不得复活** ──
  // 这条与上面的"往返恢复"是一对：`relief` 会持久化 ⇒ 撤销必须**落盘**才算真撤销。

  it('clearRelief 后落盘不含 relief，且重启不复现放行', async () => {
    const b = getDailyBudget();
    b.applyRelief({ kind: 'unlock-today' });
    await b.persistNow();
    expect((await loadDailyBudgetState())?.relief?.kind).toBe('unlock-today');

    b.clearRelief();
    await b.persistNow(); // clearRelief 内部已 `void persistNow()`；此处确保写盘完成
    expect((await loadDailyBudgetState())?.relief ?? null).toBeNull();

    resetDailyBudgetForTest();
    await initDailyBudget();
    expect(getDailyBudget().getRelief()).toBeNull();
  });
});
