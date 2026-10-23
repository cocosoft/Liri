// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T1-2② C₂（2026-10-13）：媒体侧车 **L2 作业端口**（`createL2WorkerJobPort`）—— 生产链路胶水。
//
// 覆盖（注入 supervisor / 挂起端口 ⇒ 不真起进程、不真挂起）：
// ① 作业模式门控：`TOOL_SIDECAR_MEDIA && TOOL_JOB_SUSPEND` **双开**才启用（四组合真值表）；
// ② 提交：动作恒为 `media.analyze` + `kind` 映射（`ocr`/`objects`/`similarity`）；
// ③ 时序：**先提交（提交即返）→ 再登记挂起 → 等完成 → 释放**；register/release 入参如实；
// ④ **失败也释放**（`completion` 拒绝 ⇒ 结果拒绝且 `release` 仍被调用，不留幽灵挂起）；
// ⑤ `register` 未登记（开关关 / SPI 未注册）⇒ **退化为等待**并正常返回结果（零行为变更）；
// ⑥ fail-closed：未覆盖方法 / 侧车不可用 ⇒ 抛错，且 **不提交作业**。

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  createL2WorkerJobPort,
  isMediaSidecarJobEnabled,
  type MediaSupervisorJobRequester,
} from '../../../src/tools/sidecar/SidecarMediaAnalyzer';
import type {
  IToolJobSuspendPort,
  ToolJobSuspendRegisterResult,
} from '@openliri/kernel/spi';

const MEDIA_FLAG = 'FEATURE_TOOL_SIDECAR_MEDIA';
const JOB_FLAG = 'FEATURE_TOOL_JOB_SUSPEND';

const prevEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of [MEDIA_FLAG, JOB_FLAG]) {
    prevEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of [MEDIA_FLAG, JOB_FLAG]) {
    const prev = prevEnv.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

/** 记录调用次序的 supervisor / 挂起替身 */
function makeHarness(opts?: {
  completion?: Promise<unknown>;
  submitError?: Error;
  registerResult?: ToolJobSuspendRegisterResult;
}): {
  provide: () => Promise<MediaSupervisorJobRequester | null>;
  suspend: IToolJobSuspendPort;
  order: string[];
  submits: Array<{ action: string; payload: Record<string, unknown> }>;
  releases: string[];
} {
  const order: string[] = [];
  const submits: Array<{ action: string; payload: Record<string, unknown> }> =
    [];
  const releases: string[] = [];
  const requester: MediaSupervisorJobRequester = {
    request: async () => ({}),
    submitJob: async (action, payload) => {
      order.push('submit');
      submits.push({ action, payload: payload ?? {} });
      if (opts?.submitError) throw opts.submitError;
      return {
        jobId: 'job_1',
        completion: opts?.completion ?? Promise.resolve({ text: 'OK' }),
      };
    },
  };
  const suspend: IToolJobSuspendPort = {
    register: (input) => {
      order.push(`register:${input.sessionId}:${input.jobId}`);
      return opts?.registerResult ?? { registered: true };
    },
    release: (sessionId) => {
      order.push('release');
      releases.push(sessionId);
      return true;
    },
  };
  return {
    provide: async () => requester,
    suspend,
    order,
    submits,
    releases,
  };
}

describe('T1-2② C₂：媒体侧车 L2 作业端口', () => {
  it('① 门控真值表：仅 `TOOL_SIDECAR_MEDIA && TOOL_JOB_SUSPEND` 双开才启用', () => {
    expect(isMediaSidecarJobEnabled()).toBe(false); // 双关
    process.env[MEDIA_FLAG] = 'true';
    expect(isMediaSidecarJobEnabled()).toBe(false); // 仅媒体开
    delete process.env[MEDIA_FLAG];
    process.env[JOB_FLAG] = 'true';
    expect(isMediaSidecarJobEnabled()).toBe(false); // 仅作业挂起开
    process.env[MEDIA_FLAG] = 'true';
    expect(isMediaSidecarJobEnabled()).toBe(true); // 双开
  });

  it('②③ 提交 media.analyze（kind=ocr）→ 登记挂起 → 等完成 → 释放；入参如实', async () => {
    const h = makeHarness({ completion: Promise.resolve({ text: 'HI' }) });
    const port = createL2WorkerJobPort(h.provide, h.suspend);

    const result = await port.requestJobResult<{ text: string }>(
      'ocr',
      { image_path: '/tmp/a.png' },
      { sessionId: 's1' }
    );

    expect(result).toEqual({ text: 'HI' });
    expect(h.submits).toEqual([
      {
        action: 'media.analyze',
        payload: { kind: 'ocr', image_path: '/tmp/a.png' },
      },
    ]);
    // 时序：提交 → 登记 → 释放（**先提交再登记**：提交即返后才可能有 jobId）
    expect(h.order).toEqual(['submit', 'register:s1:job_1', 'release']);
    expect(h.releases).toEqual(['s1']);
  });

  it('② kind 映射：object_detection / image_similarity ⇒ objects / similarity', async () => {
    const h = makeHarness();
    const port = createL2WorkerJobPort(h.provide, h.suspend);

    await port.requestJobResult(
      'object_detection',
      { image_path: '/a' },
      {
        sessionId: 's1',
      }
    );
    await port.requestJobResult(
      'image_similarity',
      { image_path: '/a' },
      {
        sessionId: 's1',
      }
    );

    expect(h.submits.map((s) => s.payload.kind)).toEqual([
      'objects',
      'similarity',
    ]);
  });

  it('④ 完成失败 ⇒ 结果拒绝，但 `release` **仍**被调用（不留幽灵挂起）', async () => {
    const h = makeHarness({
      completion: Promise.reject(new Error('侧车作业失败')),
    });
    const port = createL2WorkerJobPort(h.provide, h.suspend);

    await expect(
      port.requestJobResult('ocr', { image_path: '/a' }, { sessionId: 's1' })
    ).rejects.toThrow('侧车作业失败');
    expect(h.order).toEqual(['submit', 'register:s1:job_1', 'release']);
  });

  it('⑤ register 未登记（开关关 / SPI 未注册）⇒ 退化为等待，结果照常返回', async () => {
    const h = makeHarness({
      completion: Promise.resolve({ text: 'OK' }),
      registerResult: { registered: false, reason: 'not_registered' },
    });
    const port = createL2WorkerJobPort(h.provide, h.suspend);

    const result = await port.requestJobResult<{ text: string }>(
      'ocr',
      { image_path: '/a' },
      { sessionId: 's1' }
    );

    expect(result).toEqual({ text: 'OK' });
    expect(h.order).toEqual(['submit', 'register:s1:job_1', 'release']);
  });

  it('⑥ 未覆盖方法 ⇒ fail-closed 抛错，且**不提交**作业', async () => {
    const h = makeHarness();
    const port = createL2WorkerJobPort(h.provide, h.suspend);

    await expect(
      port.requestJobResult(
        'sam_segment',
        { image_path: '/a' },
        {
          sessionId: 's1',
        }
      )
    ).rejects.toThrow('未覆盖 L2 方法');
    expect(h.submits).toEqual([]);
    expect(h.order).toEqual([]);
  });

  it('⑥ 侧车不可用 ⇒ fail-closed 抛错，且**不提交**作业（不回落内置）', async () => {
    const h = makeHarness();
    const port = createL2WorkerJobPort(async () => null, h.suspend);

    await expect(
      port.requestJobResult('ocr', { image_path: '/a' }, { sessionId: 's1' })
    ).rejects.toThrow('媒体侧车不可用');
    expect(h.submits).toEqual([]);
  });
});
