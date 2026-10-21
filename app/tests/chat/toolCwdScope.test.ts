/**
 * 多租户 P3：工具执行 cwd 按身份分治
 *
 * 锁四件事：
 *  ① 本地身份（桌面 / CLI / cron / 通道 / 无作用域）行为**逐字不变**
 *     （会话工作区 ?? 进程项目根）；
 *  ② 已认证身份**绝不**回落到进程级项目根，缺省会落在 `<scoped>/workspace` 且目录被创建；
 *  ③ 会话工作区越出该身份根（含 `..` 逃逸）⇒ 忽略并回退，`rejectedSessionWorkspace=true`；
 *  ④ 该身份根内的会话工作区原样使用（多项目会话仍可各自指定目录）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import type { Principal } from '../../src/core/identity/principal';
import { resolveProjectRoot } from '../../src/core/paths';
import { resolveToolCwd } from '../../src/chat/services/toolCwdScope';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tool-cwd-'));
  process.env.LIRI_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：残留句柄可能持有目录锁 ⇒ 交给系统清理（断言均已完成）
  }
});

function aliceRoot(): string {
  return join(dataDir, 'tenants', 'acme', 'users', 'alice', 'workspace');
}

describe('工具 cwd 按身份分治（P3）', () => {
  it('本地身份：无会话工作区 ⇒ 进程项目根；有则原样使用（零变更）', () => {
    const noWorkspace = resolveToolCwd(undefined, {
      tenantId: 'local',
      userId: 'local',
      roles: [],
    });
    expect(noWorkspace.cwd).toBe(resolveProjectRoot());
    expect(noWorkspace.rejectedSessionWorkspace).toBe(false);

    const withWorkspace = resolveToolCwd(resolve(dataDir, 'any-project'), {
      tenantId: 'local',
      userId: 'local',
      roles: [],
    });
    expect(withWorkspace.cwd).toBe(resolve(dataDir, 'any-project'));
    expect(withWorkspace.rejectedSessionWorkspace).toBe(false);
  });

  it('已认证身份：无会话工作区 ⇒ <scoped>/workspace，且目录被创建', () => {
    const decision = resolveToolCwd(undefined, ALICE);

    expect(decision.cwd).toBe(resolve(aliceRoot()));
    expect(decision.rejectedSessionWorkspace).toBe(false);
    expect(existsSync(aliceRoot())).toBe(true);
    // 绝不回落到宿主机项目根
    expect(decision.cwd).not.toBe(resolveProjectRoot());
  });

  it('已认证身份：根内的会话工作区原样使用', () => {
    const inside = join(aliceRoot(), 'proj-1');
    const decision = resolveToolCwd(inside, ALICE);

    expect(decision.cwd).toBe(resolve(inside));
    expect(decision.rejectedSessionWorkspace).toBe(false);
  });

  it('已认证身份：根外 / .. 逃逸的会话工作区被忽略并回退', () => {
    const outside = join(dataDir, 'sessions', 'shared');
    const escape = join(aliceRoot(), '..', '..', 'bob', 'workspace');
    const otherTenant = join(
      dataDir,
      'tenants',
      'acme',
      'users',
      'bob',
      'workspace'
    );

    for (const candidate of [outside, escape, otherTenant]) {
      const decision = resolveToolCwd(candidate, ALICE);
      expect(decision.cwd).toBe(resolve(aliceRoot()));
      expect(decision.rejectedSessionWorkspace).toBe(true);
    }
  });

  it('不同身份落到各自的工作区根（互不共享）', () => {
    const alice = resolveToolCwd(undefined, ALICE);
    const bob = resolveToolCwd(undefined, BOB);

    expect(alice.cwd).not.toBe(bob.cwd);
    expect(bob.cwd).toBe(
      resolve(join(dataDir, 'tenants', 'acme', 'users', 'bob', 'workspace'))
    );
    expect(existsSync(bob.cwd)).toBe(true);
  });
});
