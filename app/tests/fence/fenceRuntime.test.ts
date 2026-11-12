/**
 * 围栏 M1：姿态四态 + 运行时 tick（心跳 / 生命周期告警）。
 *
 * 关键契约：
 * ① `missing` / `stale` / `invalid` 三态互不混淆；`no-signal` 与"一切正常"可区分；
 * ② 生命周期告警按**跃迁**去重（持续缺失不会刷屏），恢复后可再次告警；
 * ③ 审计日志截断 ⇒ `log-rotated` 且偏移归零。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FENCE_POSTURE_SCHEMA_VERSION,
  observeFencePosture,
} from '../../src/entrypoints/fence/posture.js';
import {
  createFence,
  type FencePaths,
  type FenceRuntimeDeps,
} from '../../src/entrypoints/fence/runtime.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fence-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-11-12T10:00:00.000Z');
const STALE_AFTER_MS = 120_000;

function paths(dir: string): FencePaths {
  return {
    auditLogPath: join(dir, 'security-audit.log'),
    posturePath: join(dir, 'sandbox-posture.json'),
    heartbeatPath: join(dir, 'fence-heartbeat.json'),
    alertsPath: join(dir, 'fence-alerts.jsonl'),
  };
}

function postureRaw(
  capturedAt: string,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    schemaVersion: FENCE_POSTURE_SCHEMA_VERSION,
    capturedAt,
    mode: 'none',
    permissionLevel: 'standard',
    bashSandboxReason: 'switch-off',
    landlock: {
      enabled: false,
      bashEnabled: false,
      failClosed: false,
      available: false,
    },
    openRiskCodes: ['mode-none'],
    openRisks: ['当前进程无隔离证据'],
    violationCount: 2,
    recentViolations: [],
    ...overrides,
  });
}

function deps(dir: string, now: Date = NOW): FenceRuntimeDeps {
  return {
    paths: paths(dir),
    postureStaleAfterMs: STALE_AFTER_MS,
    now: () => now,
  };
}

describe('M1：姿态四态', () => {
  it('缺失 ⇒ missing', () => {
    const observation = observeFencePosture({
      exists: false,
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(observation.state).toBe('missing');
  });

  it('未知 schemaVersion / 坏 JSON ⇒ invalid（不猜）', () => {
    const unknown = observeFencePosture({
      exists: true,
      raw: postureRaw('2026-11-12T09:59:50.000Z', { schemaVersion: 99 }),
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(unknown.state).toBe('invalid');
    expect(unknown.reason).toContain('schemaVersion');

    const broken = observeFencePosture({
      exists: true,
      raw: '{not json',
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(broken.state).toBe('invalid');
  });

  it('新鲜 ⇒ ok；超过阈值 ⇒ stale（两者都能带出违规与风险编码）', () => {
    const fresh = observeFencePosture({
      exists: true,
      raw: postureRaw('2026-11-12T09:59:50.000Z'),
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(fresh.state).toBe('ok');
    expect(fresh.violationCount).toBe(2);
    expect(fresh.openRiskCodes).toEqual(['mode-none']);

    const stale = observeFencePosture({
      exists: true,
      raw: postureRaw('2026-11-12T09:50:00.000Z'),
      now: NOW,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(stale.state).toBe('stale');
    expect(stale.ageMs).toBe(600_000);
  });
});

describe('M1：运行时 tick', () => {
  it('两个输入都缺失 ⇒ no-signal，且缺失告警只发一次（跃迁去重）', async () => {
    const dir = makeTmpDir();
    const fence = createFence(deps(dir));

    const first = await fence.tick();
    expect(first.heartbeat.status).toBe('no-signal');
    expect(first.alerts.map((a) => a.kind).sort()).toEqual([
      'audit-log-missing',
      'posture-missing',
    ]);

    const second = await fence.tick();
    expect(second.heartbeat.status).toBe('no-signal');
    expect(second.alerts).toEqual([]);

    const heartbeat = JSON.parse(
      readFileSync(paths(dir).heartbeatPath, 'utf-8')
    );
    expect(heartbeat.status).toBe('no-signal');
    // 告警已落盘（2 条）
    const alertLines = readFileSync(paths(dir).alertsPath, 'utf-8')
      .trim()
      .split('\n');
    expect(alertLines).toHaveLength(2);
  });

  it('信号就绪 ⇒ observing；增量读只算新行，并记录最后事件时间', async () => {
    const dir = makeTmpDir();
    const fence = createFence(deps(dir));
    writeFileSync(
      paths(dir).posturePath,
      postureRaw('2026-11-12T09:59:50.000Z')
    );
    const line1 = `${JSON.stringify({ timestamp: '2026-11-12T09:59:40.000Z', decision: 'auto_denied' })}\n`;
    writeFileSync(paths(dir).auditLogPath, line1);

    const first = await fence.tick();
    expect(first.heartbeat.status).toBe('observing');
    expect(first.heartbeat.audit.appendedEvents).toBe(1);
    expect(first.heartbeat.audit.lastEventAt).toBe('2026-11-12T09:59:40.000Z');
    expect(first.heartbeat.posture.state).toBe('ok');

    const line2 = `${JSON.stringify({ timestamp: '2026-11-12T09:59:55.000Z', decision: 'auto_allowed' })}\n`;
    writeFileSync(paths(dir).auditLogPath, line1 + line2);
    const second = await fence.tick();
    expect(second.heartbeat.audit.appendedEvents).toBe(1);
    expect(second.heartbeat.audit.lastEventAt).toBe('2026-11-12T09:59:55.000Z');
    expect(second.alerts).toEqual([]);
  });

  it('审计日志截断 ⇒ log-rotated 且从 0 重读', async () => {
    const dir = makeTmpDir();
    const fence = createFence(deps(dir));
    writeFileSync(
      paths(dir).auditLogPath,
      `${JSON.stringify({ timestamp: '2026-11-12T09:59:40.000Z' })}\n`
    );
    await fence.tick();

    writeFileSync(
      paths(dir).auditLogPath,
      `${JSON.stringify({ timestamp: '2026-11-12T09:59:59.000Z' })}\n`
    );
    const afterRotation = await fence.tick();
    expect(afterRotation.alerts.map((a) => a.kind)).toContain('log-rotated');
    expect(afterRotation.heartbeat.audit.appendedEvents).toBe(1);
    expect(afterRotation.heartbeat.audit.lastEventAt).toBe(
      '2026-11-12T09:59:59.000Z'
    );
  });

  it('姿态过期 ⇒ stale 告警一次；持续 stale 不重复', async () => {
    const dir = makeTmpDir();
    const fence = createFence(deps(dir));
    writeFileSync(
      paths(dir).posturePath,
      postureRaw('2026-11-12T09:50:00.000Z')
    );

    const first = await fence.tick();
    expect(first.heartbeat.posture.state).toBe('stale');
    expect(first.alerts.map((a) => a.kind)).toContain('posture-stale');

    const second = await fence.tick();
    expect(second.alerts).toEqual([]);
  });

  it('坏行不猜内容：跳过并按 tick 告警 audit-line-invalid', async () => {
    const dir = makeTmpDir();
    const fence = createFence(deps(dir));
    writeFileSync(paths(dir).auditLogPath, 'not-json\n');

    const result = await fence.tick();
    expect(result.heartbeat.audit.appendedEvents).toBe(1);
    expect(result.heartbeat.audit.lastEventAt).toBeUndefined();
    expect(result.alerts.map((a) => a.kind)).toContain('audit-line-invalid');
  });
});
