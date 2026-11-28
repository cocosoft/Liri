// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 计划执行轮的文件回滚录制（2026-11-28）
 *
 * 背景（真机取证）：PDCA / 计划步骤写文件时 `RollbackIntegration` 打
 * 「onToolBeforeExecute 在 onRoundStart 之前调用，跳过追踪」（`output/image_explanation.md`、
 * `output/pelican_bicycle.svg`）⇒ 没有 pre-image、没有快照，`/rewind` 不可恢复。
 *
 * 本组钉住新链路（真 fs、真快照，不用 mock）：
 *  ① 计划轮开始后，chat 侧 `trackFileOpBeforeExecute` 的写入记到**计划轮**（带 planId/stepId），
 *    轮末落 manifest、`backupPath` 指向轮初内容 ⇒ undo 能恢复；
 *  ② 轮结束后活动登记清理 ⇒ 不会把后续写入继续记到已结束的轮；
 *  ③ 本轮无文件变更 ⇒ 不写 manifest（读侧按"没有"处理，不产生告警噪音）；
 *  ④ `runWithPlanFileRound`：被包函数抛错也保证收尾（`finally`）；
 *  ⑤ 基线/增量扫描共同跳过 `node_modules` 等生成目录（对称口径），且不误记其中的新文件；
 *  ⑥ 撤消时**无快照的轮直接跳过**（轮号连续分配，空轮不是失败）；
 *  ⑦ 无会话集成 ⇒ 不产生任何撤消结果（不臆造）；
 *  ⑧/⑨ LRO 步骤直调 `tool.execute` 的写前追踪：无活动轮 no-op、有活动轮落 pre-image。
 *
 * 隔离：`LIRI_HOME` 指向临时目录（快照根 = `<home>/data/snapshots`），跑完还原。
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearPlanRounds,
  getPlanRoundIntegration,
  listSessionSnapshots,
  RollbackIntegration,
} from '@openliri/infra/security';
import {
  beginPlanFileRound,
  endPlanFileRound,
  runWithPlanFileRound,
} from '../../src/tasks/planRoundRecorder';
import { trackFileOpBeforeExecute } from '../../src/chat/services/rollbackTracker';
// LRO/PDCA 步骤直调 `tool.execute`，写前追踪由本模块补（不经过 chat 执行服务）
import { trackPlanWriteBeforeExecute } from '../../src/tasks/lro/planWriteTracking';
import { ChatRollback } from '../../src/chat/manager/rollback';

let home = '';
let savedHome: string | undefined;
let ws = '';

beforeAll(() => {
  savedHome = process.env['LIRI_HOME'];
  home = mkdtempSync(join(tmpdir(), 'liri-plan-round-'));
  process.env['LIRI_HOME'] = home;
  ws = join(home, 'ws');
  mkdirSync(ws, { recursive: true });
});

afterAll(() => {
  if (savedHome === undefined) delete process.env['LIRI_HOME'];
  else process.env['LIRI_HOME'] = savedHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  clearPlanRounds();
});

/** chat 侧追踪器的最小依赖（回滚集成表为空 ⇒ 优先级完全由活动计划轮决定） */
function trackerDeps(runningStep: { planId: string; stepId: string } | null) {
  return {
    rollbackIntegrations: new Map<string, RollbackIntegration>(),
    getSession: async () => null,
    getRunningStep: () => runningStep,
  };
}

describe('计划执行轮：非聊天路径的写入被录制', () => {
  it('① 计划轮写文件 ⇒ 落快照（带 planId/stepId）+ pre-image 可恢复', async () => {
    const sid = `s-plan-round-${Date.now()}`;
    const file = join(ws, 'output-image_explanation.md');
    writeFileSync(file, '轮初内容', 'utf8');

    const roundId = await beginPlanFileRound(sid, [ws]);
    expect(roundId).not.toBeNull();
    expect(getPlanRoundIntegration(sid)).toBeDefined();

    await trackFileOpBeforeExecute({
      toolCall: { id: 'tc-1', name: 'file_write', sessionId: sid },
      args: { file_path: file },
      deps: trackerDeps({ planId: 'plan_1', stepId: 'step_1' }),
    });
    // 模拟工具真实写入
    writeFileSync(file, '轮末内容', 'utf8');

    await endPlanFileRound(sid, '画图步骤');
    expect(getPlanRoundIntegration(sid)).toBeUndefined();

    const snapshots = await listSessionSnapshots(sid);
    expect(snapshots.length).toBe(1);
    const change = snapshots[0]!.changedFiles.find((c) => c.path === file);
    expect(change?.planId).toBe('plan_1');
    expect(change?.stepId).toBe('step_1');
    expect(change?.backupPath).toBeTruthy();
    expect(readFileSync(change!.backupPath!, 'utf8')).toBe('轮初内容');
    expect(snapshots[0]!.totalSize).toBeGreaterThan(0);

    // 真 undo：内容回到轮初
    const integ = new RollbackIntegration(sid);
    const res = await integ.undoRound(roundId!);
    expect(res.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('轮初内容');
  });

  it('② 轮结束后登记清理 ⇒ 后续写入不再记到该轮', async () => {
    const sid = `s-plan-round-clear-${Date.now()}`;
    const file = join(ws, 'after.md');
    writeFileSync(file, 'v1', 'utf8');

    await beginPlanFileRound(sid, [ws]);
    expect(getPlanRoundIntegration(sid)).toBeDefined();
    await endPlanFileRound(sid, '空轮');
    expect(getPlanRoundIntegration(sid)).toBeUndefined();

    // 无活动轮、聊天集成表为空 ⇒ 追踪器只 warn 不抛（行为与改动前一致）
    await trackFileOpBeforeExecute({
      toolCall: { id: 'tc-2', name: 'file_edit', sessionId: sid },
      args: { file_path: file },
      deps: trackerDeps(null),
    });
    const snapshots = await listSessionSnapshots(sid);
    expect(snapshots.length).toBe(0);
  });

  it('③ 本轮无文件变更 ⇒ 不写 manifest', async () => {
    const sid = `s-plan-round-empty-${Date.now()}`;
    await beginPlanFileRound(sid, [ws]);
    await endPlanFileRound(sid, '纯读步骤');
    expect(await listSessionSnapshots(sid)).toEqual([]);
  });

  it('④ runWithPlanFileRound：fn 抛错也保证收尾（finally）', async () => {
    const sid = `s-plan-round-throw-${Date.now()}`;
    await expect(
      runWithPlanFileRound(sid, [ws], '失败 run', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(getPlanRoundIntegration(sid)).toBeUndefined();
  });

  it('⑤ 基线/增量扫描共同跳过 node_modules（对称），不误记其中新文件', async () => {
    const sid = `s-plan-round-skip-${Date.now()}`;
    const ws2 = join(home, 'ws-skip');
    mkdirSync(join(ws2, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(ws2, 'node_modules', 'pkg', 'a.js'), 'a', 'utf8');

    await beginPlanFileRound(sid, [ws2]);
    // 轮内：生成目录里的新文件 + 工作区正常新文件
    writeFileSync(join(ws2, 'node_modules', 'pkg', 'b.js'), 'b', 'utf8');
    writeFileSync(join(ws2, 'fresh.txt'), 'fresh', 'utf8');
    await endPlanFileRound(sid, '写产物');

    const snapshots = await listSessionSnapshots(sid);
    const paths = snapshots[0]!.changedFiles.map((c) => c.path);
    expect(paths.some((p) => p.endsWith('node_modules\\pkg\\b.js'))).toBe(
      false
    );
    expect(paths.some((p) => p.endsWith('node_modules/pkg/b.js'))).toBe(false);
    expect(paths.some((p) => p.endsWith('fresh.txt'))).toBe(true);
  });
});

describe('LRO 步骤写前追踪（直调 tool.execute 的路径）', () => {
  it('⑧ 无活动计划轮 ⇒ no-op（不抛，也不产生快照）', async () => {
    const sid = `s-plan-write-noop-${Date.now()}`;
    const file = join(ws, 'noop.txt');
    writeFileSync(file, 'v1', 'utf8');

    await trackPlanWriteBeforeExecute({
      sessionId: sid,
      path: file,
      toolName: 'file_write',
      planId: 'plan_x',
      stepId: 'step_x',
    });
    expect(getPlanRoundIntegration(sid)).toBeUndefined();
    expect(await listSessionSnapshots(sid)).toEqual([]);
  });

  it('⑨ 有活动计划轮 ⇒ 写前登记 pre-image（undo 能恢复轮初内容）', async () => {
    const sid = `s-plan-write-pre-${Date.now()}`;
    const file = join(ws, 'lro-output.md');
    writeFileSync(file, '轮初', 'utf8');

    const roundId = await beginPlanFileRound(sid, [ws]);
    await trackPlanWriteBeforeExecute({
      sessionId: sid,
      path: file,
      toolName: 'file_write',
      planId: 'plan_lro',
      stepId: 'step_lro',
    });
    writeFileSync(file, '轮末', 'utf8');
    await endPlanFileRound(sid, 'LRO 步骤');

    const snapshots = await listSessionSnapshots(sid);
    const change = snapshots[0]!.changedFiles.find((c) => c.path === file);
    expect(change?.planId).toBe('plan_lro');
    expect(change?.stepId).toBe('step_lro');
    expect(readFileSync(change!.backupPath!, 'utf8')).toBe('轮初');

    const integ = new RollbackIntegration(sid);
    const res = await integ.undoRound(roundId!);
    expect(res.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('轮初');
  });
});

describe('撤消：无快照的轮直接跳过（不算失败）', () => {
  it('⑥ 轮号 1/3 有快照、2 无快照 ⇒ 全部 success 且无 error', async () => {
    const sid = `s-plan-undo-gap-${Date.now()}`;
    const file = join(ws, 'gap.txt');
    writeFileSync(file, 'v1', 'utf8');

    // 轮 1 + 轮 3 各写一次；轮 2 故意不建（模拟"本轮无变更"）
    for (const roundId of [1, 3]) {
      const integ = new RollbackIntegration(sid);
      await integ.onRoundStart(sid, roundId, [ws]);
      await integ.onToolBeforeExecute({
        path: file,
        type: 'modified',
        toolName: 'file_edit',
      });
      writeFileSync(file, `v${roundId + 1}`, 'utf8');
      await integ.onRoundEnd(`轮 ${roundId}`);
    }

    const rollback = new ChatRollback({
      getPendingInteractions: () => new Map(),
      getMessageService: () => {
        throw new Error('本用例不涉及消息服务');
      },
      addAndPersistMessage: async () => {},
      getRollbackIntegrations: () =>
        new Map<string, RollbackIntegration>([
          [sid, new RollbackIntegration(sid)],
        ]),
      getPermissionManager: () => null,
      getSessionGateway: () => {
        throw new Error('本用例不涉及会话网关');
      },
    });

    const results = await rollback.undoRoundsSince(sid, 0, 3, {});
    expect(results.map((r) => r.roundId)).toEqual([3, 2, 1]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.some((r) => r.error)).toBe(false);
  });

  it('⑦ 未开始的会话（无集成）⇒ 不产生任何结果', async () => {
    const rollback = new ChatRollback({
      getPendingInteractions: () => new Map(),
      getMessageService: () => {
        throw new Error('本用例不涉及消息服务');
      },
      addAndPersistMessage: async () => {},
      getRollbackIntegrations: () => new Map(),
      getPermissionManager: () => null,
      getSessionGateway: () => {
        throw new Error('本用例不涉及会话网关');
      },
    });
    expect(await rollback.undoRoundsSince('nope', 0, 3, {})).toEqual([]);
    expect(existsSync(join(ws, 'gap.txt'))).toBe(true);
  });
});
