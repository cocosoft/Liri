/**
 * 通道降级链**声明驱动**（通道治理 阶段 1.2，2026-10-12）。
 *
 * 目标：`DeliveryRouter` 的降级链不再"先发一次、失败再降级"，而是按通道**声明**的支持位
 * （`plugin.capabilities.interactive` / `plugin.meta.markdownCapable`）**直接跳过**不支持的格式。
 *
 * 本用例覆盖纯函数 `resolveDeliveryFallbacks()`（语义核心；`DeliveryRouter` 仅用它取"下一级"）。
 * 缺省（`{interactive:true, markdown:false}` 除外）必须与既有逐级链**等价**，防回归。
 */
import { describe, expect, it } from 'bun:test';
import {
  DELIVERY_FORMAT_CHAIN,
  resolveDeliveryFallbacks,
  type DeliveryFormatSupport,
} from '../../src/channels/deliveryFormatters.js';

const ALL: DeliveryFormatSupport = { interactive: true, markdown: true };

describe('通道降级链（阶段 1.2 · 声明驱动）', () => {
  it('降级链顺序不变：interactive → markdown → text', () => {
    expect([...DELIVERY_FORMAT_CHAIN]).toEqual([
      'interactive',
      'markdown',
      'text',
    ]);
  });

  it('全支持（缺省语义）⇒ 与既有逐级链等价', () => {
    expect(resolveDeliveryFallbacks('interactive', ALL)).toEqual([
      'markdown',
      'text',
    ]);
    expect(resolveDeliveryFallbacks('markdown', ALL)).toEqual(['text']);
    expect(resolveDeliveryFallbacks('text', ALL)).toEqual([]);
  });

  it('声明不支持 markdown ⇒ 从 interactive 直接跳到 text（少一次注定失败的往返）', () => {
    expect(
      resolveDeliveryFallbacks('interactive', {
        interactive: true,
        markdown: false,
      })
    ).toEqual(['text']);
  });

  it('声明不支持 interactive ⇒ 从其下一级起仍按支持位过滤', () => {
    // interactive 只作为"起点"语义；不支持即不会出现在候选里，但 markdown→text 仍受声明约束
    expect(
      resolveDeliveryFallbacks('interactive', {
        interactive: false,
        markdown: false,
      })
    ).toEqual(['text']);
    expect(
      resolveDeliveryFallbacks('markdown', {
        interactive: false,
        markdown: true,
      })
    ).toEqual(['text']);
  });

  it('未知格式（如 none）⇒ 空序列（不臆造下一级）', () => {
    expect(resolveDeliveryFallbacks('none' as never, ALL)).toEqual([]);
  });

  it('text 恒为兜底：任何声明下 text 都在链尾（若其处于更低一级）', () => {
    const withAllOff: DeliveryFormatSupport = {
      interactive: false,
      markdown: false,
    };
    expect(resolveDeliveryFallbacks('interactive', withAllOff)).toEqual([
      'text',
    ]);
  });
});
