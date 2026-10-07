// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 资源治理**下发通道**契约守卫（PC-2，2026-10-07）
 *
 * 锁两件事：
 *   ① **SSE 事件名**——前端 `useNotificationSSE` 订阅的字面量必须与之逐字一致（跨端契约）；
 *   ② **载荷 JSON 安全**——省略 `undefined`（对齐 PdcaLiveEvents 的 D1 无损校验教训）。
 */
import { describe, expect, it } from 'bun:test';

import {
  RESOURCE_GOVERNOR_SSE_EVENT,
  buildResourceGovernorPayload,
} from '../../src/resourceGovernor/index';

describe('liveEvents：前端下发契约', () => {
  it('事件名与前端订阅字面量一致', () => {
    expect(RESOURCE_GOVERNOR_SSE_EVENT).toBe('system:resource_governor');
  });

  it('queued 携带 queuePosition；preempted/released 省略该键（无 undefined）', () => {
    expect(
      buildResourceGovernorPayload({
        sessionId: 's1',
        state: 'queued',
        queuePosition: 2,
      })
    ).toEqual({ sessionId: 's1', state: 'queued', queuePosition: 2 });

    const preempted = buildResourceGovernorPayload({
      sessionId: 's1',
      state: 'preempted',
    });
    expect(preempted).toEqual({ sessionId: 's1', state: 'preempted' });
    expect('queuePosition' in preempted).toBe(false);
  });
});
