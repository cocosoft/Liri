// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 13-P0-1（2026-10-05）：验证器**降级路径 fail-closed** 守卫。
 *
 * 背景：《Agentic Design Patterns》21 模式复查（§13）A2 —— `VerifierAgent` 三条降级路径
 * 原实现均为 **fail-open**（`passed:true`）：
 *   ① 未注入 `callModel`　② 验证过程抛异常　③ 响应 JSON 解析失败
 * ⇒ 语义等价于「验证器故障 ⇒ 验收通过」。
 *
 * 本批改为默认 **fail-closed**（`passed:false` + `verdict:'ESCALATE'`），并保留
 * `failClosed:false` / `FEATURE_VERIFIER_FAIL_CLOSED=false` 回退旧行为（灰度）。
 */
import { describe, it, expect } from 'bun:test';
import { VerifierAgent } from '../../src/query/VerifierAgent.js';
import type { VerificationInput } from '../../src/query/VerifierAgent.js';

const INPUT: VerificationInput = {
  messages: [{ role: 'user', content: 'do it' }],
  toolResults: [{ toolName: 'file_write', toolCallId: 't1', result: 'ok' }],
  turnCount: 1,
  sessionId: 's_verifier_failclosed',
};

const signal = new AbortController().signal;

describe('VerifierAgent 降级路径 fail-closed（13-P0-1）', () => {
  it('① 未注入 callModel ⇒ passed:false + ESCALATE（默认 fail-closed）', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    const r = await agent.verify(INPUT, signal);
    expect(r.passed).toBe(false);
    expect(r.verdict).toBe('ESCALATE');
    expect(r.feedback).toContain('fail-closed');
  });

  it('② 验证过程抛异常 ⇒ passed:false + ESCALATE（默认 fail-closed）', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.setCallModel(async function* () {
      throw new Error('boom');
    });
    const r = await agent.verify(INPUT, signal);
    expect(r.passed).toBe(false);
    expect(r.verdict).toBe('ESCALATE');
    expect(r.feedback).toContain('fail-closed');
  });

  it('③ 响应 JSON 不可解析 ⇒ passed:false + ESCALATE（默认 fail-closed）', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.setCallModel(async function* () {
      yield { content: '这不是 JSON' };
    });
    const r = await agent.verify(INPUT, signal);
    expect(r.passed).toBe(false);
    expect(r.verdict).toBe('ESCALATE');
    expect(r.feedback).toContain('fail-closed');
  });

  // ─── 证伪控制组：显式关闭 ⇒ 回退旧 fail-open（灰度路径可用）───

  it('证伪组：failClosed=false ⇒ ① 未注入 callModel 仍降级通过（旧行为）', async () => {
    const agent = new VerifierAgent({ failClosed: false });
    const r = await agent.verify(INPUT, signal);
    expect(r.passed).toBe(true);
    expect(r.verdict).toBe('APPROVE');
  });

  it('证伪组：默认配置（未显式传 failClosed）由 feature flag 决定，且默认 fail-closed', async () => {
    const agent = new VerifierAgent();
    const r = await agent.verify(INPUT, signal);
    // 默认 FEATURE_FLAGS.VERIFIER_FAIL_CLOSED = true（除非环境变量显式关闭）
    expect(r.passed).toBe(false);
    expect(r.verdict).toBe('ESCALATE');
  });

  it('enabled=false（用户显式关闭验证）不受本项影响 ⇒ 仍放行', async () => {
    const agent = new VerifierAgent({ enabled: false, failClosed: true });
    const r = await agent.verify(INPUT, signal);
    expect(r.passed).toBe(true);
    expect(r.verdict).toBe('APPROVE');
  });
});
