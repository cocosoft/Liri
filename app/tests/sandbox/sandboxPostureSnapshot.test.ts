/**
 * G4 M0-③（2026-11-12）：沙箱姿态快照落盘。
 *
 * 背景：围栏是另一个进程的只读观察者，只能读文件 ⇒ 主进程必须把「姿态 + 违规摘要」
 * 定期**原子**落盘（`<securityDir>/sandbox-posture.json`）。本用例钉住三条契约：
 * ① 快照字段与姿态同源（含风险编码、违规数、schema 版本）；
 * ② 落盘是原子替换（无 `.tmp` 残留）、可覆盖刷新；
 * ③ 写入失败**不上抛**（只影响围栏取证，不影响权限/沙箱判定）。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SANDBOX_POSTURE_SNAPSHOT_SCHEMA_VERSION,
  buildSandboxPostureSnapshot,
  startSandboxPostureSnapshotWriter,
  type SandboxPostureSnapshotSource,
} from '../../src/entrypoints/sandboxPostureSnapshot.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'posture-snapshot-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** 一份固定的姿态（与 `describeSandboxPosture()` 输出同构） */
function source(violationCount = 3): SandboxPostureSnapshotSource {
  return {
    posture: {
      mode: 'none',
      permissionLevel: 'standard',
      bashSandboxReason: 'switch-off',
      landlock: {
        enabled: false,
        bashEnabled: false,
        failClosed: false,
        available: false,
      },
      openRisks: ['当前进程无隔离证据（mode=none）'],
      openRiskCodes: ['mode-none', 'landlock-fail-open'],
    },
    violationCount,
  };
}

describe('M0-③：沙箱姿态快照（纯构造）', () => {
  it('字段与姿态同源，capturedAt 由注入时刻决定', () => {
    const now = new Date('2026-11-12T05:00:00.000Z');
    const snapshot = buildSandboxPostureSnapshot(source(7), now);

    expect(snapshot.schemaVersion).toBe(
      SANDBOX_POSTURE_SNAPSHOT_SCHEMA_VERSION
    );
    expect(snapshot.capturedAt).toBe('2026-11-12T05:00:00.000Z');
    expect(snapshot.mode).toBe('none');
    expect(snapshot.permissionLevel).toBe('standard');
    expect(snapshot.bashSandboxReason).toBe('switch-off');
    expect(snapshot.landlock).toEqual({
      enabled: false,
      bashEnabled: false,
      failClosed: false,
      available: false,
    });
    expect(snapshot.openRiskCodes).toEqual(['mode-none', 'landlock-fail-open']);
    expect(snapshot.openRisks).toHaveLength(1);
    expect(snapshot.violationCount).toBe(7);
  });

  it('风险数组是副本（不与采集源共享引用）', () => {
    const input = source();
    const snapshot = buildSandboxPostureSnapshot(input);
    input.posture.openRiskCodes.push('landlock-bash-disabled');
    expect(snapshot.openRiskCodes).toEqual(['mode-none', 'landlock-fail-open']);
  });
});

describe('M0-③：快照落盘', () => {
  it('立刻写一次 + 可覆盖刷新，且原子替换无 .tmp 残留', async () => {
    const dir = makeTmpDir();
    const targetPath = join(dir, 'sandbox-posture.json');
    let violationCount = 1;

    const handle = startSandboxPostureSnapshotWriter({
      targetPath,
      intervalMs: 60_000,
      read: () => source(violationCount),
    });
    try {
      // 启动即写（不等到第一个周期）：flush 在首个 await 前已调用写入
      await handle.flush();
      const first = JSON.parse(readFileSync(targetPath, 'utf-8'));
      expect(first.violationCount).toBe(1);
      expect(first.schemaVersion).toBe(SANDBOX_POSTURE_SNAPSHOT_SCHEMA_VERSION);

      violationCount = 5;
      await handle.flush();
      const second = JSON.parse(readFileSync(targetPath, 'utf-8'));
      expect(second.violationCount).toBe(5);

      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      handle.stop();
    }
  });

  it('写入失败只降级：不 reject、不抛错（围栏读到缺失数据）', async () => {
    const dir = makeTmpDir();
    const handle = startSandboxPostureSnapshotWriter({
      targetPath: join(dir, 'sandbox-posture.json'),
      intervalMs: 60_000,
      read: () => source(),
      writeFile: async () => {
        throw new Error('disk full');
      },
    });
    try {
      await expect(handle.flush()).resolves.toBeUndefined();
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      handle.stop();
    }
  });
});
