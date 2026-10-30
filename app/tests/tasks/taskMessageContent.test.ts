/**
 * #28（2026-10-30）：任务消息回写的写入侧治理。
 *
 * 真机（`session_mvoqs1ho875ea6b95e`）：405 条 assistant 里 144 条正文是整包工具结果
 * `{"data":…,"success":false,"error":…}` —— `stepExecution` 对非字符串 content 直接
 * `JSON.stringify(...)`，`PdcaLauncher.onTaskMessage` 又把所有 role 都当成 assistant 落盘。
 *
 * 本用例钉住两个纯函数：
 *  - `toReadableTaskContent`：对象只取可读字段，取不到返回空串（调用方据此丢弃）；
 *  - `looksLikeSerializedJson`：整包 JSON 兜底识别（不误伤普通叙述）。
 */
import { describe, expect, it } from 'bun:test';

import { toReadableTaskContent } from '../../src/tasks/lro/stepExecution';
import { looksLikeSerializedJson } from '../../src/chat/launchers/PdcaLauncher';

describe('toReadableTaskContent（#28 写入侧：禁止 JSON.stringify 工具结果）', () => {
  it('字符串原样返回（截断由调用方做）', () => {
    expect(toReadableTaskContent('正在分析入口文件')).toBe('正在分析入口文件');
  });

  it('失败结果取 error 字段（不再整包 JSON）', () => {
    expect(
      toReadableTaskContent({
        data: '写入目录不存在',
        success: false,
        error: '写入目录不存在: E:\\x',
        newMessages: [{ role: 'system', content: '路径不可访问' }],
      })
    ).toBe('写入目录不存在: E:\\x');
  });

  it('成功结果优先 output / content / data（字符串）', () => {
    expect(
      toReadableTaskContent({ data: [], success: true, output: '(空)' })
    ).toBe('(空)');
    expect(toReadableTaskContent({ success: true, content: 'done' })).toBe(
      'done'
    );
    expect(toReadableTaskContent({ success: true, data: 'ok' })).toBe('ok');
  });

  it('无可读字段 ⇒ 空串（调用方丢弃，不得回退 JSON.stringify）', () => {
    expect(toReadableTaskContent({ data: [], success: true })).toBe('');
    expect(toReadableTaskContent(null)).toBe('');
    expect(toReadableTaskContent(42)).toBe('');
  });
});

describe('looksLikeSerializedJson（#28 兜底识别）', () => {
  it('整包工具结果 JSON ⇒ true', () => {
    expect(
      looksLikeSerializedJson('{"data":[],"success":true,"output":"(空)"}')
    ).toBe(true);
  });

  it('普通叙述 / 代码块 / 数组 ⇒ false（不误伤）', () => {
    expect(looksLikeSerializedJson('已完成 3/10 步（进度 30%）')).toBe(false);
    expect(looksLikeSerializedJson('{"data":')).toBe(false);
    expect(looksLikeSerializedJson('[1,2,3]')).toBe(false);
    expect(looksLikeSerializedJson('')).toBe(false);
  });
});
