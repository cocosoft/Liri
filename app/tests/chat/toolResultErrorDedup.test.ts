/**
 * FIX-7（2026-10-27）：工具失败结果**不得重复回显同一句错误**。
 *
 * 真机证据（`session_mvq91mtme1e76c5808` 的 `events.jsonl` 第 16/40 条）：
 * `"result":"⚠️ 工具执行失败: 安全检查失败: 命令被阻止执行 … --- \"安全检查失败: 命令被阻止执行\""`
 * —— `error` 前缀一次、payload（`JSON.stringify(result)`）又一次。模型上下文与导出都被放大成噪音。
 *
 * 口径：
 * - payload 与 error 语义相同（去引号/压空白后相等）⇒ 只保留前缀；
 * - payload 不同（带 stderr / 结构化详情）⇒ 保留全文（`---` 分隔照旧）；
 * - `result` 为 null/undefined ⇒ 不追加 `null` 字样。
 */
import { describe, expect, it } from 'bun:test';

import { MessageServiceImpl } from '../../src/chat/services/MessageService';

const svc = new MessageServiceImpl();

function valueOf(result: unknown, error?: string): string {
  const msg = svc.createToolResultMessage(
    {
      toolCallId: 'tc-1',
      sessionId: 's-1',
      result,
      ...(error !== undefined ? { error } : {}),
    } as never,
    { sessionId: 's-1' }
  );
  return (msg.content[0] as { value: string }).value;
}

describe('工具失败结果去重（FIX-7）', () => {
  const err = '安全检查失败: 命令被阻止执行';

  it('payload 与 error 同句 ⇒ 只出现一次，且不追加分隔线', () => {
    const text = valueOf(err, err);
    expect(text.split(err).length - 1).toBe(1);
    expect(text).not.toContain('---');
    expect(text).toContain('请基于此错误调整后续方案');
  });

  it('payload 是带引号的 JSON 字符串且与 error 相同 ⇒ 同样只出现一次', () => {
    const text = valueOf(JSON.parse(JSON.stringify(err)), err);
    expect(text.split(err).length - 1).toBe(1);
  });

  it('payload 与 error 不同 ⇒ 保留全文（含分隔线）', () => {
    const text = valueOf(`详细输出\n${err}\n[stderr] boom`, err);
    expect(text).toContain('---');
    expect(text).toContain('详细输出');
    expect(text).toContain('[stderr] boom');
  });

  it('result 为 null 且 error 存在 ⇒ 不追加 "null"', () => {
    const text = valueOf(null, err);
    expect(text).not.toContain('null');
    expect(text).toContain(err);
  });

  it('无 error ⇒ 原文不变（零行为变更）', () => {
    const text = valueOf({ ok: true });
    expect(text).toBe(JSON.stringify({ ok: true }));
  });
});
