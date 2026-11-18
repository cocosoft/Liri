/**
 * #2 proactive Shadow（2026-11-18）：只记录不投递。
 *
 * 覆盖：记录字段/截断、JSONL 落盘、开关只认显式 true（默认关）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isProactiveShadowEnabled,
  recordProactiveShadow,
  toProactiveShadowRecord,
} from '../../../packages/proactive/src/proactive/ProactiveShadowLedger';
import type { ProactiveMessagePayload } from '../../../packages/proactive/src/proactive/types';

const ENV_KEY = 'PROACTIVE_SHADOW';
const envBefore = process.env[ENV_KEY];

afterAll(() => {
  if (envBefore === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envBefore;
});

const payload: ProactiveMessagePayload = {
  id: 'p1',
  kind: 'risk_alert',
  priority: 'high',
  dedupeKey: 'risk:1',
  title: 't'.repeat(300),
  body: 'b'.repeat(800),
  createdAt: 1,
  expiresAt: 2,
  source: { type: 'alwayson', ref: 'job-1' },
  ticketId: 'ticket-1',
  target: { mode: 'channel', channelId: 'c1' },
};

describe('toProactiveShadowRecord', () => {
  it('字段扁平且 title≤200 / body≤500，保留 source/ticket/targetMode', () => {
    const r = toProactiveShadowRecord(payload, 123);
    expect(r.at).toBe(123);
    expect(r.kind).toBe('risk_alert');
    expect(r.priority).toBe('high');
    expect(r.dedupeKey).toBe('risk:1');
    expect(r.source).toEqual({ type: 'alwayson', ref: 'job-1' });
    expect(r.ticketId).toBe('ticket-1');
    expect(r.targetMode).toBe('channel');
    expect(r.title.length).toBe(200);
    expect(r.bodyPreview.length).toBe(500);
  });

  it('可选字段缺省 ⇒ 不写键', () => {
    const r = toProactiveShadowRecord({
      ...payload,
      source: undefined,
      ticketId: undefined,
      target: undefined,
    });
    expect('source' in r).toBe(false);
    expect('ticketId' in r).toBe(false);
    expect('targetMode' in r).toBe(false);
  });
});

describe('recordProactiveShadow', () => {
  it('追加 JSONL（每行一条，可解析）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proactive-shadow-'));
    const file = join(dir, 'shadow.jsonl');
    try {
      await recordProactiveShadow(payload, { file, now: 1 });
      await recordProactiveShadow(
        { ...payload, id: 'p2', dedupeKey: 'risk:2' },
        { file, now: 2 }
      );
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).dedupeKey).toBe('risk:1');
      expect(JSON.parse(lines[1]!).at).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isProactiveShadowEnabled', () => {
  it('缺省 / 非 true ⇒ 关；显式 true（大小写不敏感）⇒ 开', () => {
    delete process.env[ENV_KEY];
    expect(isProactiveShadowEnabled()).toBe(false);
    process.env[ENV_KEY] = '1';
    expect(isProactiveShadowEnabled()).toBe(false);
    process.env[ENV_KEY] = 'TRUE';
    expect(isProactiveShadowEnabled()).toBe(true);
    process.env[ENV_KEY] = ' true ';
    expect(isProactiveShadowEnabled()).toBe(true);
  });
});
