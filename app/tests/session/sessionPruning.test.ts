// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话数据保留策略（2026-10-31，台账「数据保留策略」项）
 *
 * 锁三件事：
 *  ① 目录型会话的**占用与最近活动时间按真实文件实测**（原实现读目录自身 `stat`：
 *     Windows 上 size≈0、mtime 只在子项增删时变 ⇒ 按大小/按天数两档**从不触发**）；
 *  ② 演练（dryRun）**不动文件**；执行时是**软删除**（rename 到 `.trash`，可恢复）；
 *  ③ `buildPruningConfig` 的缺省安全取向：未配置 = 不启用；启用后缺省演练。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_DATA_RETENTION,
  SessionPruning,
  buildPruningConfig,
} from '../../src/session/SessionPruning';

const dirs: string[] = [];

function makeSessionsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'session-prune-'));
  dirs.push(root);
  return root;
}

/** 造一个目录型会话；`sizeBytes` 决定 messages.jsonl 大小，`ageDays` 决定 mtime */
function makeDirSession(
  root: string,
  id: string,
  opts: { sizeBytes?: number; ageDays?: number } = {}
): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ id }));
  writeFileSync(join(dir, 'messages.jsonl'), 'x'.repeat(opts.sizeBytes ?? 10));
  if (opts.ageDays !== undefined) {
    const t = new Date(Date.now() - opts.ageDays * 24 * 3600 * 1000);
    utimesSync(join(dir, 'messages.jsonl'), t, t);
    utimesSync(join(dir, 'session.json'), t, t);
  }
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
  }
});

describe('SessionPruning：目录型会话按真实占用 / 真实 mtime 判定', () => {
  it('按大小触发（目录自身 size≈0 也不会漏判）', async () => {
    const root = makeSessionsDir();
    const big = makeDirSession(root, 'session_big', { sizeBytes: 4096 });

    // 上限 1KB ⇒ 4KB 的会话必然超限
    const result = await new SessionPruning({
      sessionsDir: root,
      maxSizeMB: 0.001,
      maxSessions: 100,
      maxAgeDays: 3650,
      dryRun: true,
    }).prune();

    expect(result.prunedSessions).toContain('session_big');
    expect(result.bytesFreed).toBeGreaterThanOrEqual(4096);
    // 演练 ⇒ 目录仍在
    expect(existsSync(big)).toBe(true);
  });

  it('按天数触发（读的是会话内文件 mtime，不是目录 mtime）', async () => {
    const root = makeSessionsDir();
    makeDirSession(root, 'session_old', { ageDays: 30 });
    makeDirSession(root, 'session_new', { ageDays: 0 });

    const result = await new SessionPruning({
      sessionsDir: root,
      maxSizeMB: 500,
      maxSessions: 100,
      maxAgeDays: 7,
      dryRun: true,
    }).prune();

    expect(result.prunedSessions).toEqual(['session_old']);
  });

  it('执行模式：软删除到 .trash（不物理删除，可恢复）', async () => {
    const root = makeSessionsDir();
    const old = makeDirSession(root, 'session_trash', { ageDays: 30 });

    const result = await new SessionPruning({
      sessionsDir: root,
      maxSizeMB: 500,
      maxSessions: 100,
      maxAgeDays: 7,
      dryRun: false,
    }).prune();

    expect(result.sessionsPruned).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(root, '.trash'))).toBe(true);
  });

  it('按会话数上限触发（最旧的先删）', async () => {
    const root = makeSessionsDir();
    makeDirSession(root, 'session_1', { ageDays: 3 });
    makeDirSession(root, 'session_2', { ageDays: 2 });
    makeDirSession(root, 'session_3', { ageDays: 1 });

    const result = await new SessionPruning({
      sessionsDir: root,
      maxSizeMB: 500,
      maxSessions: 2,
      maxAgeDays: 3650,
      dryRun: true,
    }).prune();

    expect(result.prunedSessions).toEqual(['session_1']);
  });
});

describe('buildPruningConfig：缺省安全取向', () => {
  it('未配置 ⇒ 不启用、缺省演练、阈值取缺省', () => {
    const config = buildPruningConfig({});

    expect(DEFAULT_DATA_RETENTION.enabled).toBe(false);
    expect(config.dryRun).toBe(true);
    expect(config.maxSessions).toBe(DEFAULT_DATA_RETENTION.maxSessions);
    expect(config.maxAgeDays).toBe(DEFAULT_DATA_RETENTION.maxAgeDays);
    expect(config.maxSizeMB).toBe(DEFAULT_DATA_RETENTION.maxSizeMB);
  });

  it('配置覆盖生效；--apply（forceApply）才会落盘', () => {
    const configured = buildPruningConfig({
      retention: { maxSessions: 7, maxAgeDays: 3, maxSizeMB: 9 },
    });
    expect(configured.maxSessions).toBe(7);
    expect(configured.maxAgeDays).toBe(3);
    expect(configured.maxSizeMB).toBe(9);
    expect(configured.dryRun).toBe(true);

    const applied = buildPruningConfig({ forceApply: true });
    expect(applied.dryRun).toBe(false);
  });
});
