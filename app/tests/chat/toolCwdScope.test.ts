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

import type { Principal } from '@openliri/kernel/identity/principal';
import { resolveProjectRoot } from '@modules/environment';
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

/**
 * P2-4（2026-10-27）：本地身份的**裸会话**按运行形态分流。
 *
 * 编译版的 `resolveProjectRoot()` 是 exe 所在目录（安装目录）⇒ 裸会话工具不能落在那里；
 * 开发入口保持仓库根（便于调试）。`compiled` 由用例注入，避免依赖真实 execPath。
 */
describe('P2-4 裸会话 cwd 按运行形态分流', () => {
  const LOCAL: Principal = { tenantId: 'local', userId: 'local', roles: [] };

  it('编译版 + 裸会话 + sessionId ⇒ <data>/workspace/sessions/<id>，且目录被创建', () => {
    const decision = resolveToolCwd(undefined, LOCAL, {
      sessionId: 'sess-abc',
      compiled: true,
    });

    expect(decision.cwd).toBe(
      resolve(join(dataDir, 'workspace', 'sessions', 'sess-abc'))
    );
    expect(existsSync(decision.cwd)).toBe(true);
    expect(decision.cwd).not.toBe(resolveProjectRoot());
  });

  it('开发入口（非编译）⇒ 保持仓库根（零变更）', () => {
    const decision = resolveToolCwd(undefined, LOCAL, {
      sessionId: 'sess-abc',
      compiled: false,
    });
    expect(decision.cwd).toBe(resolveProjectRoot());
  });

  it('编译版但无 sessionId ⇒ 无法锚定，退回仓库根（不凭空造目录）', () => {
    const decision = resolveToolCwd(undefined, LOCAL, { compiled: true });
    expect(decision.cwd).toBe(resolveProjectRoot());
    expect(!existsSync(join(dataDir, 'workspace', 'sessions'))).toBe(true);
  });

  it('显式会话工作区优先（编译版也不覆盖用户指定）', () => {
    const explicit = resolve(dataDir, 'user-picked');
    const decision = resolveToolCwd(explicit, LOCAL, {
      sessionId: 'sess-abc',
      compiled: true,
    });
    expect(decision.cwd).toBe(explicit);
  });

  it('sessionId 做路径安全化（`../` 不得逃逸）', () => {
    const decision = resolveToolCwd(undefined, LOCAL, {
      sessionId: '../../evil',
      compiled: true,
    });
    expect(decision.cwd).toBe(
      resolve(join(dataDir, 'workspace', 'sessions', '.._.._evil'))
    );
    expect(decision.cwd).toContain(join('workspace', 'sessions'));
  });
});
