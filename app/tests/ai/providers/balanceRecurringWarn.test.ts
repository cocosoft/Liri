// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 余额查询「持续性告警只记一次」闸门单测（2026-10-17 收敛噪音）。
//
// 背景：余额查询按周期轮询（真机实测 ~10 分钟一轮），而「接口已下线 / 固定错误码」这类**持续性**失败
// 每轮都会命中 ⇒ 旧实现每轮刷同一条 warning，日志无限增长且无新信息。
// 本组钉住闸门语义：首次记、重复不记、**恢复即清记忆**（状态变化仍能上报）、前缀**不误伤**同名前缀 provider。

import { describe, it, expect, beforeEach } from 'bun:test';

import {
  shouldWarnRecurring,
  clearRecurringWarn,
  resetRecurringWarnForTest,
} from '../../../src/ai/providers/BalanceChecker';

beforeEach(() => {
  resetRecurringWarnForTest();
});

describe('持续性告警闸门：首次记、重复不记', () => {
  it('同一 key ⇒ 首次 true、此后 false（同状态不再刷屏）', () => {
    const key = 'siliconflow|retired';
    expect(shouldWarnRecurring(key)).toBe(true);
    expect(shouldWarnRecurring(key)).toBe(false);
    expect(shouldWarnRecurring(key)).toBe(false);
  });

  it('不同 provider / 不同 kind ⇒ 各自首次都会记一次（互不吞掉）', () => {
    expect(shouldWarnRecurring('siliconflow|retired')).toBe(true);
    expect(shouldWarnRecurring('siliconflow-en|retired')).toBe(true);
    expect(shouldWarnRecurring('siliconflow|api-error:20092')).toBe(true);
  });
});

describe('恢复即清记忆（不把「曾经坏过」永久静音）', () => {
  it('clear 之后同 key ⇒ **再次** true（状态变化仍可上报）', () => {
    const key = 'siliconflow|retired';
    expect(shouldWarnRecurring(key)).toBe(true);
    expect(shouldWarnRecurring(key)).toBe(false);
    clearRecurringWarn('siliconflow');
    expect(shouldWarnRecurring(key)).toBe(true); // ★
  });

  it('clear 一整个 provider ⇒ 它的**多个** kind 都被清掉', () => {
    shouldWarnRecurring('siliconflow|retired');
    shouldWarnRecurring('siliconflow|api-error:101');
    clearRecurringWarn('siliconflow');
    expect(shouldWarnRecurring('siliconflow|retired')).toBe(true);
    expect(shouldWarnRecurring('siliconflow|api-error:101')).toBe(true);
  });

  it('按 `provider|` 前缀清 ⇒ **不误伤**同名前缀的另一个 provider（`siliconflow` vs `siliconflow-en`）', () => {
    expect(shouldWarnRecurring('siliconflow-en|retired')).toBe(true);
    clearRecurringWarn('siliconflow');
    expect(shouldWarnRecurring('siliconflow-en|retired')).toBe(false); // 仍是「已记过」
  });
});
