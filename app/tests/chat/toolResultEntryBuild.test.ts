/**
 * 工具结果条目构造（P0-3，2026-11-06）
 *
 * 钉住 `buildExecutedToolResultEntry` 的**分类透传**语义：串行 / 并行两条路径共用本构造点。
 * 背景（真机取证 `session_mw4qxg9md9ca793031`）：串行路径旧实现内联构造时漏了 `failureKind`
 * ⇒ 安全门拦截被 `classifyTurn` 判成 `invalid`（烧 `consecutiveInvalidTurns`），
 * 而非 `environment_blocked`（环境阻塞预算）。
 */
import { describe, expect, it } from 'bun:test';
import { buildExecutedToolResultEntry } from '../../src/chat/toolResultPostProcess';
import { classifyTurn } from '@modules/query/ReActLoop';

const tc = { id: 'call_1', name: 'bash' };

describe('buildExecutedToolResultEntry', () => {
  it('保留上游给出的 failureKind（安全门拦截 ⇒ environment_blocked 而非 invalid）', () => {
    const entry = buildExecutedToolResultEntry(tc, {
      error: '安全检查失败: 复合命令被拒绝',
      failureKind: 'safety_blocked',
    });
    expect(entry.status).toBe('error');
    expect(entry.failureKind).toBe('safety_blocked');
    expect(classifyTurn([entry])).toBe('environment_blocked');
  });

  it('未分类的失败兜底为 tool_error（保持既有 invalid 语义）', () => {
    const entry = buildExecutedToolResultEntry(tc, { error: 'boom' });
    expect(entry.failureKind).toBe('tool_error');
    expect(classifyTurn([entry])).toBe('invalid');
  });

  it('成功结果不写分类（避免脏数据），且对象结果序列化为可读文本', () => {
    const entry = buildExecutedToolResultEntry(tc, { result: { ok: 1 } });
    expect(entry.status).toBe('success');
    expect(entry.failureKind).toBeUndefined();
    expect(entry.output).toBe('{"ok":1}');
  });
});
