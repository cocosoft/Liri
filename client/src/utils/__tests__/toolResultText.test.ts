/**
 * #28（2026-10-30）：历史 assistant 正文"整包工具结果 JSON"的渲染侧折叠。
 *
 * 真机 `session_mvoqs1ho875ea6b95e`：144 条 assistant 气泡正文以 `{"data":` 开头。
 * 写入侧已修，这里兜住**已落盘的历史数据**：折叠成一句可读摘要，绝不原样铺开。
 */
import { describe, expect, it } from 'vitest';

import {
  isInternalNudgeMessage,
  summarizeSerializedToolResult,
} from '../toolResultText';

describe('summarizeSerializedToolResult（#28）', () => {
  it('失败结果 ⇒ 一句可读失败原因', () => {
    expect(
      summarizeSerializedToolResult(
        '{"data":"写入目录不存在","success":false,"error":"写入目录不存在: E:\\\\01_work\\\\_out","newMessages":[]}'
      )
    ).toBe('⚠️ 工具执行失败：写入目录不存在: E:\\01_work\\_out');
  });

  it('成功 + output ⇒ 工具返回摘要（超长截断）', () => {
    const long = 'x'.repeat(260);
    const text = summarizeSerializedToolResult(
      JSON.stringify({ data: [], success: true, output: long })
    );
    expect(text).toContain('工具返回：');
    expect(text?.endsWith('…')).toBe(true);
  });

  it('成功 + 结构化 data ⇒ 折叠提示（不铺开 JSON）', () => {
    expect(
      summarizeSerializedToolResult(JSON.stringify({ data: [], success: true }))
    ).toBe('工具返回了结构化结果（已折叠）');
  });

  it('非工具结果 JSON / 普通正文 ⇒ null（原样渲染）', () => {
    expect(summarizeSerializedToolResult('{"a":1}')).toBeNull();
    expect(summarizeSerializedToolResult('已完成 3/10 步')).toBeNull();
    expect(summarizeSerializedToolResult('[{"success":true}]')).toBeNull();
    expect(summarizeSerializedToolResult('{"data":')).toBeNull();
  });
});

describe('isInternalNudgeMessage（#30 内部诊断不进用户消息流）', () => {
  it('模型侧工具错误提醒 ⇒ true（含前导空白）', () => {
    expect(
      isInternalNudgeMessage(
        '[系统提示] 上一轮工具调用返回了错误或空结果。不要直接结束对话…',
      ),
    ).toBe(true);
    expect(isInternalNudgeMessage('  [系统提示] 改道继续')).toBe(true);
  });

  it('用户正常输入 / 其他文案 ⇒ false（不误伤）', () => {
    expect(isInternalNudgeMessage('请分析这个项目的入口')).toBe(false);
    expect(isInternalNudgeMessage('系统提示：见文档')).toBe(false);
    expect(isInternalNudgeMessage('')).toBe(false);
  });
});
