/**
 * K8（2026-11-26）：知识编译进度 SSE 广播节流 —— 判定函数单测。
 *
 * 背景：编译循环对每个 raw 文件调用一次 `updateCompileProgress`（真机 593 次/轮），
 * 原实现逐次 `broadcastEvent('knowledge:compile:progress')` ⇒ 每轮 593 个 SSE 事件，
 * 而前端只用来渲染 `current/total`。改为时间节流后，内存进度**仍然逐文件更新**
 * （HTTP 轮询精度不变），只是广播降频。
 *
 * 本测试钉住三条不可让步的语义：
 *  ① 失败必须即时广播（不能等节流窗口）；
 *  ② 走到最后一个文件必须广播（前端要看到 N/N）；
 *  ③ 其余情况在节流窗口内不重复广播。
 */
import { describe, expect, it } from 'bun:test';

import { shouldBroadcastProgress } from '../../src/knowledge/CompileProgressTracker';

const base = {
  current: 10,
  total: 100,
  lastBroadcastAt: 1_000,
  now: 1_050,
  hasError: false,
};

describe('shouldBroadcastProgress — 进度广播节流判定（K8）', () => {
  it('① 带错误 ⇒ 无视节流窗口，立即广播', () => {
    expect(
      shouldBroadcastProgress({ ...base, hasError: true, now: 1_001 })
    ).toBe(true);
  });

  it('② 走到最后一个文件 ⇒ 立即广播', () => {
    expect(
      shouldBroadcastProgress({
        ...base,
        current: 100,
        total: 100,
        now: 1_001,
      })
    ).toBe(true);
  });

  it('③ 节流窗口内（默认 200ms）不重复广播', () => {
    expect(shouldBroadcastProgress({ ...base })).toBe(false);
  });

  it('④ 超过节流窗口 ⇒ 广播', () => {
    expect(shouldBroadcastProgress({ ...base, now: 1_000 + 200 })).toBe(true);
  });

  it('⑤ 首帧（lastBroadcastAt=0，startCompileProgress 后）立刻广播', () => {
    expect(
      shouldBroadcastProgress({ ...base, current: 1, lastBroadcastAt: 0 })
    ).toBe(true);
  });

  it('⑥ total 未知（0）时不会因「等于总数」恒广播，仍按窗口节流', () => {
    expect(
      shouldBroadcastProgress({ ...base, total: 0, current: 0, now: 1_050 })
    ).toBe(false);
  });
});
