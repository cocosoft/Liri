// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-5（2026-10-23）：工具结果**结构化清单**回归锁。
 *
 * 背景（方案 §3.10）：审查门只拿拼接文本，无法区分"模型没做"与"系统不让做"；
 * 且证据窗口只取最后 12 条 × 800 字 ⇒ 早期关键失败被丢。
 *
 * 锁四条：
 *   ① `success=false` / 抛错 / 安全拦截 / 待审批 各自被如实归类（不冒充成功）；
 *   ② 关键证据行**不参与** 12×800 窗口截断；
 *   ③ 待审批**不计入** failed（它是"未执行"，不是失败）；
 *   ④ 给 LLM 的清单文本明确写出"pendingApproval = 未执行"。
 */

import { describe, it, expect } from 'bun:test';
import {
  buildCriticalOutcomeEvidence,
  buildTaorStepResult,
  formatToolOutcomeSummary,
  summarizeToolOutcomes,
} from '../../src/tasks/lro/stepHelpers.js';

describe('PR-5：summarizeToolOutcomes', () => {
  it('成功 / 结果级失败 / 抛错 / 拦截 / 待审批 分类', () => {
    const summary = summarizeToolOutcomes([
      { toolCallId: 'a', toolName: 'file_read', result: { success: true } },
      {
        toolCallId: 'b',
        toolName: 'file_write',
        result: { success: false, error: '缺少必填参数 file_path' },
      },
      { toolCallId: 'c', toolName: 'bash', error: 'spawn failed' },
      {
        toolCallId: 'd',
        toolName: 'bash',
        result: {
          requireApproval: true,
          approvalReason: 'AST 分析不确定',
          metadata: { securityIntercepted: true },
        },
      },
      {
        toolCallId: 'e',
        toolName: 'media_delete',
        result: { requireApproval: true },
      },
    ]);

    expect(summary.total).toBe(5);
    expect(summary.successCount).toBe(1);
    // 失败 = 结果级失败 + 抛错（不含待审批）
    expect(summary.failedCount).toBe(2);
    expect(summary.securityIntercepted).toBe(1);
    expect(summary.pendingApproval).toBe(2);

    const write = summary.outcomes[1];
    expect(write.success).toBe(false);
    expect(write.error).toContain('file_path');

    const pending = summary.outcomes[3];
    expect(pending.pendingApproval).toBe(true);
    expect(pending.success).toBe(false);
    expect(pending.approvalReason).toContain('AST');
  });

  it('status=requires_approval（字符串状态）同样识别为待审批', () => {
    const summary = summarizeToolOutcomes([
      { toolName: 'bash', result: { status: 'requires_approval' } },
    ]);
    expect(summary.pendingApproval).toBe(1);
  });
});

describe('PR-5：关键证据不参与截断', () => {
  it('失败行前置进 stepResult，且超出 12 条窗口仍保留', () => {
    const summary = summarizeToolOutcomes([
      {
        toolName: 'file_write',
        result: { success: false, error: '缺少必填参数 file_path' },
      },
    ]);
    const critical = buildCriticalOutcomeEvidence(summary);
    expect(critical[0]).toContain('[CRITICAL][file_write]');
    expect(critical[0]).toContain('执行失败');

    // 15 条消息（超过 12 条窗口），关键证据仍必须在
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: 'assistant',
      content: `msg-${i}`,
    }));
    const text = buildTaorStepResult(
      messages,
      { turns: 3, tokens: 100, elapsedMs: 5 },
      critical
    );
    expect(text).toContain('[CRITICAL][file_write]');
    // 窗口只保留最后 12 条 ⇒ 最早的 msg-0..msg-2 不在
    expect(text).not.toContain('[assistant] msg-0');
    expect(text).toContain('[assistant] msg-14');
  });

  it('全部成功 ⇒ 无关键行', () => {
    const summary = summarizeToolOutcomes([
      { toolName: 'file_read', result: { success: true } },
    ]);
    expect(buildCriticalOutcomeEvidence(summary)).toEqual([]);
  });
});

describe('PR-5：给审查员的结构化清单', () => {
  it('写明 pendingApproval = 未执行（禁止据此判"模型未产出"）', () => {
    const summary = summarizeToolOutcomes([
      { toolName: 'bash', result: { requireApproval: true } },
      { toolName: 'file_write', result: { success: false, error: 'boom' } },
    ]);
    const text = formatToolOutcomeSummary(summary);
    expect(text).toContain('pendingApproval=1');
    expect(text).toContain('未执行');
    expect(text).toContain('[bash] PENDING_APPROVAL');
    expect(text).toContain('[file_write] 执行失败：boom');
  });

  it('无工具调用 ⇒ 空串（不造假清单）', () => {
    expect(formatToolOutcomeSummary(summarizeToolOutcomes([]))).toBe('');
  });
});
