/**
 * 状态机**转移审计覆盖**门禁（治理方案 P2-1 / R09-013，2026-11-24）。
 *
 * 判据（`persistence !== 'none'` 的机器必须二选一，不得留空）：
 * ① `audit.mode = 'session-event'`：事件名必须真实存在于 `LIRI_EVENT_NAMES`（单一事实源），
 *    且给出 `evidence`（`文件#符号`）—— 文件存在、符号在该文件中出现（防陈旧/编造锚点）；
 * ② `audit.mode = 'exempt'`：必须写明**非空理由**（无会话维度 / 已有本地审计 / 无真实写点）。
 *
 * 防空跑（AR-3）：断言"至少 12 台有声明"且"至少 3 台走通用 `state/transition`"，
 * 避免筛选条件失效后全绿。
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_MACHINES } from '@openliri/infra/state/engine/stateMachineCatalog';
import { emitStateTransitionAudit } from '@openliri/infra/state/engine/stateTransitionAudit';
import { setStateTransitionEventAppender } from '@openliri/service/session/stateTransitionEvents';
import type { LiriEvent } from '@openliri/service/session/types/events';
import { LIRI_EVENT_NAMES } from '../../../shared/events/eventNames';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const EVENT_NAMES = new Set<string>(LIRI_EVENT_NAMES);

/** 持久化机器（`persistence !== 'none'`）—— 与目录口径一致 */
const AUDITABLE = STATE_MACHINES.filter((m) => m.persistence !== 'none');

describe('状态机转移审计覆盖（R09-013）', () => {
  it('每台持久化机器都声明了 audit（session-event / exempt）', () => {
    const missing = AUDITABLE.filter((m) => !m.audit).map((m) => m.id);
    expect(missing).toEqual([]);
    // 防空跑：目录里确实有一批需要审计的机器
    expect(AUDITABLE.length).toBeGreaterThanOrEqual(12);
  });

  it('session-event：事件名在 LIRI_EVENT_NAMES 中，evidence 指向真实发射点', () => {
    const declared = AUDITABLE.filter((m) => m.audit?.mode === 'session-event');
    // 防空跑：至少 3 台走通用 state/transition 审计
    expect(
      declared.filter(
        (m) =>
          m.audit?.mode === 'session-event' &&
          m.audit.event === 'state/transition'
      ).length
    ).toBeGreaterThanOrEqual(3);

    for (const m of declared) {
      const audit = m.audit;
      if (audit?.mode !== 'session-event') continue;
      expect(EVENT_NAMES.has(audit.event)).toBe(true);
      expect((audit.evidence ?? '').trim().length).toBeGreaterThan(0);
      const [file, symbol] = (audit.evidence ?? '').split('#');
      expect(file?.length).toBeGreaterThan(0);
      expect(symbol?.length).toBeGreaterThan(0);
      const abs = join(REPO_ROOT, file as string);
      expect(existsSync(abs)).toBe(true);
      expect(readFileSync(abs, 'utf8')).toContain(symbol as string);
    }
  });

  it('exempt：理由非空（不得以"以后再说"式空话豁免）', () => {
    const exempt = AUDITABLE.filter((m) => m.audit?.mode === 'exempt');
    expect(exempt.length).toBeGreaterThan(0);
    for (const m of exempt) {
      const audit = m.audit;
      if (audit?.mode !== 'exempt') continue;
      expect(audit.reason.trim().length).toBeGreaterThan(10);
    }
  });

  it('审计 sink 端口存在且可注入（`stateTransitionAudit`）', () => {
    const abs = join(
      REPO_ROOT,
      'packages/infra/src/state/engine/stateTransitionAudit.ts'
    );
    expect(existsSync(abs)).toBe(true);
    const text = readFileSync(abs, 'utf8');
    expect(text).toContain('setStateTransitionAuditSink');
    expect(text).toContain('emitStateTransitionAudit');
  });

  it('端口 → 事件适配：注入后发出 state/transition（seq=0 交追加器分配）', () => {
    const got: LiriEvent[] = [];
    setStateTransitionEventAppender(async (_sid, event) => {
      got.push(event);
      return { ok: true, tailSeq: 1 };
    });
    try {
      emitStateTransitionAudit('sess-audit', {
        machine: 'sessionState',
        from: 'idle',
        to: 'running',
        reason: 'unit_test',
        subjectId: 'sess-audit',
      });
    } finally {
      // 解除注入（不污染其它用例）
      setStateTransitionEventAppender(null);
    }
    expect(got).toHaveLength(1);
    expect(got[0]?.type).toBe('state/transition');
    expect(got[0]?.sessionId).toBe('sess-audit');
    expect(got[0]?.seq).toBe(0);
    expect(got[0]?.data).toMatchObject({
      machine: 'sessionState',
      from: 'idle',
      to: 'running',
      reason: 'unit_test',
    });
  });

  it('无会话上下文 ⇒ 不落事件（不编造 sessionId）', () => {
    const got: LiriEvent[] = [];
    setStateTransitionEventAppender(async (_sid, event) => {
      got.push(event);
      return { ok: true, tailSeq: 1 };
    });
    try {
      emitStateTransitionAudit(undefined, {
        machine: 'appState',
        from: 'idle',
        to: 'busy',
      });
    } finally {
      setStateTransitionEventAppender(null);
    }
    expect(got).toHaveLength(0);
  });
});
