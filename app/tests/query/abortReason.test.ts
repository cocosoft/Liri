// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 「预期中断」判据收敛回归（2026-09-25）
//
// 背景（溯源见 `dev_docs/error_repairs/last-exit-20260925-0154Z.md`）：
// 全局 `unhandledRejection` 处理器原**内联**判据只认 `DOMException`/`Error` 形态的 AbortError
// ⇒ **裸字符串** `SYSTEM_ABORT_REASON`（`abort(reason)` 传字符串时，未被 catch 的 promise 链
// 会以该字符串**本体**作为 rejection reason 外泄）漏判，被误记为真异常：
// 写崩溃转储 + `UNHANDLED_ERROR/severity:medium` + error 级日志。
// 实测样本：2026-09-25T01:54:25.188Z（`main`/`app:top`，reason 原文 `liri:system-abort`，
// `originalType: string`），触发动作 = **删除正在流式运行的会话**。
//
// 本用例锁两件事：
//  ① 四类 AbortError 形态**全部**判为预期中断（含本次新增的裸字符串形态）；
//  ② 收窄口径：**其它字符串/值一律不放过**（否则会把真实错误当预期中断 —— 反向漏判）。

import { describe, it, expect } from 'bun:test';
import {
  SYSTEM_ABORT_REASON,
  createSystemAbortReason,
  isAbortReason,
  isSystemAbortReason,
} from '../../src/query/ReActLoop.js';
// 品牌标记是 provider 侧的包装辅助（非 `@modules/query` 出口），直接从下沉后的家引入
import { markAsExpectedAbort } from '../../src/error/abortReason.js';

describe('isAbortReason：预期中断判据（2026-09-25）', () => {
  it('系统侧中止的裸字符串形态判为预期中断（本次修复点；修复前为 false）', () => {
    expect(isAbortReason(SYSTEM_ABORT_REASON)).toBe(true);
    // 与常量同值但非同引用的字符串同样命中（值比较，非引用比较）
    expect(isAbortReason(`${SYSTEM_ABORT_REASON}`)).toBe(true);
    expect(isAbortReason('liri:system-abort')).toBe(true);
  });

  it('DOMException / Error 形态的 AbortError 仍判为预期中断（既有语义不变）', () => {
    expect(isAbortReason(new DOMException('stopped', 'AbortError'))).toBe(true);
    const named = new Error('stopped');
    named.name = 'AbortError';
    expect(isAbortReason(named)).toBe(true);
    expect(isAbortReason(new Error('The operation was aborted'))).toBe(true);
  });

  it('收窄口径：其它字符串与任意非 Abort 值一律不放过', () => {
    // 关键反向断言：**任意含 abort 的字符串**不得被放过
    expect(isAbortReason('aborted')).toBe(false);
    expect(isAbortReason('liri:system-abort-extra')).toBe(false);
    expect(isAbortReason('liri:user-abort')).toBe(false);
    // 普通错误 / 空值 / 其它类型
    expect(isAbortReason(new Error('boom'))).toBe(false);
    expect(isAbortReason(undefined)).toBe(false);
    expect(isAbortReason(null)).toBe(false);
    expect(isAbortReason({ name: 'AbortError', message: 'x' })).toBe(false);
    expect(isAbortReason(42)).toBe(false);
  });
});

// ② 加固（`.trae/specs/system-abort-reason-hardening.md`）：系统侧标记改为**带栈的 Error**，
// 并把"是否系统侧中止"收敛为**狭义**判据（与 ① 的广义判据分工）。
describe('isSystemAbortReason：系统侧标记（狭义，② 加固 2026-09-25）', () => {
  it('Error 形态（主路径）：每次新实例、带真实调用点栈、可被广义判据同时识别', () => {
    const reason = createSystemAbortReason();

    // 普通 Error + 品牌属性（不建子类：见 `createSystemAbortReason` 注释里的 R01-002 / AppError 顾虑）
    expect(reason).toBeInstanceOf(Error);
    expect(reason.name).toBe('AbortError');
    // G5 文案稳定：message 严格等于常量 ⇒ 所有取 `.message` 的派生文案逐字不变
    expect(reason.message).toBe(SYSTEM_ABORT_REASON);

    // G1 可定位（② 的核心）：栈非空，且含**调用点**（本测试文件）—— 修复前 reason 是裸字符串，无栈
    expect(typeof reason.stack).toBe('string');
    expect(reason.stack?.includes('abortReason.test.ts')).toBe(true);

    // 非单例：两次中止必须是**不同实例**（共享单例会让所有栈都指向模块加载点 ⇒ 等于没有栈）
    expect(createSystemAbortReason()).not.toBe(reason);

    // 与 ① 的分工：Error 形态也属"预期中断"（name='AbortError'）
    expect(isAbortReason(reason)).toBe(true);
    expect(isSystemAbortReason(reason)).toBe(true);
  });

  it('兼容形态：裸字符串常量 / 同值 Error.message 均判为系统侧（既有调用零改）', () => {
    expect(isSystemAbortReason(SYSTEM_ABORT_REASON)).toBe(true);
    expect(isSystemAbortReason(new Error(SYSTEM_ABORT_REASON))).toBe(true);
  });

  it('狭义：用户 AbortError / 普通错误 / 其它值**一律不得**判为系统侧（否则 Goal 错落 system_aborted）', () => {
    const userAbort = new DOMException('user stopped', 'AbortError');
    expect(isAbortReason(userAbort)).toBe(true); // 广义：预期中断
    expect(isSystemAbortReason(userAbort)).toBe(false); // 狭义：**不是**系统中止

    expect(isSystemAbortReason(new Error('aborted'))).toBe(false);
    expect(isSystemAbortReason('aborted')).toBe(false);
    expect(isSystemAbortReason('liri:system-abort-extra')).toBe(false);
    expect(isSystemAbortReason(new Error('boom'))).toBe(false);
    expect(isSystemAbortReason(undefined)).toBe(false);
    expect(isSystemAbortReason(null)).toBe(false);
    expect(isSystemAbortReason(42)).toBe(false);
  });

  it('品牌分支（2026-09-25 §6.8）：被包装/跨边界后仍可识别为预期中断', () => {
    // 包装后 name/message 都会变 —— 只有品牌位能穿过包装（CS02：显式标记而非字符串推断）
    const wrapped = markAsExpectedAbort(
      new Error('SomeProvider stream failed: …')
    );
    expect(isAbortReason(wrapped)).toBe(true);

    // 未标记的同文案错误**不得**被误判（收窄口径）
    expect(isAbortReason(new Error('SomeProvider stream failed: …'))).toBe(
      false
    );
  });
});
