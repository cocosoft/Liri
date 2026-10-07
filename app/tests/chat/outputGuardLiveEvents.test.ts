// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 输出护栏**下发通道**契约守卫（PC-1，2026-10-07）
 *
 * 锁三件事：
 *   ① **SSE 事件名**——前端 `useNotificationSSE` 订阅的字面量必须与之逐字一致（跨端契约）；
 *   ② **命中判定**（纯函数，CS02 结构化布尔）——`blocked` 优先 `redacted`；两者皆否 ⇒ `null`（不下发）；
 *   ③ **载荷 JSON 安全**——只含 `sessionId` / `messageId` / `action`（**不含** `blockReason` 原文，
 *      遵 PC-5 去技术化；原文由调用方 `logger` 留痕）。
 */
import { describe, expect, it } from 'bun:test';

import {
  OUTPUT_GUARD_SSE_EVENT,
  buildOutputGuardNotice,
  buildOutputGuardPayload,
} from '../../src/chat/outputGuards/index';

describe('outputGuards/liveEvents：前端下发契约', () => {
  it('事件名与前端订阅字面量一致', () => {
    expect(OUTPUT_GUARD_SSE_EVENT).toBe('system:output_guard');
  });

  it('① 阻断优先：blocked=true ⇒ action=blocked', () => {
    expect(buildOutputGuardNotice('s1', 'm1', { blocked: true })).toEqual({
      sessionId: 's1',
      messageId: 'm1',
      action: 'blocked',
    });
  });

  it('② 仅打码：redacted=true ⇒ action=redacted', () => {
    expect(buildOutputGuardNotice('s1', 'm1', { redacted: true })).toEqual({
      sessionId: 's1',
      messageId: 'm1',
      action: 'redacted',
    });
  });

  it('③ 未命中 / 仅 mermaid 修复 ⇒ null（不下发）', () => {
    expect(buildOutputGuardNotice('s1', 'm1', {})).toBeNull();
    expect(
      buildOutputGuardNotice('s1', 'm1', { blocked: false, redacted: false })
    ).toBeNull();
  });

  it('载荷仅三字段（不泄漏 blockReason 原文）', () => {
    const payload = buildOutputGuardPayload({
      sessionId: 's1',
      messageId: 'm1',
      action: 'redacted',
    });
    expect(payload).toEqual({
      sessionId: 's1',
      messageId: 'm1',
      action: 'redacted',
    });
    expect(Object.keys(payload)).toHaveLength(3);
  });
});
