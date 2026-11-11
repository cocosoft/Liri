/**
 * CoreAPIImpl.updateSessionMeta — 会话置顶（M1-T1.3）契约锁定
 * P4b（2026-10-16）：`toolProfile` 写入口
 *
 * 核心不变量：
 *   ① pinned-only 更新**不 touch updatedAt**（列表不因置顶操作重排）
 *   ② meta 字段（model/workspaceId/providerId/tasksOverride）更新 touch updatedAt
 *   ③ pinned 与 meta 字段同时更新时 updatedAt 刷新（pinned 不抑制 touch）
 *   ④ 内存 session 与 gateway 持久层双侧同步写入 pinned
 *   ⑤ 会话不在内存（未持久化）时不抛错
 *   ⑥ `toolProfile`（配置类字段）内存 + 存储**双侧**同步写入且 touch updatedAt
 *      —— 修复前该字段只有读方、无写方（TG-4 死入口），且存储侧 `SessionMetadata`
 *      副本缺字段 ⇒ 落库时被静默丢弃
 */

import { describe, it, expect } from 'bun:test';
import { AppError } from '@openliri/kernel';
import {
  AUTONOMY_PERMISSION_CONFLICT,
  resolveEffectiveAutonomyPermission,
} from '@openliri/infra/permission';
import { CoreAPIImpl } from '../../src/runtime/api/CoreAPIImpl.js';

type CoreAPIOptions = NonNullable<ConstructorParameters<typeof CoreAPIImpl>[0]>;
type ChatManagerLike = NonNullable<CoreAPIOptions['chatManager']>;

interface FakeSession {
  id: string;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

function makeFixture(persisted: boolean) {
  const memSession: FakeSession = {
    id: 'sess-1',
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    metadata: { title: 't' },
  };
  const storedSession: FakeSession = {
    id: 'sess-1',
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    metadata: { title: 't' },
  };
  const updateSessionCalls: FakeSession[] = [];
  const chatManager = {
    getSessions: () => (persisted ? [memSession] : []),
    getSessionManager: () => ({}),
    getSessionGateway: () =>
      persisted
        ? {
            getSession: async () => storedSession,
            updateSession: async (s: FakeSession) => {
              updateSessionCalls.push(s);
            },
          }
        : null,
  };

  const api = new CoreAPIImpl({
    chatManager: chatManager as unknown as ChatManagerLike,
  });
  return { api, memSession, storedSession, updateSessionCalls };
}

describe('CoreAPIImpl.updateSessionMeta 置顶契约（M1-T1.3）', () => {
  it('① pinned-only 更新：metadata.pinned 翻转且 updatedAt 不变', async () => {
    const { api, memSession, storedSession, updateSessionCalls } =
      makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { pinned: true });

    expect(memSession.metadata.pinned).toBe(true);
    expect(memSession.updatedAt.getTime()).toBe(before);
    expect(updateSessionCalls.length).toBe(1);
    expect(storedSession.metadata.pinned).toBe(true);
    expect(storedSession.updatedAt.getTime()).toBe(before);
  });

  it('② meta 字段（model）更新：updatedAt 刷新', async () => {
    const { api, memSession } = makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { model: 'm-1' });

    expect(memSession.metadata.model).toBe('m-1');
    expect(memSession.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('③ pinned=false 明确取消：pinned 置 false 且 updatedAt 不变', async () => {
    const { api, memSession } = makeFixture(true);
    memSession.metadata.pinned = true;
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { pinned: false });

    expect(memSession.metadata.pinned).toBe(false);
    expect(memSession.updatedAt.getTime()).toBe(before);
  });

  it('④ pinned + model 同时更新：updatedAt 刷新（pinned 不抑制 touch）', async () => {
    const { api, memSession } = makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { pinned: true, model: 'm-1' });

    expect(memSession.metadata.pinned).toBe(true);
    expect(memSession.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('⑤ 会话不在内存（未持久化）：不抛错、静默跳过', async () => {
    const { api } = makeFixture(false);
    await api.updateSessionMeta('sess-missing', { pinned: true });
  });

  it('⑥ toolProfile：内存 + 存储双侧同步写入，且 touch updatedAt', async () => {
    const { api, memSession, storedSession, updateSessionCalls } =
      makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { toolProfile: ['media'] });

    // 内存侧
    expect(memSession.metadata.toolProfile).toEqual(['media']);
    // 配置类字段 ⇒ touch updatedAt（同 workMode 口径）
    expect(memSession.updatedAt.getTime()).toBeGreaterThan(before);
    // 存储侧（缺此行即为"落库时被静默丢弃"的复发形态）
    expect(updateSessionCalls.length).toBe(1);
    expect(storedSession.metadata.toolProfile).toEqual(['media']);
  });

  it('⑦ toolProfile=[]（显式清空）：写空数组而非跳过（与 undefined 区分）', async () => {
    const { api, memSession, storedSession } = makeFixture(true);
    memSession.metadata.toolProfile = ['media'];
    storedSession.metadata.toolProfile = ['media'];

    await api.updateSessionMeta('sess-1', { toolProfile: [] });

    expect(memSession.metadata.toolProfile).toEqual([]);
    expect(storedSession.metadata.toolProfile).toEqual([]);
  });

  /**
   * P1（2026-11-04，UI 第三层）：会话级权限模式写入口。
   * 落库键是 `permission_mode`（snake_case，与 `ChatManager.getSessionPermissionMode` 同一契约）。
   */
  it('⑧ permissionMode：内存 + 存储双侧写 permission_mode，且 touch updatedAt', async () => {
    const { api, memSession, storedSession, updateSessionCalls } =
      makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { permissionMode: 'dontAsk' });

    expect(memSession.metadata.permission_mode).toBe('dontAsk');
    expect(memSession.updatedAt.getTime()).toBeGreaterThan(before);
    expect(updateSessionCalls.length).toBe(1);
    expect(storedSession.metadata.permission_mode).toBe('dontAsk');
  });

  it('⑨ permissionMode=null：清除会话覆盖（删键 ⇒ 判定回退进程默认档）', async () => {
    const { api, memSession, storedSession } = makeFixture(true);
    memSession.metadata.permission_mode = 'bypass';
    storedSession.metadata.permission_mode = 'bypass';

    await api.updateSessionMeta('sess-1', { permissionMode: null });

    expect('permission_mode' in memSession.metadata).toBe(false);
    expect('permission_mode' in storedSession.metadata).toBe(false);
  });

  it('⑩ permissionMode 未传：不动既有值（undefined ≠ 清除）', async () => {
    const { api, memSession, storedSession } = makeFixture(true);
    memSession.metadata.permission_mode = 'plan';
    storedSession.metadata.permission_mode = 'plan';

    await api.updateSessionMeta('sess-1', { model: 'm-2' });

    expect(memSession.metadata.permission_mode).toBe('plan');
    expect(storedSession.metadata.permission_mode).toBe('plan');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2026-11-11：自主度（许愿式）× 权限档一致性 —— 写入口 fail loud
//
// 不变量：许愿式承诺"中途最多问一次"，与 plan（每步确认；收缩前的 ask / alwaysAsk 已并入）
// 互斥；dontAsk（直接拒绝，不产生询问）与 bypass（全放行）允许。
// 校验必须发生在**任何写入之前**，失败不留半写状态。
// ───────────────────────────────────────────────────────────────────────────

type MetaPatch = Parameters<CoreAPIImpl['updateSessionMeta']>[1];

/** 断言该 meta 被拒绝，且 code 稳定（返回错误供进一步断言） */
async function expectConflict(
  api: CoreAPIImpl,
  meta: MetaPatch
): Promise<AppError> {
  let caught: unknown;
  try {
    await api.updateSessionMeta('sess-1', meta);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AppError);
  const appError = caught as AppError;
  expect(appError.code).toBe(AUTONOMY_PERMISSION_CONFLICT);
  return appError;
}

describe('updateSessionMeta：许愿式 × 权限档冲突校验', () => {
  it('① 同一请求写 demand + plan：拒绝，且内存 / 存储零写入', async () => {
    const { api, memSession, storedSession, updateSessionCalls } =
      makeFixture(true);
    const before = memSession.updatedAt.getTime();

    const err = await expectConflict(api, {
      autonomy: 'demand',
      permissionMode: 'plan',
    });

    // 错误信息必须给出两个值 + 可执行修复（否则调用方只能猜）
    expect(err.message).toContain('demand');
    expect(err.message).toContain('plan');
    expect(err.message).toContain('interactive');
    // 半写状态禁止：内存、落盘、updatedAt 全部未动
    expect(memSession.metadata.autonomy).toBeUndefined();
    expect(memSession.metadata.permission_mode).toBeUndefined();
    expect(storedSession.metadata.permission_mode).toBeUndefined();
    expect(memSession.updatedAt.getTime()).toBe(before);
    expect(updateSessionCalls.length).toBe(0);
  });

  it('② 仅写 autonomy=demand，而会话现值为 plan：拒绝（继承值参与判定）', async () => {
    const { api, memSession } = makeFixture(true);
    memSession.metadata.permission_mode = 'plan';

    await expectConflict(api, { autonomy: 'demand' });

    expect(memSession.metadata.autonomy).toBeUndefined();
  });

  it('③ 仅写 permission_mode=plan，而会话现值 autonomy=demand：拒绝（反向继承）', async () => {
    const { api, memSession } = makeFixture(true);
    memSession.metadata.autonomy = 'demand';

    await expectConflict(api, { permissionMode: 'plan' });
  });

  it('④ 允许集：dontAsk / bypass / auto / default 与 demand 共存', async () => {
    for (const mode of ['dontAsk', 'bypass', 'auto', 'default'] as const) {
      const { api, memSession } = makeFixture(true);
      await api.updateSessionMeta('sess-1', {
        autonomy: 'demand',
        permissionMode: mode,
      });
      expect(memSession.metadata.autonomy).toBe('demand');
      expect(memSession.metadata.permission_mode).toBe(mode);
    }
  });

  it('⑤ 清除覆盖（permissionMode=null）+ demand：允许，并删键回退进程默认档', async () => {
    const { api, memSession, storedSession } = makeFixture(true);
    // 历史脏组合：demand × plan（校验上线前写入的数据）
    memSession.metadata.autonomy = 'demand';
    memSession.metadata.permission_mode = 'plan';
    storedSession.metadata.autonomy = 'demand';
    storedSession.metadata.permission_mode = 'plan';

    await api.updateSessionMeta('sess-1', { permissionMode: null });

    expect('permission_mode' in memSession.metadata).toBe(false);
    expect('permission_mode' in storedSession.metadata).toBe(false);
    expect(memSession.metadata.autonomy).toBe('demand');
  });

  it('⑥ 只改无关字段时不校验历史脏组合（不能连带锁死改名/置顶）', async () => {
    const { api, memSession } = makeFixture(true);
    memSession.metadata.autonomy = 'demand';
    memSession.metadata.permission_mode = 'plan';

    await api.updateSessionMeta('sess-1', { model: 'm-3' });

    expect(memSession.metadata.model).toBe('m-3');
    expect(memSession.metadata.permission_mode).toBe('plan');
  });

  it('⑦ interactive + 每步确认：不触发冲突校验', async () => {
    for (const mode of ['plan'] as const) {
      const { api, memSession } = makeFixture(true);
      await api.updateSessionMeta('sess-1', {
        autonomy: 'interactive',
        permissionMode: mode,
      });
      expect(memSession.metadata.permission_mode).toBe(mode);
    }
  });

  it('⑧ 解析口径：请求值优先 / null 清除 / 缺省继承会话现值', () => {
    expect(
      resolveEffectiveAutonomyPermission({
        currentAutonomy: 'demand',
        currentPermissionMode: 'plan',
        nextAutonomy: 'interactive',
      })
    ).toEqual({ autonomy: 'interactive', permissionMode: 'plan' });

    expect(
      resolveEffectiveAutonomyPermission({
        currentAutonomy: 'demand',
        currentPermissionMode: 'ask',
        nextPermissionMode: null,
      })
    ).toEqual({ autonomy: 'demand', permissionMode: undefined });

    expect(
      resolveEffectiveAutonomyPermission({
        currentAutonomy: 'demand',
        currentPermissionMode: 'auto',
        nextAutonomy: 'demand',
      })
    ).toEqual({ autonomy: 'demand', permissionMode: 'auto' });
  });
});
