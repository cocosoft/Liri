/**
 * 多租户 P3：项目归属强制（list / get / delete）
 *
 * 锁四件事：
 *  ① 已认证身份只能列出/读取自己的项目（他人项目与"不存在"同一结果 ⇒ 不泄露存在性）；
 *  ② 越权删除返回 false，且**不会**动他人的项目目录；
 *  ③ 本地身份（桌面 / CLI / 后台）恒放行 —— 与改造前一致；
 *  ④ 创建时写归属：本地项目不写字段（存量文件逐字不变），已认证项目写 `tenantId:userId`。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import { ProjectStore } from '../../src/workspace/ProjectStore';
import { WorkItemStore } from '../../src/workspace/WorkItemStore';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

let root: string;
let store: ProjectStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'project-owner-'));
  store = new ProjectStore(root, new WorkItemStore(root));
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows：句柄占用时交给系统清理
  }
});

/** 建项目：`delaySandbox` ⇒ 不碰用户主目录（默认 sandboxPath 在 ~/Documents 下） */
function createProject(name: string, principal?: Principal): string {
  const make = () =>
    store.create({
      workspaceId: 'default',
      name,
      sandboxPath: join(root, 'sandbox', name),
      delaySandbox: true,
    });
  return (principal ? runWithPrincipal(principal, make) : make()).id;
}

describe('项目归属强制（P3）', () => {
  it('创建：已认证项目写归属，本地项目不写（零变更）', () => {
    const localId = createProject('local');
    const aliceId = createProject('alice', ALICE);

    expect(store.get(localId)?.ownerKey).toBeUndefined();
    expect(store.get(aliceId)?.ownerKey).toBe('acme:alice');
  });

  it('列表与读取：已认证只看自己的；本地恒放行', () => {
    const localId = createProject('local');
    const aliceId = createProject('alice', ALICE);

    // 本地身份：两个都看得到、都读得到
    expect(store.list('default').length).toBe(2);
    expect(store.get(localId)).not.toBeNull();
    expect(store.get(aliceId)).not.toBeNull();

    // ALICE：只有自己的；本地项目按"不存在"处理
    const aliceVisible = runWithPrincipal(ALICE, () => store.list('default'));
    expect(aliceVisible.map((p) => p.id)).toEqual([aliceId]);
    expect(runWithPrincipal(ALICE, () => store.get(localId))).toBeNull();
    expect(runWithPrincipal(ALICE, () => store.get(aliceId))).not.toBeNull();

    // BOB：与 ALICE 同租户但不同用户 ⇒ 同样看不到
    expect(runWithPrincipal(BOB, () => store.list('default'))).toEqual([]);
    expect(runWithPrincipal(BOB, () => store.get(aliceId))).toBeNull();
  });

  it('删除：越权返回 false 且不动他人项目目录；归属者本人可删', () => {
    const aliceId = createProject('alice', ALICE);
    const projectDir = join(root, 'projects', aliceId);

    expect(runWithPrincipal(BOB, () => store.delete(aliceId))).toBe(false);
    expect(existsSync(projectDir)).toBe(true);

    expect(runWithPrincipal(ALICE, () => store.delete(aliceId))).toBe(true);
    expect(existsSync(projectDir)).toBe(false);
  });
});
