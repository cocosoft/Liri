// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2（2026-11-04，方案 §3.3）：长程任务**策略快照 / 恢复重放**的纯函数契约锁。
 *
 * 要防的漂移（真机场景）：任务跑到一半，用户把会话权限模式从 `strict` 改成 `bypass`
 * ⇒ 后续步骤突然全自动放行；或任务恢复时读到"当前会话设置"而不是"任务启动时的设置"。
 *
 * 本用例锁四组不变量：
 *   ① 采集：脏值归一（9 档白名单 / 审批两值 / 根过滤去重），缺失 `permissionMode` 不伪造；
 *   ② 恢复：不可信 checkpoint 严格校验，结构不合法 ⇒ `undefined`（不猜）；
 *   ③ 重放：**只收紧不放宽**（快照更严用快照；当前更严保留当前；根只做交集；空交集不写）；
 *   ④ 降级：无快照 ⇒ 保守 `ask`，但不把已更严的档位放宽。
 */

import { describe, it, expect } from 'bun:test';
import {
  capturePolicySnapshot,
  POLICY_SNAPSHOT_VERSION,
  resolvePolicyReplay,
  restorePolicySnapshot,
  type TaskPolicySnapshot,
} from '../../src/tasks/lro/policySnapshot.js';

const IS_WIN = process.platform === 'win32';
const PRIMARY = IS_WIN ? 'D:\\work\\app' : '/work/app';
const SECOND = IS_WIN ? 'E:\\shared\\libs' : '/shared/libs';
const THIRD = IS_WIN ? 'F:\\grants' : '/grants';

function snapshot(
  overrides: Partial<TaskPolicySnapshot> = {}
): TaskPolicySnapshot {
  return {
    version: POLICY_SNAPSHOT_VERSION,
    capturedAt: 1_700_000_000_000,
    approvalMode: 'ask',
    workspaceRoots: [PRIMARY],
    commandPolicyVersion: 'v1',
    ...overrides,
  };
}

describe('P2：策略快照采集', () => {
  it('合法值原样归一；缺失 permissionMode ⇒ 不写该字段（= 当时无会话覆盖）', () => {
    const s = capturePolicySnapshot(
      {
        permissionMode: ' STRICT ',
        approvalMode: 'auto-local',
        workspaceRoots: [PRIMARY, SECOND],
      },
      123
    );
    expect(s.version).toBe(POLICY_SNAPSHOT_VERSION);
    expect(s.capturedAt).toBe(123);
    expect(s.permissionMode).toBe('strict');
    expect(s.approvalMode).toBe('auto-local');
    expect(s.workspaceRoots).toEqual([PRIMARY, SECOND]);
    expect(typeof s.commandPolicyVersion).toBe('string');
  });

  it('根去重按"去尾斜杠 + 小写"归一（值保持原样，只影响是否重复收录）', () => {
    const sep = IS_WIN ? '\\' : '/';
    const s = capturePolicySnapshot({
      workspaceRoots: [PRIMARY, `${PRIMARY}${sep}`, `${SECOND}${sep}`],
    });
    expect(s.workspaceRoots).toHaveLength(2);
  });

  it('脏值：模式非法 ⇒ 丢弃；审批非 auto-local ⇒ ask；根过滤空串/非字符串并去重', () => {
    const s = capturePolicySnapshot({
      permissionMode: 'turbo',
      approvalMode: 'yolo',
      workspaceRoots: [PRIMARY, PRIMARY, '', '   ', 42, null, SECOND],
    });
    expect(s.permissionMode).toBeUndefined();
    expect(s.approvalMode).toBe('ask');
    expect(s.workspaceRoots).toEqual([PRIMARY, SECOND]);
  });
});

describe('P2：快照恢复（不可信输入）', () => {
  it('结构合法 ⇒ 还原（含版本/时间戳/策略版本）', () => {
    const restored = restorePolicySnapshot(snapshot({ permissionMode: 'ask' }));
    expect(restored).toEqual(snapshot({ permissionMode: 'ask' }));
  });

  it('缺失 / 版本不符 / 关键字段类型错 / 审批值非法 / 权限模式非法 ⇒ undefined', () => {
    expect(restorePolicySnapshot(undefined)).toBeUndefined();
    expect(restorePolicySnapshot(null)).toBeUndefined();
    expect(restorePolicySnapshot('x')).toBeUndefined();
    expect(
      restorePolicySnapshot({ ...snapshot(), version: 99 })
    ).toBeUndefined();
    expect(
      restorePolicySnapshot({ ...snapshot(), capturedAt: 'yesterday' })
    ).toBeUndefined();
    expect(
      restorePolicySnapshot({ ...snapshot(), approvalMode: 'yolo' })
    ).toBeUndefined();
    expect(
      restorePolicySnapshot({ ...snapshot(), permissionMode: 'turbo' })
    ).toBeUndefined();
    expect(
      restorePolicySnapshot({ ...snapshot(), commandPolicyVersion: 7 })
    ).toBeUndefined();
  });

  it('根列表脏值不使整份快照作废（只过滤条目）', () => {
    const restored = restorePolicySnapshot({
      ...snapshot(),
      workspaceRoots: [PRIMARY, 42, ''],
    });
    expect(restored?.workspaceRoots).toEqual([PRIMARY]);
  });
});

describe('P2：恢复重放（只收紧不放宽）', () => {
  it('任务启动 strict，用户中途改 bypass ⇒ 重放回 strict（核心防漂移）', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ permissionMode: 'strict' }),
      current: { permissionMode: 'bypass', approvalMode: 'ask' },
    });
    expect(replay.degraded).toBe(false);
    expect(replay.patch.permissionMode).toBe('strict');
  });

  it('任务启动 bypass，用户后来收紧成 strict ⇒ 保留 strict（不把用户收紧顶回去）', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ permissionMode: 'bypass' }),
      current: { permissionMode: 'strict' },
    });
    expect(replay.patch.permissionMode).toBeUndefined();
    expect(replay.notes.join()).toContain('keep-current');
  });

  it('同档位取快照（任务启动姿态优先）：auto → acceptEdits 都属 permissive', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ permissionMode: 'auto' }),
      current: { permissionMode: 'acceptEdits' },
    });
    expect(replay.patch.permissionMode).toBe('auto');
  });

  it('当前无会话覆盖 + 快照为 permissive ⇒ 不写（不把进程默认档抬成自动放行）', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ permissionMode: 'bypass' }),
      current: {},
    });
    expect(replay.patch.permissionMode).toBeUndefined();
  });

  it('审批模式：只要有一侧是 ask ⇒ 写 ask（auto-local 属放宽档）', () => {
    expect(
      resolvePolicyReplay({
        snapshot: snapshot({ approvalMode: 'ask' }),
        current: { approvalMode: 'auto-local' },
      }).patch.approvalMode
    ).toBe('ask');
    expect(
      resolvePolicyReplay({
        snapshot: snapshot({ approvalMode: 'auto-local' }),
        current: { approvalMode: 'ask' },
      }).patch.approvalMode
    ).toBeUndefined(); // 当前已是更严的 ask，无需改写
    expect(
      resolvePolicyReplay({
        snapshot: snapshot({ approvalMode: 'auto-local' }),
        current: { approvalMode: 'auto-local' },
      }).patch.approvalMode
    ).toBeUndefined();
  });

  it('工作区额外根只做交集：用户删掉的根不会被快照重新授予', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ workspaceRoots: [PRIMARY, SECOND] }),
      current: { workspaceRoots: [PRIMARY, THIRD] },
    });
    // SECOND 已不在当前根内，THIRD 也不在快照内 ⇒ 额外根清空（只剩主根 PRIMARY）
    expect(replay.patch.workspaceRoots).toEqual([]);
  });

  it('保留仍在两侧的额外根，删掉快照未授予的（只收窄，不新增）', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ workspaceRoots: [PRIMARY, SECOND] }),
      current: { workspaceRoots: [PRIMARY, SECOND, THIRD] },
    });
    // SECOND 在快照内 ⇒ 保留；THIRD 是任务启动后才加的 ⇒ 收紧掉
    expect(replay.patch.workspaceRoots).toEqual([SECOND]);
  });

  it('当前无任何根 ⇒ 不写（无主根时写空等于"无边界"，不能碰）', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ workspaceRoots: [PRIMARY, SECOND] }),
      current: { workspaceRoots: [] },
    });
    expect(replay.patch.workspaceRoots).toBeUndefined();
  });

  it('额外根完全一致 ⇒ 不写（避免无意义的元数据 churn）', () => {
    const replay = resolvePolicyReplay({
      snapshot: snapshot({ workspaceRoots: [PRIMARY, SECOND] }),
      current: { workspaceRoots: [PRIMARY, SECOND] },
    });
    expect(replay.patch.workspaceRoots).toBeUndefined();
  });
});

describe('P2：缺快照的保守降级', () => {
  it('无快照 ⇒ 审批档 ask，权限模式压到 ask（默认/放宽档）', () => {
    const replay = resolvePolicyReplay({
      snapshot: undefined,
      current: { permissionMode: 'bypass', approvalMode: 'auto-local' },
    });
    expect(replay.degraded).toBe(true);
    expect(replay.patch.permissionMode).toBe('ask');
    expect(replay.patch.approvalMode).toBe('ask');
  });

  it('无快照但当前已是更严的档（strict/dontAsk）⇒ 不写权限模式（不放宽）', () => {
    for (const mode of ['strict', 'alwaysAsk', 'ask', 'dontAsk', 'plan']) {
      const replay = resolvePolicyReplay({
        snapshot: undefined,
        current: { permissionMode: mode },
      });
      expect(replay.patch.permissionMode).toBeUndefined();
    }
  });
});
