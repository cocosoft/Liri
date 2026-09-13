/**
 * Event Loop 滞后分类测试（评审 2026-08-15 优化）
 *
 * 背景：08-10 日志把 158 分钟"滞后"（9482086ms）误报为事件循环阻塞，
 * 实为系统睡眠唤醒——睡眠期间 setTimeout 不触发，唤醒后延迟一次性累积。
 * classifyEventLoopLag 区分三类：睡眠唤醒（>60s，降级 info）/ 真实滞后（2s~60s，warn）/ 正常（≤2s，静默）。
 */

import { describe, test, expect } from 'bun:test';
import {
  classifyEventLoopLag,
  SLEEP_WAKE_LAG_MS,
} from '../infrastructure-diagnostics.js';

describe('classifyEventLoopLag', () => {
  test('正常抖动（≤2000ms）静默', () => {
    expect(classifyEventLoopLag(0)).toEqual({ warn: false, sleepWake: false });
    expect(classifyEventLoopLag(1000)).toEqual({
      warn: false,
      sleepWake: false,
    });
    expect(classifyEventLoopLag(2000)).toEqual({
      warn: false,
      sleepWake: false,
    });
  });

  test('真实滞后（2000ms~60s）保留 warn', () => {
    expect(classifyEventLoopLag(2001)).toEqual({
      warn: true,
      sleepWake: false,
    });
    expect(classifyEventLoopLag(25_556)).toEqual({
      warn: true,
      sleepWake: false,
    });
    expect(classifyEventLoopLag(59_000)).toEqual({
      warn: true,
      sleepWake: false,
    });
  });

  test('疑似睡眠唤醒（>60s）降级为 info，不误报为阻塞', () => {
    expect(classifyEventLoopLag(SLEEP_WAKE_LAG_MS + 1)).toEqual({
      warn: false,
      sleepWake: true,
    });
    // 08-10 实测值：9482086ms（158 分钟）
    expect(classifyEventLoopLag(9_482_086)).toEqual({
      warn: false,
      sleepWake: true,
    });
  });
});
