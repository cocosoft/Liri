// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * §60.4②（2026-11-10）：escalate 收尾的「同一缺陷重复 N 次即终止」闸门。
 *
 * 背景：`dev_docs/20261107/权限与沙箱拉通方案-20261107.md` §60.4 建议②——此前同一缺陷
 * 会一路重试到 `maxReplan` / `maxIteration` 才收场，用户只看到百分比来回跳。
 *
 * 本用例锁定三件事：
 *   1. 缺陷指纹口径（归一 + 排序 + 去重摘要）稳定，且"不同缺陷"不会误合并；
 *   2. 连续重复计数与阈值（脏值回落默认 2，下限 2）；
 *   3. `finalizeEscalation` 的检查点落盘 + 早停语义（replanPending=false / stopReason）。
 *
 * 以 `LIRI_DATA_DIR` 隔离临时库，避免污染真实 `app.db`。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'pdca-defect-repeat-'));
process.env.LIRI_DATA_DIR = dataDir;
// 本文件只验证默认值与显式注入；清掉外部残留，避免本机环境变量影响口径
delete process.env.PDCA_DEFECT_REPEAT_LIMIT;
delete process.env.PDCA_REPLAN_MAX_RETRIES;

const {
  buildDefectSignature,
  decideDefectRepeat,
  defectRepeatLimit,
  finalizeEscalation,
} = await import('../../src/tasks/lro/escalationFinalize.js');
const { readPdcaCheckpoint, writePdcaCheckpoint, closePdcaCheckpointStore } =
  await import('../../src/tasks/PdcaWorkItemBridge');

afterAll(async () => {
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  // Windows：sqlite 句柄关闭是异步回调，`rm` 可能仍 EBUSY ⇒ 清不掉就留给 OS 临时目录
  await new Promise((r) => setTimeout(r, 100));
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // @ignore-catch — 临时目录清理失败不影响断言（本文件所有断言已完成）
  }
});

describe('buildDefectSignature — 缺陷指纹', () => {
  it('无缺陷 / 空字符串 ⇒ null（无法判定"同一缺陷"⇒ 不早停）', () => {
    expect(buildDefectSignature([])).toBeNull();
    expect(buildDefectSignature([{ defects: [] }])).toBeNull();
    expect(buildDefectSignature([{ defects: ['', '   '] }])).toBeNull();
    expect(buildDefectSignature([{}])).toBeNull();
  });

  it('空白折叠 + 排序 ⇒ 同样的缺陷集合指纹一致', () => {
    const a = buildDefectSignature([
      { defects: ['[major] 产物缺失', '[minor] 链接错误'] },
    ]);
    const b = buildDefectSignature([
      { defects: ['[minor]   链接错误 ', '[major] 产物缺失'] },
    ]);
    expect(a?.signature).toBe(b?.signature as string);
  });

  it('缺陷不同 ⇒ 指纹不同；摘要去重且最多 3 条', () => {
    const a = buildDefectSignature([{ defects: ['[major] 产物缺失'] }]);
    const b = buildDefectSignature([{ defects: ['[major] 产物为空'] }]);
    expect(a?.signature).not.toBe(b?.signature as string);

    const many = buildDefectSignature([
      { defects: ['d1', 'd2', 'd2', 'd3', 'd4'] },
    ]);
    expect(many?.summary).toBe('d1；d2；d3');
  });
});

describe('decideDefectRepeat — 连续重复计数', () => {
  it('无指纹 ⇒ count=0、不终止', () => {
    expect(
      decideDefectRepeat({
        signature: null,
        previousSignature: 'x',
        previousCount: 5,
        limit: 2,
      })
    ).toEqual({ count: 0, repeated: false });
  });

  it('首轮（无上轮指纹）⇒ count=1', () => {
    expect(decideDefectRepeat({ signature: 'sig-a', limit: 2 })).toEqual({
      count: 1,
      repeated: false,
    });
  });

  it('同一指纹重现 ⇒ 累加，达阈值即终止', () => {
    expect(
      decideDefectRepeat({
        signature: 'sig-a',
        previousSignature: 'sig-a',
        previousCount: 1,
        limit: 2,
      })
    ).toEqual({ count: 2, repeated: true });
  });

  it('指纹变化（新缺陷）⇒ 重新计数（不误杀）', () => {
    expect(
      decideDefectRepeat({
        signature: 'sig-b',
        previousSignature: 'sig-a',
        previousCount: 2,
        limit: 2,
      })
    ).toEqual({ count: 1, repeated: false });
  });

  it('脏值：previousCount 非数字 ⇒ 按首轮；limit<2 ⇒ 回落到 2', () => {
    expect(
      decideDefectRepeat({
        signature: 'sig-a',
        previousSignature: 'sig-a',
        previousCount: 'oops',
        limit: 0,
      })
    ).toEqual({ count: 1, repeated: false });
    expect(
      decideDefectRepeat({
        signature: 'sig-a',
        previousSignature: 'sig-a',
        previousCount: 1,
        limit: Number.NaN,
      })
    ).toEqual({ count: 2, repeated: true });
  });
});

describe('defectRepeatLimit — 阈值来源', () => {
  it('未设置 ⇒ 默认 2；非法 / <2 ⇒ 仍为 2；显式设置生效', () => {
    expect(defectRepeatLimit()).toBe(2);
    process.env.PDCA_DEFECT_REPEAT_LIMIT = '1';
    expect(defectRepeatLimit()).toBe(2);
    process.env.PDCA_DEFECT_REPEAT_LIMIT = 'abc';
    expect(defectRepeatLimit()).toBe(2);
    process.env.PDCA_DEFECT_REPEAT_LIMIT = '3';
    expect(defectRepeatLimit()).toBe(3);
    delete process.env.PDCA_DEFECT_REPEAT_LIMIT;
  });
});

describe('finalizeEscalation — 检查点落盘与早停', () => {
  const defects = [{ defects: ['[major] 产物缺失'] }];

  it('首轮 escalate ⇒ 挂起 replan（phase=execute、计数 1）', async () => {
    const taskId = 'ck_defect_first';
    const phases: string[] = [];
    const result = await finalizeEscalation({
      taskId,
      escalations: defects,
      setPhase: async (phase) => {
        phases.push(phase);
      },
    });
    expect(result.replanPending).toBe(true);
    expect(result.stoppedByDefectRepeat).toBe(false);
    expect(result.defectRepeatCount).toBe(1);
    expect(phases).toEqual(['execute']);

    const ck = (await readPdcaCheckpoint(taskId)) ?? {};
    expect(ck.phase).toBe('execute');
    expect(ck.replanPending).toBe(true);
    expect(ck.replanFailCount).toBe(1);
    expect(ck.defectRepeatCount).toBe(1);
    expect(typeof ck.defectSignature).toBe('string');
    expect(ck.defectSummary).toBe('[major] 产物缺失');
    expect(ck.stopReason).toBeUndefined();
  });

  it('同一缺陷第二轮 ⇒ 早停：replanPending=false、phase=failed、stopReason 落盘', async () => {
    const taskId = 'ck_defect_first';
    const result = await finalizeEscalation({
      taskId,
      escalations: defects,
      setPhase: async () => {},
    });
    expect(result.stoppedByDefectRepeat).toBe(true);
    expect(result.replanPending).toBe(false);
    expect(result.defectRepeatCount).toBe(2);
    expect(result.failureReason).toContain('PDCA_DEFECT_REPEATED');

    const ck = (await readPdcaCheckpoint(taskId)) ?? {};
    expect(ck.phase).toBe('failed');
    expect(ck.replanPending).toBe(false);
    expect(ck.stopReason).toBe('defect_repeated');
    expect(ck.replanConvergedAt).toBeTruthy();
  });

  it('缺陷变化 ⇒ 不早停，计数重置为 1（仍走 maxReplan 预算）', async () => {
    const taskId = 'ck_defect_changed';
    await writePdcaCheckpoint(taskId, {
      taskId,
      defectSignature: 'previous-signature',
      defectRepeatCount: 2,
      replanFailCount: 1,
    });
    const result = await finalizeEscalation({
      taskId,
      escalations: [{ defects: ['[major] 另一处不一致'] }],
      setPhase: async () => {},
    });
    expect(result.stoppedByDefectRepeat).toBe(false);
    expect(result.defectRepeatCount).toBe(1);
    expect(result.replanPending).toBe(true);
  });

  it('replan 预算用尽（默认 3）⇒ 即便缺陷未重复也不挂起', async () => {
    const taskId = 'ck_replan_exhausted';
    await writePdcaCheckpoint(taskId, {
      taskId,
      replanFailCount: 2,
    });
    const result = await finalizeEscalation({
      taskId,
      escalations: [{ defects: ['[major] 首次出现的缺陷'] }],
      setPhase: async () => {},
    });
    expect(result.replanPending).toBe(false);
    expect(result.stoppedByDefectRepeat).toBe(false);
    const ck = (await readPdcaCheckpoint(taskId)) ?? {};
    expect(ck.replanFailCount).toBe(3);
    expect(ck.phase).toBe('failed');
  });

  it('无缺陷（review 未给 issues）⇒ 指纹为 null，不早停', async () => {
    const taskId = 'ck_defect_none';
    const result = await finalizeEscalation({
      taskId,
      escalations: [{ defects: [] }, {}],
      setPhase: async () => {},
    });
    expect(result.stoppedByDefectRepeat).toBe(false);
    expect(result.defectRepeatCount).toBe(0);
    expect(result.replanPending).toBe(true);
  });
});
