/**
 * 审批四段事件门禁 —— 规格 `.trae/specs/p5-runtime-hardening-specs.md` §1.2（P5-1，2026-10-28）
 *
 * 锁住五条：
 * A1 四段事件名已进**双端唯一事实源**（`shared/events/eventNames.ts`）与已知类型清单；
 * A2 四段只能**逐段前进**（合法链的产物顺序 = 规范顺序）；
 * A3/A4 `decided` 必须显式决定；`allow_session` / `allow_always` 必须带授权维度；
 * A5 负向夹具：跳段 / 无决定 / `deny` 后再推进**一律拒绝**；
 * 接线自证：三处调用点各自只落自己那几段（源码扫描，防"改了判据忘了打点"）。
 *
 * ⚠️ 打点开关默认**关闭**（`config.json → approvalFourStage.enabled`）⇒ 本门禁验证的是
 * "契约与判据"，不依赖运行期是否已开启。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { LIRI_EVENT_NAMES } from '../../../shared/events/eventNames';
import { KNOWN_SESSION_EVENT_TYPES } from '../../src/session/types/knownEventTypes';
import {
  APPROVAL_STAGES,
  advanceApproval,
  isApprovalExecutable,
  resolveApprovalDecision,
  resolveRecordScope,
  startApprovalChain,
  type ApprovalChainState,
} from '../../src/permission/approvalStages';
import {
  DEFAULT_APPROVAL_FOUR_STAGE_CONFIG,
  emitApprovalAudit,
  parseApprovalFourStageConfig,
  readApprovalFourStageConfig,
  setApprovalAuditSink,
} from '../../src/permission/approvalAudit';
import { toSessionEvent } from '../../src/runtime/api/approvalAuditSink';

const REPO_ROOT = join(import.meta.dir, '../../..');

const APPROVAL_EVENTS = [
  'approval/requested',
  'approval/presented',
  'approval/decided',
  'approval/recorded',
] as const;

/** 期望成功（失败即抛，避免用例里堆 result 判定） */
function mustAdvance(
  state: ApprovalChainState,
  next: (typeof APPROVAL_STAGES)[number],
  options: {
    decision?: 'allow_once' | 'allow_session' | 'allow_always' | 'deny';
    fingerprint?: string;
  } = {}
): ApprovalChainState {
  const result = advanceApproval(state, next, options);
  if (!result.ok) throw new Error(`unexpected reject: ${result.reason}`);
  return result.state;
}

function readSource(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

describe('A1 · 四段事件名已注册（双端唯一事实源 + 已知类型清单）', () => {
  it('shared/events/eventNames.ts 含四段', () => {
    const names = LIRI_EVENT_NAMES as readonly string[];
    for (const name of APPROVAL_EVENTS) {
      expect(names).toContain(name);
    }
  });

  it('knownEventTypes 注册表含四段（写入/读取端不会拒收）', () => {
    for (const name of APPROVAL_EVENTS) {
      expect(KNOWN_SESSION_EVENT_TYPES.has(name)).toBe(true);
    }
  });
});

describe('A2 · 四段逐段前进（合法链）', () => {
  it('顺序 = requested → presented → decided → recorded', () => {
    const seen: string[] = ['requested'];
    let state = startApprovalChain();
    expect(state.stage).toBe('requested');

    state = mustAdvance(state, 'presented');
    seen.push('presented');
    // 未决定（presented）不得执行
    expect(isApprovalExecutable(state)).toBe(false);

    state = mustAdvance(state, 'decided', {
      decision: 'allow_session',
      fingerprint: 'fp:file_write:/tmp/a',
    });
    seen.push('decided');
    expect(isApprovalExecutable(state)).toBe(true);

    state = mustAdvance(state, 'recorded');
    seen.push('recorded');

    expect(seen).toEqual([...APPROVAL_STAGES]);
    expect(state.stage).toBe('recorded');
  });

  it('事件映射：四段各自落成对应会话事件（payload 不含明文参数）', () => {
    const requested = toSessionEvent('s1', {
      stage: 'requested',
      approvalId: 'ap_1',
      toolName: 'bash',
      risk: 'shell',
      inputPreview: '{"command":"dir"}',
    });
    const presented = toSessionEvent('s1', {
      stage: 'presented',
      approvalId: 'ap_1',
      toolName: 'bash',
      risk: 'shell',
      options: ['approve', 'deny'],
      fingerprintHash: 'abc',
      inboxItemId: 'inbox_1',
    });
    const decided = toSessionEvent('s1', {
      stage: 'decided',
      approvalId: 'ap_1',
      decision: 'allow_once',
      by: 'user',
      reply: 'approve',
    });
    const recorded = toSessionEvent('s1', {
      stage: 'recorded',
      approvalId: 'ap_1',
      decision: 'allow_once',
      commandHash: 'h1',
      scopeKind: 'once',
    });

    expect([
      requested.type,
      presented.type,
      decided.type,
      recorded.type,
    ]).toEqual([...APPROVAL_EVENTS]);
    // 同一条链的四个事件必须共用 approvalId
    for (const event of [requested, presented, decided, recorded]) {
      expect((event.data as { approvalId: string }).approvalId).toBe('ap_1');
      expect((event as { schemaVersion?: number }).schemaVersion).toBe(1);
    }
    // 呈现段带授权维度摘要与可选项（第②段的产物定义）
    expect(presented.data).toMatchObject({
      options: ['approve', 'deny'],
      fingerprintHash: 'abc',
      inboxItemId: 'inbox_1',
    });
  });
});

describe('A3/A4 · 决定显式 + 授权维度随决定', () => {
  it('`decided` 不带 decision ⇒ 拒（不得"默认允许"）', () => {
    const presented = mustAdvance(startApprovalChain(), 'presented');
    const result = advanceApproval(presented, 'decided');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('必须带 decision');
  });

  it('`allow_session` / `allow_always` 不带 fingerprint ⇒ 拒', () => {
    const presented = mustAdvance(startApprovalChain(), 'presented');
    for (const decision of ['allow_session', 'allow_always'] as const) {
      const result = advanceApproval(presented, 'decided', { decision });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('fingerprint');

      const withFp = advanceApproval(presented, 'decided', {
        decision,
        fingerprint: 'fp:file_write:/tmp/a',
      });
      expect(withFp.ok).toBe(true);
    }
  });

  it('回复值 → 决策词表（单一映射；未命中 fail-closed 为 deny）', () => {
    expect(resolveApprovalDecision('approve')).toBe('allow_once');
    expect(resolveApprovalDecision('approve_session')).toBe('allow_session');
    expect(resolveApprovalDecision('allowlist_call')).toBe('allow_always');
    expect(resolveApprovalDecision('allowlist_tool')).toBe('allow_always');
    expect(resolveApprovalDecision('allowlist_command')).toBe('allow_always');
    expect(resolveApprovalDecision('deny')).toBe('deny');
    expect(resolveApprovalDecision('something_else')).toBe('deny');
    // 选项式回复同义（任一命中）
    expect(resolveApprovalDecision('', 'approve')).toBe('allow_once');

    // 留痕范围
    expect(resolveRecordScope('allow_once')).toBe('once');
    expect(resolveRecordScope('allow_session')).toBe('session');
    expect(resolveRecordScope('allow_always')).toBe('always');
    expect(resolveRecordScope('deny')).toBe('once');
  });
});

describe('A5 · 负向夹具（门禁必红）', () => {
  it('跳段：requested 直接 decided / recorded ⇒ 拒', () => {
    for (const next of ['decided', 'recorded'] as const) {
      const result = advanceApproval(startApprovalChain(), next, {
        decision: 'allow_once',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('逐段前进');
    }
  });

  it('`deny` 终态：不得进入 recorded、也不可执行', () => {
    const denied = mustAdvance(
      mustAdvance(startApprovalChain(), 'presented'),
      'decided',
      { decision: 'deny' }
    );
    expect(isApprovalExecutable(denied)).toBe(false);
    expect(advanceApproval(denied, 'recorded').ok).toBe(false);
  });

  it('回退 / 重放同一段 ⇒ 拒', () => {
    const presented = mustAdvance(startApprovalChain(), 'presented');
    expect(advanceApproval(presented, 'requested').ok).toBe(false);
    expect(advanceApproval(presented, 'presented').ok).toBe(false);
  });
});

describe('开关（默认关闭，fail-closed）', () => {
  it('默认值 = 关闭', () => {
    expect(DEFAULT_APPROVAL_FOUR_STAGE_CONFIG.enabled).toBe(false);
  });

  it('只有严格 true 才开启（其余一律关闭）', () => {
    expect(parseApprovalFourStageConfig(undefined).enabled).toBe(false);
    expect(parseApprovalFourStageConfig({}).enabled).toBe(false);
    expect(parseApprovalFourStageConfig({ enabled: 'true' }).enabled).toBe(
      false
    );
    expect(parseApprovalFourStageConfig({ enabled: 1 }).enabled).toBe(false);
    expect(parseApprovalFourStageConfig({ enabled: true }).enabled).toBe(true);
  });

  it('关闭时 emitApprovalAudit 不产生任何事件', () => {
    // 本机若已在 config.json 显式开启，则跳过该运行期断言（默认值由上一用例保证）
    if (readApprovalFourStageConfig().enabled) return;

    const seen: string[] = [];
    setApprovalAuditSink((_sessionId, event) => seen.push(event.stage));
    try {
      emitApprovalAudit('s1', {
        stage: 'requested',
        approvalId: 'ap_off',
        toolName: 'bash',
        risk: 'shell',
      });
      expect(seen).toEqual([]);
    } finally {
      setApprovalAuditSink(null);
    }
  });
});

describe('接线自证（三处调用点各落自己那几段）', () => {
  it('①② 在权限层与工具级审批卡提交处各一份', () => {
    for (const file of [
      'app/src/permission/PermissionChecker.ts',
      'app/src/chat/ChatManager.ts',
    ]) {
      const source = readSource(file);
      expect(source).toContain("stage: 'requested'");
      expect(source).toContain("stage: 'presented'");
    }
  });

  it('③④ 在审批解析侧，且入口已安装 sink', () => {
    const approval = readSource('app/src/runtime/inboxApproval.ts');
    expect(approval).toContain("stage: 'decided'");
    expect(approval).toContain("stage: 'recorded'");

    const entry = readSource('app/src/entrypoints/init.ts');
    expect(entry).toContain('installApprovalAuditSink');
  });
});
