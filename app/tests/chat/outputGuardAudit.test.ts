// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 输出护栏**改写审计**（P26-2 **P4**，2026-10-07）
 *
 * Spec：`.trae/specs/guardrails-dual-side.md` §9.2④-3（"护栏前原文无独立留痕"）+ §10。
 *
 * 锁四件事：
 *   ① **默认只记元数据**：载荷**不含** `originalText`（用户裁定：不把刚打码的内容写回磁盘）；
 *   ② **开关放行原文**：`FEATURE_OUTPUT_GUARD_KEEP_ORIGINAL=true` 时才附 `originalText`；
 *   ③ **元数据正确**：动作结构化判定（阻断优先）/ 护栏名去重 / 原文长度 / **原文 SHA-256**（已知向量校验）；
 *   ④ **未命中不落事件**；落盘失败 ⇒ 返回 `false` 且**不静默**（CS03-002）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  buildOutputGuardAuditPayload,
  type FinalOutputGuardResult,
} from '../../src/chat/finalOutputGuard.js';
import { appendOutputGuardAudit } from '../../src/chat/outputGuards/liveEvents.js';

const ENV_KEEP = 'FEATURE_OUTPUT_GUARD_KEEP_ORIGINAL';

/** sha256("abc") 已知向量 —— 用于证明哈希口径（不是自证） */
const SHA256_ABC =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function result(
  over: Partial<FinalOutputGuardResult> = {}
): FinalOutputGuardResult {
  return {
    text: '已打码',
    originalText: 'abc',
    repaired: false,
    issues: [],
    guardIssues: [],
    blocked: false,
    redacted: false,
    ...over,
  };
}

afterEach(() => {
  delete process.env[ENV_KEEP];
});

describe('P4 载荷（buildOutputGuardAuditPayload）', () => {
  it('① 默认（keepOriginal=false）⇒ **不含** `originalText` 键', () => {
    const p = buildOutputGuardAuditPayload(
      result({ redacted: true }),
      'm1',
      false
    );
    expect(p).not.toBeNull();
    expect('originalText' in (p as object)).toBe(false);
    expect(p?.originalLength).toBe(3);
    expect(p?.originalSha256).toBe(SHA256_ABC);
    expect(p?.action).toBe('redacted');
    expect(p?.messageId).toBe('m1');
  });

  it('② keepOriginal=true ⇒ 附原文（可完全重建）', () => {
    const p = buildOutputGuardAuditPayload(
      result({ redacted: true }),
      'm1',
      true
    );
    expect(p?.originalText).toBe('abc');
  });

  it('③ 未命中（既未阻断也未打码）⇒ `null`（不落事件）', () => {
    expect(buildOutputGuardAuditPayload(result(), 'm1', false)).toBeNull();
  });

  it('③ 阻断优先于打码；护栏名**去重**', () => {
    const p = buildOutputGuardAuditPayload(
      result({
        blocked: true,
        redacted: true,
        guardIssues: [
          { guard: 'sensitive_content' },
          { guard: 'sensitive_content' },
          { guard: 'injection_echo' },
        ] as FinalOutputGuardResult['guardIssues'],
      }),
      'm1',
      false
    );
    expect(p?.action).toBe('blocked');
    expect(p?.guards).toEqual(['sensitive_content', 'injection_echo']);
  });
});

describe('P4 落盘（appendOutputGuardAudit）', () => {
  it('④ 未命中 ⇒ 不调用落盘口且返回 false', async () => {
    let called = 0;
    const ok = await appendOutputGuardAudit(
      async () => {
        called++;
        return { ok: true };
      },
      's1',
      'm1',
      result()
    );
    expect(ok).toBe(false);
    expect(called).toBe(0);
  });

  it('④ 命中 + 落盘成功 ⇒ true；**默认**载荷不含原文（开关未开）', async () => {
    const sent: unknown[] = [];
    const ok = await appendOutputGuardAudit(
      async (event) => {
        sent.push(event);
        return { ok: true };
      },
      's1',
      'm1',
      result({ redacted: true })
    );
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    const ev = sent[0] as {
      type: string;
      data: Record<string, unknown>;
    };
    expect(ev.type).toBe('validation/output_guard_applied');
    expect('originalText' in ev.data).toBe(false);
  });

  it('② 开关开启（`FEATURE_OUTPUT_GUARD_KEEP_ORIGINAL=true`）⇒ 载荷含原文', async () => {
    process.env[ENV_KEEP] = 'true';
    const sent: Array<{ data: Record<string, unknown> }> = [];
    await appendOutputGuardAudit(
      async (event) => {
        sent.push(event as { data: Record<string, unknown> });
        return { ok: true };
      },
      's1',
      'm1',
      result({ redacted: true })
    );
    expect(sent[0]?.data.originalText).toBe('abc');
  });

  it('④ 落盘失败 ⇒ 返回 false（失败路径不静默吞掉）', async () => {
    const ok = await appendOutputGuardAudit(
      async () => ({ ok: false, reason: 'disk_full' }),
      's1',
      'm1',
      result({ blocked: true })
    );
    expect(ok).toBe(false);
  });
});
