// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * G-10 P1：`ProactiveNotificationGate` 纯函数契约。
 *
 * 覆盖设计稿 §3 的固定判定顺序：总开关 → 过期 → 去重 → CRITICAL 例外 →
 * DND（含跨午夜）→ 同类冷却 → 每小时上限 → 放行。
 */
import { describe, expect, it } from 'bun:test';
import {
  createProactiveNotificationGate,
  evaluateProactiveNotification,
} from '../../src/proactive/ProactiveNotificationGate';
import type {
  ProactiveGateContext,
  ProactiveMessagePayload,
} from '../../src/proactive/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 2026-10-19T23:00:00+08:00 */
const NOW = Date.parse('2026-10-19T15:00:00Z');

function payload(
  over: Partial<ProactiveMessagePayload> = {}
): ProactiveMessagePayload {
  return {
    id: 'p1',
    kind: 'task_result',
    priority: 'normal',
    dedupeKey: 'task:t1:done',
    title: '任务完成',
    body: '后台任务已完成',
    createdAt: NOW,
    expiresAt: NOW + HOUR,
    ...over,
  };
}

function ctx(over: Partial<ProactiveGateContext> = {}): ProactiveGateContext {
  return {
    now: NOW,
    timezone: 'Asia/Shanghai',
    prefs: { enabled: true, maxPerHour: 3 },
    recent: [],
    ...over,
  };
}

describe('ProactiveNotificationGate：硬性丢弃', () => {
  it('总开关关闭 ⇒ drop(disabled)，即使 CRITICAL', () => {
    expect(
      evaluateProactiveNotification(
        payload({ priority: 'critical' }),
        ctx({ prefs: { enabled: false, maxPerHour: 3 } })
      )
    ).toEqual({ action: 'drop', reason: 'disabled' });
  });

  it('已过期（now >= expiresAt）⇒ drop(expired)', () => {
    expect(
      evaluateProactiveNotification(payload({ expiresAt: NOW }), ctx())
    ).toEqual({ action: 'drop', reason: 'expired' });
  });

  it('dedupeKey 命中 ⇒ drop(duplicate)，不看标题/正文', () => {
    expect(
      evaluateProactiveNotification(
        payload({ title: '换了标题也一样' }),
        ctx({
          recent: [
            {
              dedupeKey: 'task:t1:done',
              kind: 'suggestion',
              deliveredAt: NOW - 1,
            },
          ],
        })
      )
    ).toEqual({ action: 'drop', reason: 'duplicate' });
  });
});

describe('ProactiveNotificationGate：CRITICAL 例外', () => {
  it('CRITICAL 穿透 DND 与速率限制 ⇒ deliver(critical_bypass)', () => {
    const c = ctx({
      prefs: {
        enabled: true,
        maxPerHour: 0,
        dnd: { start: '22:00', end: '08:00' },
      },
      recent: [
        { dedupeKey: 'a', kind: 'task_result', deliveredAt: NOW - MINUTE },
        { dedupeKey: 'b', kind: 'task_result', deliveredAt: NOW - 2 * MINUTE },
      ],
    });
    expect(
      evaluateProactiveNotification(payload({ priority: 'critical' }), c)
    ).toEqual({ action: 'deliver', reason: 'critical_bypass' });
  });
});

describe('ProactiveNotificationGate：免打扰（DND）', () => {
  it('跨午夜窗口：23:00 处于 22:00–08:00 ⇒ 排到次日 08:00', () => {
    const c = ctx({
      prefs: {
        enabled: true,
        maxPerHour: 3,
        dnd: { start: '22:00', end: '08:00' },
      },
    });
    const decision = evaluateProactiveNotification(payload(), c);
    expect(decision).toEqual({
      action: 'queue',
      reason: 'dnd',
      retryAt: Date.parse('2026-10-20T00:00:00Z'), // 次日 08:00 +08:00
    });
  });

  it('非跨午夜窗口：09:30 处于 09:00–10:00 ⇒ 排到 10:00', () => {
    const now = Date.parse('2026-10-19T01:30:00Z'); // 09:30 +08:00
    const c = ctx({
      now,
      prefs: {
        enabled: true,
        maxPerHour: 3,
        dnd: { start: '09:00', end: '10:00' },
      },
    });
    expect(
      evaluateProactiveNotification(payload({ createdAt: now }), c)
    ).toEqual({
      action: 'queue',
      reason: 'dnd',
      retryAt: Date.parse('2026-10-19T02:00:00Z'), // 10:00 +08:00
    });
  });

  it('非法 DND 配置 ⇒ 忽略（按未配置处理，不阻塞）', () => {
    const c = ctx({
      prefs: {
        enabled: true,
        maxPerHour: 3,
        dnd: { start: '25:00', end: '08:00' },
      },
    });
    expect(evaluateProactiveNotification(payload(), c)).toEqual({
      action: 'deliver',
      reason: 'ok',
    });
  });

  it('非法时区 ⇒ 回退 UTC（门禁不抛错）', () => {
    const c = ctx({
      timezone: 'Not/AZone',
      prefs: {
        enabled: true,
        maxPerHour: 3,
        dnd: { start: '22:00', end: '08:00' },
      },
    });
    // NOW 的 UTC 时间是 15:00，不在 22:00–08:00 ⇒ 放行
    expect(evaluateProactiveNotification(payload(), c)).toEqual({
      action: 'deliver',
      reason: 'ok',
    });
  });
});

describe('ProactiveNotificationGate：同类冷却与速率限制', () => {
  it('同类冷却未过 ⇒ queue(cooldown)，retryAt = 上次 + 冷却', () => {
    const deliveredAt = NOW - 30_000;
    const decision = evaluateProactiveNotification(
      payload(),
      ctx({
        recent: [{ dedupeKey: 'x', kind: 'task_result', deliveredAt }],
      })
    );
    expect(decision).toEqual({
      action: 'queue',
      reason: 'cooldown',
      retryAt: deliveredAt + 60_000, // 默认 task_result 冷却 1 分钟
    });
  });

  it('用户覆盖冷却为 0 ⇒ 不受同类冷却限制', () => {
    expect(
      evaluateProactiveNotification(
        payload({ kind: 'suggestion' }),
        ctx({
          prefs: {
            enabled: true,
            maxPerHour: 3,
            cooldownMs: { suggestion: 0 },
          },
          recent: [
            {
              dedupeKey: 'x',
              kind: 'suggestion',
              deliveredAt: NOW - 1000,
            },
          ],
        })
      )
    ).toEqual({ action: 'deliver', reason: 'ok' });
  });

  it('每小时上限已满 ⇒ queue(rate_limited)，retryAt = 最早一条 + 1h', () => {
    const earliest = NOW - 10 * MINUTE;
    const decision = evaluateProactiveNotification(
      payload({ kind: 'reminder' }), // reminder 默认冷却 0 ⇒ 走到速率限制
      ctx({
        prefs: { enabled: true, maxPerHour: 2 },
        recent: [
          { dedupeKey: 'a', kind: 'reminder', deliveredAt: earliest },
          {
            dedupeKey: 'b',
            kind: 'reminder',
            deliveredAt: NOW - 5 * MINUTE,
          },
        ],
      })
    );
    expect(decision).toEqual({
      action: 'queue',
      reason: 'rate_limited',
      retryAt: earliest + HOUR,
    });
  });

  it('每小时上限为 0 ⇒ 非 CRITICAL 一律排到 1 小时后', () => {
    expect(
      evaluateProactiveNotification(
        payload({ kind: 'reminder' }),
        ctx({ prefs: { enabled: true, maxPerHour: 0 } })
      )
    ).toEqual({
      action: 'queue',
      reason: 'rate_limited',
      retryAt: NOW + HOUR,
    });
  });

  it('无任何限制 ⇒ deliver(ok)', () => {
    expect(
      evaluateProactiveNotification(payload({ kind: 'reminder' }), ctx())
    ).toEqual({
      action: 'deliver',
      reason: 'ok',
    });
  });
});

describe('createProactiveNotificationGate', () => {
  it('返回的门禁与纯函数同判定（无状态）', () => {
    const gate = createProactiveNotificationGate();
    const p = payload({ kind: 'reminder' });
    expect(gate.evaluate(p, ctx())).toEqual(
      evaluateProactiveNotification(p, ctx())
    );
  });
});
