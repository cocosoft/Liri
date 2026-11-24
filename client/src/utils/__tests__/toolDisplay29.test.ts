/**
 * #29（2026-10-30）：工具块展示口径的纯函数回归。
 *
 * 真机症状：已完成的组仍显示「正在执行命令」/ 组头 ✅ 与文案矛盾 / 标题出现
 * 「任务管理 管理任务」重复 / 计数文案粘成「118 个工具调用107/118(11 失败)」。
 */
import { describe, expect, it } from 'vitest';

import { stripDuplicateToolPrefix } from '../toolHumanSummary';

describe('stripDuplicateToolPrefix（#29 标题去重）', () => {
  it('「任务管理 管理任务」⇒ 只留后半段', () => {
    expect(stripDuplicateToolPrefix('任务管理', '任务管理 管理任务')).toBe(
      '管理任务',
    );
  });

  it('支持冒号 / 破折号分隔', () => {
    expect(stripDuplicateToolPrefix('会话查询', '会话查询：abc')).toBe('abc');
    expect(stripDuplicateToolPrefix('会话查询', '会话查询 — abc')).toBe('abc');
  });

  it('前缀不匹配 / 完全同名 ⇒ 原样或空串（不误伤）', () => {
    expect(stripDuplicateToolPrefix('任务管理', '读取文件 a.ts')).toBe(
      '读取文件 a.ts',
    );
    expect(stripDuplicateToolPrefix('任务管理', '任务管理')).toBe('');
    expect(stripDuplicateToolPrefix('', '任意摘要')).toBe('任意摘要');
  });
});
