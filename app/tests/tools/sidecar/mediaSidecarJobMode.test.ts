// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T1-2② C₂（2026-10-13）：媒体侧车 **worker 侧作业模式**（`job.submit`）。
//
// 覆盖（真实 `startMediaSidecar` + 注入流 / 端口工厂 ⇒ 不真起进程）：
// ① **提交即返**：先回 `response{jobId, accepted}`，**随后**才回推 `notify{job.completed}`；
// ② 作业**失败** ⇒ `notify{ok:false}` 且原因如实带回（成败同报 ⇒ 宿主绝不悬挂）；
// ③ **未覆盖动作 ⇒ 提交阶段 fail-closed**（`success:false` / NOT_IMPLEMENTED，**不建作业、无通知**）；
// ④ 缺 `jobId` ⇒ `INVALID_PARAMS`（同上，不建作业）；
// ⑤ `notify{cancel, data:{id:jobId}}` ⇒ 作业以 `ok:false` 结算（不悬挂）；
// ⑥ **零行为变更**：既有同步 `media.analyze` 路径完全不受影响。

import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { startMediaSidecar } from '../../../src/tools/sidecar/mediaSidecar';
import type {
  MediaAnalysisPort,
  MediaResizePort,
} from '../../../src/tools/sidecar/mediaCapabilities';
import {
  SIDECAR_JOB_COMPLETED_EVENT,
  SIDECAR_JOB_SUBMIT_METHOD,
  buildJobSubmit,
  encodeFrame,
  decodeFrame,
} from '../../../src/utils/sidecarIpc';

async function waitFor(
  cond: () => boolean,
  timeoutMs = 2000,
  stepMs = 5
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function ipcFrames(chunks: Buffer[]): Array<Record<string, unknown>> {
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => decodeFrame(l))
    .filter((f): f is Record<string, unknown> => f !== null);
}

const noopResize: MediaResizePort = {
  resize: async (image) => image,
  dispose: () => {},
};

function harness(analyze: MediaAnalysisPort['analyze']): {
  input: PassThrough;
  chunks: Buffer[];
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  startMediaSidecar({
    input,
    output,
    heartbeatMs: 100_000,
    pid: 1,
    analysisPortFactory: () => ({ analyze, dispose: () => {} }),
    resizePortFactory: () => noopResize,
  });
  return { input, chunks };
}

/** 找到该 jobId 的完成通知载荷 */
function completedData(
  chunks: Buffer[],
  jobId: string
): Record<string, unknown> | null {
  const frame = ipcFrames(chunks).find(
    (f) =>
      f.type === 'notify' &&
      f.event === SIDECAR_JOB_COMPLETED_EVENT &&
      (f.data as Record<string, unknown> | undefined)?.jobId === jobId
  );
  return (frame?.data as Record<string, unknown> | undefined) ?? null;
}

describe('T1-2② C₂：媒体侧车 worker 作业模式（job.submit）', () => {
  it('① 提交即返：先 response{jobId,accepted}，随后 notify{ok:true}（顺序 + 端口入参）', async () => {
    const calls: Array<{ kind: string; params: Record<string, unknown> }> = [];
    const { input, chunks } = harness(async (kind, params) => {
      calls.push({ kind, params });
      return { text: 'HI', confidence: 1, blocks: [] };
    });

    input.write(
      encodeFrame({
        id: 'r1',
        method: SIDECAR_JOB_SUBMIT_METHOD,
        params: buildJobSubmit('job_A', 'media.analyze', {
          kind: 'ocr',
          image_path: '/tmp/a.png',
        }),
      })
    );
    await waitFor(() => completedData(chunks, 'job_A') !== null);
    await new Promise((r) => setTimeout(r, 10)); // 让写序稳定

    const frames = ipcFrames(chunks);
    const resIdx = frames.findIndex((f) => f.id === 'r1');
    const notifyIdx = frames.findIndex(
      (f) => f.type === 'notify' && f.event === SIDECAR_JOB_COMPLETED_EVENT
    );
    const res = frames[resIdx]!;
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ jobId: 'job_A', accepted: true });
    expect(resIdx).toBeLessThan(notifyIdx); // **提交即返**：响应先于完成通知
    expect(completedData(chunks, 'job_A')).toMatchObject({
      jobId: 'job_A',
      ok: true,
      result: { text: 'HI', confidence: 1, blocks: [] },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('ocr');
    expect(calls[0]!.params).toMatchObject({ image_path: '/tmp/a.png' });
  });

  it('② 作业失败 ⇒ notify{ok:false}，原因如实带回（不吞错）', async () => {
    const { input, chunks } = harness(async () => {
      throw new Error('vision_worker 崩了');
    });

    input.write(
      encodeFrame({
        id: 'r2',
        method: SIDECAR_JOB_SUBMIT_METHOD,
        params: buildJobSubmit('job_B', 'media.analyze', { kind: 'ocr' }),
      })
    );
    await waitFor(() => completedData(chunks, 'job_B') !== null);

    const data = completedData(chunks, 'job_B')!;
    expect(data.ok).toBe(false);
    expect(String(data.error)).toContain('vision_worker 崩了');
  });

  it('③ 未覆盖动作 ⇒ **提交阶段** fail-closed（NOT_IMPLEMENTED；无通知、端口未被调用）', async () => {
    let analyzeCalls = 0;
    const { input, chunks } = harness(async () => {
      analyzeCalls += 1;
      return {};
    });

    input.write(
      encodeFrame({
        id: 'r3',
        method: SIDECAR_JOB_SUBMIT_METHOD,
        params: buildJobSubmit('job_C', 'media.not_a_thing', {}),
      })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r3'));
    await new Promise((r) => setTimeout(r, 30));

    const res = ipcFrames(chunks).find((f) => f.id === 'r3')!;
    expect(res.success).toBe(false);
    expect((res.error as Record<string, unknown> | undefined)?.code).toBe(
      'NOT_IMPLEMENTED'
    );
    expect(completedData(chunks, 'job_C')).toBeNull(); // **不建作业**
    expect(analyzeCalls).toBe(0);
  });

  it('④ 缺 jobId ⇒ INVALID_PARAMS（不建作业、无通知）', async () => {
    const { input, chunks } = harness(async () => ({}));

    input.write(
      encodeFrame({
        id: 'r4',
        method: SIDECAR_JOB_SUBMIT_METHOD,
        params: { action: 'media.analyze' },
      })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r4'));
    await new Promise((r) => setTimeout(r, 30));

    const res = ipcFrames(chunks).find((f) => f.id === 'r4')!;
    expect(res.success).toBe(false);
    expect((res.error as Record<string, unknown> | undefined)?.code).toBe(
      'INVALID_PARAMS'
    );
    expect(
      ipcFrames(chunks).some((f) => f.event === SIDECAR_JOB_COMPLETED_EVENT)
    ).toBe(false);
  });

  it('⑤ notify{cancel} ⇒ 作业以 ok:false 结算（不留悬挂）', async () => {
    const { input, chunks } = harness(
      (_kind, _params, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted by signal')),
            { once: true }
          );
        })
    );

    input.write(
      encodeFrame({
        id: 'r5',
        method: SIDECAR_JOB_SUBMIT_METHOD,
        params: buildJobSubmit('job_D', 'media.analyze', { kind: 'ocr' }),
      })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r5'));
    // 取消下传（与既有普通请求同一机制：`data.id` = 作业 id）
    input.write(
      encodeFrame({ type: 'notify', event: 'cancel', data: { id: 'job_D' } })
    );
    await waitFor(() => completedData(chunks, 'job_D') !== null);

    const data = completedData(chunks, 'job_D')!;
    expect(data.ok).toBe(false);
    expect(String(data.error)).toContain('取消');
  });

  it('⑥ 零行为变更：既有同步 media.analyze 路径不受影响', async () => {
    const { input, chunks } = harness(async () => ({ text: 'SYNC' }));

    input.write(
      encodeFrame({
        id: 'r6',
        method: 'media.analyze',
        params: { kind: 'ocr', image_path: '/tmp/a.png' },
      })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r6'));

    const res = ipcFrames(chunks).find((f) => f.id === 'r6')!;
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ text: 'SYNC' });
    expect(
      ipcFrames(chunks).some((f) => f.event === SIDECAR_JOB_COMPLETED_EVENT)
    ).toBe(false);
  });
});
