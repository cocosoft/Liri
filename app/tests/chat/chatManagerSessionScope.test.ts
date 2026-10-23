/**
 * ChatManager「当前会话」按请求身份分桶（多租户 P0 阶段 2）
 *
 * 改造前的 `_currentSessionId` 是**进程级单字段**：服务端并发用户共用一格
 * （A 打开会话会改掉 B 的"当前会话"）。现改为 `Map<principalKey, sessionId>`。
 *
 * 锁三件事：
 *  ① 两个已认证身份各存各的，互不覆盖；
 *  ② 本地身份（桌面/CLI/后台）仍是单桶 ⇒ 与改造前**完全等价**；
 *  ③ 置 `null` 只清当前身份的桶，不影响其他身份。
 *
 * 白盒说明：用 `Object.create(prototype)` 构造实例（字段初始化器不执行），
 * 因此这里同时验证了 setter 的惰性建 Map。
 */
import { describe, expect, it } from 'bun:test';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import { ChatManagerImpl } from '../../src/chat/ChatManager.js';

const ALICE: Principal = {
  tenantId: 'acme',
  userId: 'alice',
  roles: ['auditor'],
};
const BOB: Principal = {
  tenantId: 'acme',
  userId: 'bob',
  roles: ['admin'],
};

interface SessionSeam {
  _currentSessionId: string | null;
}

function makeSeam(): SessionSeam {
  const mgr = Object.create(ChatManagerImpl.prototype) as ChatManagerImpl;
  return mgr as unknown as SessionSeam;
}

describe('ChatManager 当前会话：按身份分桶', () => {
  it('两个身份各存各的，互不覆盖', () => {
    const seam = makeSeam();
    runWithPrincipal(ALICE, () => {
      seam._currentSessionId = 's-alice';
    });
    runWithPrincipal(BOB, () => {
      seam._currentSessionId = 's-bob';
    });

    expect(runWithPrincipal(ALICE, () => seam._currentSessionId)).toBe(
      's-alice'
    );
    expect(runWithPrincipal(BOB, () => seam._currentSessionId)).toBe('s-bob');
    // 本地身份未写过 ⇒ null（不再被"最后登录的用户"污染）
    expect(seam._currentSessionId).toBeNull();
  });

  it('本地身份单桶 ⇒ 与改造前等价', () => {
    const seam = makeSeam();
    expect(seam._currentSessionId).toBeNull();
    seam._currentSessionId = 's-local';
    expect(seam._currentSessionId).toBe('s-local');
  });

  it('置 null 只清当前身份的桶', () => {
    const seam = makeSeam();
    runWithPrincipal(ALICE, () => {
      seam._currentSessionId = 's-alice';
    });
    runWithPrincipal(BOB, () => {
      seam._currentSessionId = 's-bob';
    });

    runWithPrincipal(ALICE, () => {
      seam._currentSessionId = null;
    });

    expect(runWithPrincipal(ALICE, () => seam._currentSessionId)).toBeNull();
    expect(runWithPrincipal(BOB, () => seam._currentSessionId)).toBe('s-bob');
  });
});
