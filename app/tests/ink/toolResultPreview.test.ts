/**
 * REPL 工具结果预览（`summarizeToolResult`）
 *
 * 回归的是"工具执行结果在 REPL 里被整体丢弃"的缺陷：结果只经 `tool_call` 完成块
 * （`tool_end`）下发，形状为 `{ success, data }`。本文件锁定"任意载荷 → 单行预览"的规则：
 * 取 `data`、折叠空白、超长截断、序列化失败降级不抛。
 */
import { describe, it, expect } from 'bun:test';

import {
  summarizeToolResult,
  TOOL_RESULT_PREVIEW_MAX,
} from '../../src/ink/repl/toolResultPreview.js';

describe('summarizeToolResult', () => {
  it('空值 ⇒ 空串（不渲染空结果行）', () => {
    expect(summarizeToolResult(undefined)).toBe('');
    expect(summarizeToolResult(null)).toBe('');
  });

  it('字符串原样折叠为单行', () => {
    expect(summarizeToolResult('  line1\n\nline2\t line3  ')).toBe(
      'line1 line2 line3'
    );
  });

  it('后端包装 `{ success, data }` ⇒ 只取 data（不把包装对象打给用户）', () => {
    expect(summarizeToolResult({ success: true, data: 'ok' })).toBe('ok');
    expect(summarizeToolResult({ success: true, data: { a: 1 } })).toBe(
      '{"a":1}'
    );
  });

  it('无 data 字段的对象 ⇒ 整体序列化', () => {
    expect(summarizeToolResult({ count: 2, names: ['a'] })).toBe(
      '{"count":2,"names":["a"]}'
    );
  });

  it('超长结果截断到上限并加省略号（终端宽度有限）', () => {
    const long = 'x'.repeat(TOOL_RESULT_PREVIEW_MAX + 50);
    const preview = summarizeToolResult(long);
    expect(preview.length).toBe(TOOL_RESULT_PREVIEW_MAX);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('循环引用不抛（降级为 String()，不能把渲染层打挂）', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    expect(() => summarizeToolResult(circular)).not.toThrow();
    expect(summarizeToolResult(circular)).toContain('[object Object]');
  });
});
