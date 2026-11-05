// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-3（2026-11-05）：审批续跑的「在飞串行化」回归锁。
 *
 * 现场（旧 daemon 日志）：`13:20:50` 审批已批准 → 原回合仍在写文件
 * （`file_write_loop_detected`）→ `13:21:20` `审批后自动续跑失败` /
 * `SimpleMutex: acquire timeout after 30000ms`，用户侧表现为「批了但没继续」。
 *
 * 处置契约：起续跑流前先等原回合结束（有界）；超界返回 false，由上层
 * **明确延后**（info 日志），而不是把互斥超时伪装成续跑失败。
 */

import { describe, it, expect } from 'bun:test';
import { waitForSessionIdle } from '@modules/runtime/inboxApproval';

describe('P0-3：审批续跑在飞守卫', () => {
  it('会话已空闲 ⇒ 立即返回 true', async () => {
    let calls = 0;
    const idle = await waitForSessionIdle(
      () => {
        calls += 1;
        return false;
      },
      'session-idle',
      0
    );
    expect(idle).toBe(true);
    expect(calls).toBe(1);
  });

  it('等待期内原回合结束 ⇒ 返回 true', async () => {
    let busy = true;
    const isStreaming = (): boolean => {
      if (busy) {
        busy = false;
        return true;
      }
      return false;
    };
    const idle = await waitForSessionIdle(
      isStreaming,
      'session-finishes',
      5_000
    );
    expect(idle).toBe(true);
  });

  it('原回合持续运行且超过上界 ⇒ 返回 false（不抛错、不空等 30s 互斥）', async () => {
    let ticks = 0;
    const now = (): number => {
      ticks += 1;
      return ticks;
    };
    const idle = await waitForSessionIdle(() => true, 'session-busy', 1, now);
    expect(idle).toBe(false);
  });
});
