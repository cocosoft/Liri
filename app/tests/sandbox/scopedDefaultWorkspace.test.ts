/**
 * 多租户 P3：默认工作区按**请求身份**解析
 *
 * 背景：`spiWiring` 启动期以 `process.cwd()` 建了一个 `'default'` 工作区（进程级）。
 * 已认证用户的沙箱权限判定与状态查询都读它 ⇒ 租户用的是宿主机工作目录与宿主默认权限。
 *
 * 覆盖：
 * ① 本地身份仍映射到 `'default'`（未建时**只查不建**，保留既有 fail-closed/放行分支）；
 * ② 已认证身份映射到 `default@<tenant>:<user>`，惰性建立且工作目录落在自己的分区根；
 * ③ 两个身份互不可见（实例隔离）；
 * ④ 工作区数量按身份计数（不泄露宿主/他人工作区个数）。
 *
 * 标识一律用**本文件独有**的租户（分身份实例是进程级缓存，借用会污染其他用例）。
 */
import { describe, it, expect } from 'bun:test';

import {
  getScopedDefaultWorkspace,
  scopedActiveWorkspaceCount,
  scopedDefaultWorkspaceId,
  LOCAL_DEFAULT_WORKSPACE_ID,
} from '../../src/sandbox/scopedDefaultWorkspace.js';
import { globalWorkspaceManager } from '../../src/sandbox/WorkspaceManager.js';
import { SandboxPermission } from '@modules/core/sandboxPermission.js';
import { runWithPrincipal } from '@modules/core/identity/requestScope.js';
import {
  LOCAL_PRINCIPAL,
  type Principal,
} from '@modules/core/identity/principal.js';

const ALICE: Principal = {
  tenantId: 'scoped-ws-a',
  userId: 'alice',
  roles: ['user'],
};
const BOB: Principal = {
  tenantId: 'scoped-ws-b',
  userId: 'bob',
  roles: ['user'],
};

describe('scopedDefaultWorkspaceId', () => {
  it('本地身份 ⇒ 宿主默认工作区 id', () => {
    expect(scopedDefaultWorkspaceId()).toBe(LOCAL_DEFAULT_WORKSPACE_ID);
    expect(runWithPrincipal(LOCAL_PRINCIPAL, scopedDefaultWorkspaceId)).toBe(
      LOCAL_DEFAULT_WORKSPACE_ID
    );
  });

  it('已认证身份 ⇒ `default@<tenant>:<user>`（与管理宿主实例区分）', () => {
    expect(runWithPrincipal(ALICE, scopedDefaultWorkspaceId)).toBe(
      'default@scoped-ws-a:alice'
    );
  });
});

describe('getScopedDefaultWorkspace', () => {
  it('本地身份**只查不建**：未建时返回 undefined（保留启动装配语义）', () => {
    const id = LOCAL_DEFAULT_WORKSPACE_ID;
    const existed = globalWorkspaceManager.has(id);
    if (!existed) {
      expect(getScopedDefaultWorkspace()).toBeUndefined();
    } else {
      expect(getScopedDefaultWorkspace()).toBe(globalWorkspaceManager.get(id));
    }
  });

  it('已认证身份 ⇒ 惰性建立，工作目录落在自己分区（不是宿主机 cwd）', () => {
    const workspace = runWithPrincipal(ALICE, getScopedDefaultWorkspace);
    expect(workspace).toBeDefined();

    const workingDirectory = String(
      workspace!.getStatus().config.workingDirectory ?? ''
    ).replace(/\\/g, '/');
    expect(workingDirectory).toContain(
      'tenants/scoped-ws-a/users/alice/workspace'
    );
  });

  it('同一身份重复取用 ⇒ 同一实例；不同身份 ⇒ 不同实例', () => {
    const alice1 = runWithPrincipal(ALICE, getScopedDefaultWorkspace);
    const alice2 = runWithPrincipal(ALICE, getScopedDefaultWorkspace);
    const bob = runWithPrincipal(BOB, getScopedDefaultWorkspace);

    expect(alice2).toBe(alice1!);
    expect(bob).toBeDefined();
    expect(bob).not.toBe(alice1!);
    expect(globalWorkspaceManager.get('default@scoped-ws-b:bob')).toBe(bob!);
  });

  it('已建立的分区工作区可用（默认权限含读文件）', () => {
    const workspace = runWithPrincipal(ALICE, getScopedDefaultWorkspace);
    expect(workspace!.hasPermission(SandboxPermission.READ_FILE)).toBe(true);
  });
});

describe('scopedActiveWorkspaceCount', () => {
  it('已认证身份 ⇒ 只见自己的工作区（0/1，且不泄露宿主数量）', () => {
    const count = runWithPrincipal(BOB, scopedActiveWorkspaceCount);
    expect(count).toBe(1); // 上一条用例已建立
  });

  it('本地身份 ⇒ 保持既有口径（进程内全部工作区）', () => {
    expect(scopedActiveWorkspaceCount()).toBe(
      globalWorkspaceManager.list().size
    );
  });
});
