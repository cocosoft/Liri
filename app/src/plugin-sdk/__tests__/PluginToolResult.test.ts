/**
 * 插件工具失败契约测试（2026-09-13）
 *
 * 覆盖 SDK 公开 API 的新增项：`PluginToolResult`（类型）与
 * `normalizePluginToolResult`（纯函数）。契约详见 plugin-sdk/types.ts。
 */

import { describe, test, expect } from 'bun:test';
import { normalizePluginToolResult } from '../core';

describe('normalizePluginToolResult：显式失败契约', () => {
  test('显式失败（success:false + error）原样保留失败与原因', () => {
    expect(
      normalizePluginToolResult({ success: false, error: 'boom' })
    ).toEqual({ success: false, error: 'boom' });
  });

  test('显式失败但缺 error 时补默认文案（不静默丢失败）', () => {
    expect(normalizePluginToolResult({ success: false })).toEqual({
      success: false,
      error: 'Plugin tool execution failed',
    });
  });

  test('显式失败但 error 为空串时补默认文案', () => {
    expect(normalizePluginToolResult({ success: false, error: '' })).toEqual({
      success: false,
      error: 'Plugin tool execution failed',
    });
  });

  test('显式成功（success:true + data）载荷取 data', () => {
    expect(
      normalizePluginToolResult({ success: true, data: { a: 1 } })
    ).toEqual({ success: true, data: { a: 1 } });
  });

  test('显式成功且无 data 时载荷为 undefined', () => {
    expect(normalizePluginToolResult({ success: true })).toEqual({
      success: true,
      data: undefined,
    });
  });
});

describe('normalizePluginToolResult：原始载荷兼容（Python RPC / 历史插件）', () => {
  test('未声明 success 的对象视为成功，载荷取原值', () => {
    expect(normalizePluginToolResult({ hello: 'world' })).toEqual({
      success: true,
      data: { hello: 'world' },
    });
  });

  test('非对象原始值视为成功，载荷取原值', () => {
    expect(normalizePluginToolResult('dup')).toEqual({
      success: true,
      data: 'dup',
    });
  });

  test('null / undefined 视为成功（不误判为失败）', () => {
    expect(normalizePluginToolResult(null)).toEqual({
      success: true,
      data: null,
    });
    expect(normalizePluginToolResult(undefined)).toEqual({
      success: true,
      data: undefined,
    });
  });

  test('success 为非布尔值时不触发失败分支', () => {
    expect(normalizePluginToolResult({ success: 'false' })).toEqual({
      success: true,
      data: { success: 'false' },
    });
  });
});
