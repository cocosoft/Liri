/**
 * D5（2026-11-18）：验证器「每会话最新结果」索引单测
 *
 * 覆盖：未记录 ⇒ null、最新覆盖、可选字段缺省、有界 LRU 淘汰、reset 清空。
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import {
  getLatestVerifierResult,
  resetLatestVerifierResults,
} from '@openliri/infra/system/state/verifierLatestResults';
import {
  recordVerifierResult,
  resetVerifierMetrics,
} from '@modules/query/taor/verifierMetrics';

beforeEach(() => {
  resetVerifierMetrics();
  resetLatestVerifierResults();
});

describe('getLatestVerifierResult（infra 只读投影）', () => {
  it('未记录 ⇒ null', () => {
    expect(getLatestVerifierResult('s-none')).toBeNull();
  });

  it('记录后可读，且如实带上 confidence / checkPassRate / turn', () => {
    recordVerifierResult({
      sessionId: 's1',
      turn: 3,
      verdict: 'APPROVE',
      durationMs: 12,
      confidence: 0.8,
      checkPassRate: 1,
    });
    const latest = getLatestVerifierResult('s1');
    expect(latest).not.toBeNull();
    expect(latest?.verdict).toBe('APPROVE');
    expect(latest?.confidence).toBe(0.8);
    expect(latest?.checkPassRate).toBe(1);
    expect(latest?.turn).toBe(3);
  });

  it('同会话多次写入 ⇒ 只保留最新一次（REJECT 同样写入）', () => {
    recordVerifierResult({
      sessionId: 's1',
      turn: 1,
      verdict: 'APPROVE',
      durationMs: 5,
      confidence: 0.9,
    });
    recordVerifierResult({
      sessionId: 's1',
      turn: 2,
      verdict: 'REJECT',
      durationMs: 5,
      confidence: 0.3,
      feedback: '缺少边界检查',
    });
    const latest = getLatestVerifierResult('s1');
    expect(latest?.verdict).toBe('REJECT');
    expect(latest?.turn).toBe(2);
    expect(latest?.confidence).toBe(0.3);
  });

  it('未提供 confidence / checkPassRate ⇒ 字段缺省（不造 0）', () => {
    recordVerifierResult({
      sessionId: 's2',
      turn: 1,
      verdict: 'ESCALATE',
      durationMs: 5,
    });
    const latest = getLatestVerifierResult('s2');
    expect(latest).not.toBeNull();
    expect('confidence' in (latest as object)).toBe(false);
    expect('checkPassRate' in (latest as object)).toBe(false);
  });

  it('有界 LRU：第 201 个会话写入后最早的被淘汰', () => {
    for (let i = 0; i <= 200; i += 1) {
      recordVerifierResult({
        sessionId: `s-${i}`,
        turn: 1,
        verdict: 'APPROVE',
        durationMs: 1,
        confidence: 0.5,
      });
    }
    expect(getLatestVerifierResult('s-0')).toBeNull();
    expect(getLatestVerifierResult('s-200')).not.toBeNull();
  });

  it('reset ⇒ 清空', () => {
    recordVerifierResult({
      sessionId: 's3',
      turn: 1,
      verdict: 'APPROVE',
      durationMs: 1,
      confidence: 0.5,
    });
    resetVerifierMetrics();
    expect(getLatestVerifierResult('s3')).toBeNull();
  });
});
