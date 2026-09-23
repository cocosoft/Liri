// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// D5 回归测试（2026-09-17）：
//   LOOP_OBSERVE_ONLY 灰度旁路——观测模式下 critical 级阻断降级为仅记录（不阻断）。
//   场景①：no_tool_call 达 critical 走 detectNoToolCallLoop 内旁路（L414）
//   场景②：generic_repeat 达 critical 经 resolveObserve 旁路（L451）
//
// 注入说明：不设置全局 process.env.LOOP_OBSERVE_ONLY——loop-config 的 isLoopObserveOnly
// 有模块级粘滞缓存，且 bun 在 Windows 上测试文件共享进程，全局 env 会因执行顺序漂移
// 导致缓存被其他文件先粘滞。改用构造参数 observeOnly 注入（LoopDetector 实例级判定，
// 优先于全局开关，未注入时回退原逻辑，行为零变化）。

import { describe, expect, it } from 'bun:test';
// 必须先求值 @modules/config 依赖链：loop-config import configManager →
// config 链（plugins→PluginManager→CircuitBreaker）反向 import loop-config 时若其仍在
// 求值中（TDZ）会崩溃（V-50 预存问题）。先 import '@modules/config' 使 loop-config
// 以"config 链下游"身份完整求值，后续 LoopDetector 引用即命中缓存。
// TODO: CS05-ROOTFIX — 根因是 loop-config 与 @modules/config 循环依赖，收敛后移除
import '@modules/config';
import { createLoopDetector } from '../../src/query/LoopDetector.js';

describe('D5: LOOP_OBSERVE_ONLY 旁路 critical 阻断', () => {
  it('no_tool_call 达 critical（≥15 轮）时观测模式返回 {stuck:false}', () => {
    const detector = createLoopDetector({ observeOnly: true });
    for (let i = 0; i < 20; i++) detector.recordTurn(false);
    expect(detector.detectNoToolCallLoop()).toEqual({ stuck: false });
  });

  it('generic_repeat 达 critical 时经 resolveObserve 返回 {stuck:false}', () => {
    // 默认 critical=20 > 滑动窗口 15，generic_repeat 到不了 critical——
    // 用构造参数把阈值压低，使场景可触达
    const detector = createLoopDetector({
      criticalThreshold: 5,
      warningThreshold: 3,
      observeOnly: true,
    });
    for (let i = 0; i < 25; i++) detector.recordToolCall('tool', { a: 1 });
    expect(detector.detect('tool', { a: 1 })).toEqual({ stuck: false });
  });

  it('非观测模式（observeOnly:false）critical 仍阻断——旁路仅在观测模式生效', () => {
    const detector = createLoopDetector({ observeOnly: false });
    for (let i = 0; i < 20; i++) detector.recordTurn(false);
    const result = detector.detectNoToolCallLoop();
    expect(result.stuck).toBe(true);
    expect(result).toMatchObject({
      level: 'critical',
      detector: 'no_tool_call',
    });
  });
});
