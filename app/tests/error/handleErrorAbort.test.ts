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
 * `handleError` 的「预期中断统一降噪」回归用例（2026-09-25，spec §6.8）
 *
 * 背景：`handleError` 是 §1.9 的**唯一错误入口**，也是告警的唯一闸门
 * （仅 `CRITICAL/HIGH` 才 `publish('error:occurred')`）。预期中止此前被 provider 升格为
 * `EXECUTION/HIGH` ⇒ 触发 `[ALERT] [P2]`。修复后：**预期中断在这里统一收口** ——
 * 只记 warn、不进 `recordError` 统计、不发布 `error:occurred`。
 *
 * **断言为何按"消息"过滤而非全局计数（如实）**：`getErrorStats()` 与 `error:occurred`
 * 都是**进程级单例**，而 bun 测试在同一进程并发跑多个文件（实测：同批其它用例也在发布
 * `High severity error`）⇒ 全局计数断言会假失败。故改为"只统计与本次消息匹配的事件"。
 */
import { describe, it, expect } from 'bun:test';
import { handleError } from '../../src/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '../../src/error/types';
import {
  SYSTEM_ABORT_REASON,
  isAbortReason,
  markAsExpectedAbort,
} from '../../src/error/abortReason';
import { globalEventBus } from '../../src/core/events/EventBus';

/** 订阅 error:occurred，按 message 过滤（隔离安全） */
function trackPublishedMessage(tag: string): {
  count: () => number;
  stop: () => void;
} {
  let n = 0;
  const subscription = globalEventBus.on('error:occurred', ((payload: {
    message?: string;
  }) => {
    if (typeof payload?.message === 'string' && payload.message.includes(tag))
      n++;
  }) as never);
  return { count: () => n, stop: () => subscription.unsubscribe() };
}

describe('handleError：预期中断统一降噪（§6.8）', () => {
  it('裸常量字符串 ⇒ EXPECTED_ABORT / LOW（不计入错误统计、不触发告警的前提）', async () => {
    // 两个易错点（本用例初版就踩了，如实记录）：
    //  ① 判据对字符串形态**精确匹配** ⇒ 不能给常量加后缀（既有用例断言 `-extra` 必须为 false）；
    //  ② 广义判据只认**裸字符串本体** —— 包成 `new Error(常量)` 后 name 不是 AbortError、
    //     message 也不含 'aborted' ⇒ **不命中**（"Error.message === 常量"那条兼容分支属于
    //     **狭义** `isSystemAbortReason`，不在广义判据内）。故此处直接传裸字符串。
    const r = await handleError(SYSTEM_ABORT_REASON, {
      module: 'test:abort',
      action: 'demo',
    });
    expect(r.code).toBe('EXPECTED_ABORT');
    expect(r.severity).toBe(ErrorSeverity.LOW);
  });

  it('AbortError 形态（用户停止 / 传输中止）同样降噪', async () => {
    const r = await handleError(
      new DOMException('user stopped', 'AbortError'),
      {
        module: 'test:abort',
      }
    );
    expect(r.code).toBe('EXPECTED_ABORT');
    expect(r.severity).toBe(ErrorSeverity.LOW);
  });

  it('被**包装过**的预期中断（品牌位）仍被识别并降噪', async () => {
    // 模拟 provider 包装：文案变了、name 变了，只有品牌位能穿过包装
    const tag = 'tag-branded-wrapper';
    const wrapped = markAsExpectedAbort(
      new AppError(
        `OpenAI stream failed: ${SYSTEM_ABORT_REASON}:${tag}（Provider: db:x / api.example.com）`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.LOW,
        '1000'
      )
    );
    expect(isAbortReason(wrapped)).toBe(true);

    const tracker = trackPublishedMessage(tag);
    try {
      const r = await handleError(wrapped, { module: 'test:abort' });
      expect(r.code).toBe('EXPECTED_ABORT');
      expect(tracker.count()).toBe(0);
    } finally {
      tracker.stop();
    }
  });

  it('级联中止（`[CASCADE_ABORTED]`）形态：携带品牌后必须被识别并降噪', async () => {
    // 背景：`ParallelToolExecutor` 的级联中止 rejection 原用**大写** `[CASCADE_ABORTED]`，
    // 而判据对 Error 走大小写敏感的 `includes('aborted')` ⇒ 命中不了 ⇒ 落到 `executeOne`
    // 的 catch 后被 `handleError` 记成 ERROR 级 + 进错误统计。修复=携带品牌位。
    //
    // 覆盖边界（如实）：本用例锁定的是**契约**（"级联中止形态 + 品牌 ⇒ 降噪"）；
    // 执行器内部的绑定（rejection 确实带上了品牌）无法在此直接断言 —— 仓库禁用
    // `mock.module`，且 `executeOne` 内部 catch 会把 rejection 转成 result 对象、
    // 品牌与错误对象都不外露。该绑定由代码评审 + `typecheck` 保证。
    const tag = 'tag-cascade-aborted';
    const cascadeAbort = markAsExpectedAbort(
      new Error(`[CASCADE_ABORTED] ${tag}`)
    );
    expect(isAbortReason(cascadeAbort)).toBe(true);
    // 反向锁定：**不带**品牌的同文案错误仍判为"非预期中断"（即修复前行为）——
    // 防止有人把修复改成"靠 `[CASCADE_ABORTED]` 字符串"（判据刻意大小写敏感，不认它）
    expect(isAbortReason(new Error('[CASCADE_ABORTED] x'))).toBe(false);

    const tracker = trackPublishedMessage(tag);
    try {
      const r = await handleError(cascadeAbort, {
        module: 'query:parallelToolExecutor',
        action: 'executeOne',
      });
      expect(r.code).toBe('EXPECTED_ABORT');
      expect(tracker.count()).toBe(0);
    } finally {
      tracker.stop();
    }
  });

  it('对照：真实 HIGH 级错误**仍**以该消息发布 error:occurred（防"一刀切静默"）', async () => {
    const tag = 'tag-real-failure';
    const tracker = trackPublishedMessage(tag);
    try {
      const r = await handleError(
        new AppError(tag, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000'),
        { module: 'test:real' }
      );
      expect(r.severity).toBe(ErrorSeverity.HIGH);
      expect(tracker.count()).toBe(1);
    } finally {
      tracker.stop();
    }
  });

  it('对照：普通 Error 仍按 UNHANDLED_ERROR / MEDIUM 包装（常规路径不受影响）', async () => {
    const r = await handleError(new Error('boom'), { module: 'test:real' });
    expect(r.code).toBe('UNHANDLED_ERROR');
    expect(r.severity).toBe(ErrorSeverity.MEDIUM);
  });
});
