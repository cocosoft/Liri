/**
 * T1-2② / B₁ 片：侧车「作业化」**协议层**（2026-10-13）
 *
 * 覆盖：构造 ↔ 解析**往返一致**；经**既有分帧**（`encodeFrame`/`decodeFrame`）往返仍可解析
 * （证明「零新帧型」成立）；**不臆造** —— 非 notify / 事件名不符 / `data` 非对象 / 缺 `jobId` /
 * `ok` 非布尔 ⇒ `null`（不可判定成败者一律丢弃，交超时兜底而非猜成功）。
 */
import { describe, it, expect } from 'bun:test';
import {
  SIDECAR_JOB_COMPLETED_EVENT,
  SIDECAR_JOB_SUBMIT_METHOD,
  buildJobCompleted,
  buildJobSubmit,
  decodeFrame,
  encodeFrame,
  parseJobCompleted,
} from '../../src/utils/sidecarIpc.js';

describe('T1-2② B₁：侧车作业协议（复用既有帧型，零新帧）', () => {
  it('提交：payload 缺省时不塞 `payload: undefined`', () => {
    expect(buildJobSubmit('j1', 'run')).toEqual({ jobId: 'j1', action: 'run' });
    expect(buildJobSubmit('j1', 'run', { a: 1 })).toEqual({
      jobId: 'j1',
      action: 'run',
      payload: { a: 1 },
    });
    expect(SIDECAR_JOB_SUBMIT_METHOD).toBe('job.submit');
  });

  it('成功完成：往返一致（含 result）', () => {
    const payload = { jobId: 'j1', ok: true, result: { text: 'hi' } };
    expect(parseJobCompleted(buildJobCompleted(payload))).toEqual(payload);
  });

  it('失败完成：往返一致（含 error）；失败无 error ⇒ 仅两项', () => {
    const payload = { jobId: 'j2', ok: false, error: 'boom' };
    expect(parseJobCompleted(buildJobCompleted(payload))).toEqual(payload);
    expect(
      parseJobCompleted({
        type: 'notify',
        event: SIDECAR_JOB_COMPLETED_EVENT,
        data: { jobId: 'j3', ok: false },
      })
    ).toEqual({ jobId: 'j3', ok: false });
  });

  it('**零新帧型**成立：经既有分帧往返后仍可解析', () => {
    const line = encodeFrame(
      buildJobCompleted({ jobId: 'j4', ok: true, result: 42 })
    );
    expect(parseJobCompleted(decodeFrame(line))).toEqual({
      jobId: 'j4',
      ok: true,
      result: 42,
    });
  });

  it('不臆造：不可判定成败的通知一律 null', () => {
    const bad: unknown[] = [
      null,
      undefined,
      {},
      { type: 'response', data: { jobId: 'j', ok: true } }, // 非 notify
      { type: 'notify', event: 'other', data: { jobId: 'j', ok: true } }, // 事件名不符
      { type: 'notify', event: SIDECAR_JOB_COMPLETED_EVENT, data: 'x' }, // data 非对象
      { type: 'notify', event: SIDECAR_JOB_COMPLETED_EVENT, data: [] }, // data 数组
      { type: 'notify', event: SIDECAR_JOB_COMPLETED_EVENT, data: {} }, // 缺 jobId
      {
        type: 'notify',
        event: SIDECAR_JOB_COMPLETED_EVENT,
        data: { jobId: '', ok: true },
      }, // 空 jobId
      {
        type: 'notify',
        event: SIDECAR_JOB_COMPLETED_EVENT,
        data: { jobId: 'j', ok: 'yes' },
      }, // ok 非布尔
      {
        type: 'notify',
        event: SIDECAR_JOB_COMPLETED_EVENT,
        data: { jobId: 'j' },
      }, // 缺 ok
    ];
    for (const f of bad) {
      expect(() => parseJobCompleted(f as never)).not.toThrow();
      expect(parseJobCompleted(f as never)).toBeNull();
    }
  });
});
