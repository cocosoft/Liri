/**
 * #1 IngestFunnel（2026-11-18）：S1 影子优先的通道入站噪音漏斗。
 *
 * 覆盖：结构化规则判定（空规则 pass）、shadow 台账（senderId 只落哈希）、开关默认关。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evaluateIngestFunnel,
  isIngestFunnelEnabled,
  isIngestFunnelShadowEnabled,
  recordIngestFunnelShadow,
} from '../../../packages/channels/src/channels/routing/ingestFunnel';

const ENV_SHADOW = 'INGEST_FUNNEL_SHADOW';
const ENV_REAL = 'INGEST_FUNNEL';
const before = {
  shadow: process.env[ENV_SHADOW],
  real: process.env[ENV_REAL],
};

afterAll(() => {
  for (const [key, value] of [
    [ENV_SHADOW, before.shadow],
    [ENV_REAL, before.real],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const input = {
  channelId: 'dingtalk',
  conversationId: 'conv-1',
  senderId: 'user-1',
  eventType: 'bot.message',
};

describe('evaluateIngestFunnel（纯函数）', () => {
  it('空规则 ⇒ 一律 pass（S1 默认形态）', () => {
    expect(evaluateIngestFunnel(input, {})).toEqual({ action: 'pass' });
  });

  it('黑名单优先于白名单', () => {
    expect(
      evaluateIngestFunnel(input, {
        senderBlocklist: ['user-1'],
        senderAllowlist: ['user-1'],
      })
    ).toEqual({ action: 'drop', reason: 'sender_blocked' });
  });

  it('会话白名单非空 ⇒ 名单外过滤；缺失 conversationId 也过滤', () => {
    expect(
      evaluateIngestFunnel(input, { conversationAllowlist: ['conv-2'] })
    ).toEqual({ action: 'drop', reason: 'conversation_not_allowed' });
    expect(
      evaluateIngestFunnel(
        { channelId: 'dingtalk', senderId: 'user-1' },
        { conversationAllowlist: ['conv-1'] }
      )
    ).toEqual({ action: 'drop', reason: 'conversation_not_allowed' });
  });

  it('发送者白名单非空 ⇒ 名单外过滤；名单内 pass', () => {
    expect(
      evaluateIngestFunnel(input, { senderAllowlist: ['user-2'] })
    ).toEqual({ action: 'drop', reason: 'sender_not_allowed' });
    expect(
      evaluateIngestFunnel(input, { senderAllowlist: ['user-1'] })
    ).toEqual({ action: 'pass' });
  });

  it('事件类型白名单仅在该消息带 eventType 时生效', () => {
    expect(
      evaluateIngestFunnel(input, { eventTypeAllowlist: ['ci.failed'] })
    ).toEqual({ action: 'drop', reason: 'event_type_not_allowed' });
    expect(
      evaluateIngestFunnel(
        { ...input, eventType: undefined },
        { eventTypeAllowlist: ['ci.failed'] }
      )
    ).toEqual({ action: 'pass' });
  });
});

describe('recordIngestFunnelShadow', () => {
  it('drop 记录：JSONL 落盘；senderId 只落 8 位哈希（不写原值）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingest-funnel-'));
    const file = join(dir, 'shadow.jsonl');
    try {
      await recordIngestFunnelShadow(
        { ...input, decision: 'drop', reason: 'sender_not_allowed' },
        { file, now: 42 }
      );
      const line = readFileSync(file, 'utf8').trim();
      const rec = JSON.parse(line);
      expect(rec.at).toBe(42);
      expect(rec.channelId).toBe('dingtalk');
      expect(rec.decision).toBe('drop');
      expect(rec.reason).toBe('sender_not_allowed');
      expect(rec.senderIdHash).toHaveLength(8);
      expect(rec.senderIdHash).not.toBe(input.senderId);
      expect(line.includes(input.senderId)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pass 也记账（S1 观测口径：空规则下也有样本可统计）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingest-funnel-'));
    const file = join(dir, 'shadow.jsonl');
    try {
      await recordIngestFunnelShadow(
        { ...input, decision: 'pass' },
        { file, now: 1 }
      );
      await recordIngestFunnelShadow(
        { ...input, decision: 'pass' },
        { file, now: 2 }
      );
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      const rec = JSON.parse(lines[0]);
      expect(rec.decision).toBe('pass');
      expect(rec.reason).toBeNull();
      // 供 conversationAllowlist 反推：会话 id 原样保留
      expect(rec.conversationId).toBe('conv-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('开关默认关', () => {
  it('缺省 ⇒ 两开关均关；显式 true（大小写不敏感）⇒ 开', () => {
    delete process.env[ENV_SHADOW];
    delete process.env[ENV_REAL];
    expect(isIngestFunnelShadowEnabled()).toBe(false);
    expect(isIngestFunnelEnabled()).toBe(false);

    process.env[ENV_SHADOW] = 'TRUE';
    process.env[ENV_REAL] = ' true ';
    expect(isIngestFunnelShadowEnabled()).toBe(true);
    expect(isIngestFunnelEnabled()).toBe(true);
  });
});
