/**
 * T1-2② / B₂ 片：侧车**异步作业登记表**（2026-10-13）
 *
 * 覆盖：成功/失败**均结算**（成败同报）；**超时兜底**（绝不悬挂）；未知 `jobId` **不臆造**
 * （消费该帧但不新增条目、不抛）；非作业帧**不消费**（交回原分派）；`fail()` / `rejectAll()`
 * 显式结算；同 `jobId` 重复登记 ⇒ **先结算旧的**（不静默覆盖）。
 */
import { describe, it, expect } from 'bun:test';
import { SidecarJobRegistry } from '../../src/tools/sidecar/sidecarJobs.js';
import {
  SIDECAR_JOB_COMPLETED_EVENT,
  buildJobCompleted,
} from '../../src/utils/sidecarIpc.js';

function completed(
  jobId: string,
  ok: boolean,
  extra: Record<string, unknown> = {}
) {
  return buildJobCompleted({
    jobId,
    ok,
    ...extra,
  }) as unknown as Record<string, unknown>;
}

describe('T1-2② B₂：侧车异步作业登记表', () => {
  it('成功完成：`ok=true` ⇒ resolve(result)', async () => {
    const reg = new SidecarJobRegistry();
    const p = reg.register('j1', 1000, 'analyze');
    expect(reg.size).toBe(1);
    expect(reg.completeFromFrame(completed('j1', true, { result: 42 }))).toBe(
      true
    );
    await expect(p).resolves.toBe(42);
    expect(reg.size).toBe(0);
  });

  it('失败完成：`ok=false` ⇒ reject(error)（成败同报，不悬挂）', async () => {
    const reg = new SidecarJobRegistry();
    const p = reg.register('j2', 1000, 'analyze');
    reg.completeFromFrame(completed('j2', false, { error: 'boom' }));
    await expect(p).rejects.toThrow('boom');

    const reg2 = new SidecarJobRegistry();
    const p2 = reg2.register('j3', 1000, 'analyze');
    reg2.completeFromFrame(completed('j3', false)); // 无 error ⇒ 用兜底文案
    await expect(p2).rejects.toThrow(/侧车作业失败/);
  });

  it('未知 `jobId` ⇒ 消费该帧但不臆造（不新增条目、不抛）', () => {
    const reg = new SidecarJobRegistry();
    expect(() => reg.completeFromFrame(completed('ghost', true))).not.toThrow();
    expect(reg.completeFromFrame(completed('ghost', true))).toBe(true);
    expect(reg.size).toBe(0);
  });

  it('非作业帧 ⇒ false（交回原分派，不消费）', () => {
    const reg = new SidecarJobRegistry();
    for (const f of [
      { type: 'heartbeat', at: 1 },
      { type: 'response', id: 'x', success: true },
      { type: 'notify', event: 'cancel', data: { id: 'x' } },
      {
        type: 'notify',
        event: SIDECAR_JOB_COMPLETED_EVENT,
        data: { ok: true },
      },
    ]) {
      expect(reg.completeFromFrame(f as Record<string, unknown>)).toBe(false);
    }
  });

  it('超时兜底 ⇒ reject（绝不永久悬挂）', async () => {
    const reg = new SidecarJobRegistry();
    const p = reg.register('j4', 5, 'slow');
    await expect(p).rejects.toThrow(/超时/);
    expect(reg.size).toBe(0);
  });

  it('fail() / rejectAll() 显式结算；同 id 重复登记先结算旧的', async () => {
    const reg = new SidecarJobRegistry();
    const p1 = reg.register('j5', 1000, 'a');
    reg.fail('j5', new Error('提交失败'));
    await expect(p1).rejects.toThrow('提交失败');

    const p2 = reg.register('j6', 1000, 'b');
    const p3 = reg.register('j6', 1000, 'b2'); // 同 id ⇒ 旧者先 reject
    await expect(p2).rejects.toThrow(/重复登记/);
    expect(reg.size).toBe(1);
    reg.completeFromFrame(completed('j6', true));
    await expect(p3).resolves.toBeUndefined();

    const p4 = reg.register('j7', 1000, 'c');
    reg.rejectAll(new Error('侧车已退出'));
    await expect(p4).rejects.toThrow('侧车已退出');
    expect(reg.size).toBe(0);
  });
});
