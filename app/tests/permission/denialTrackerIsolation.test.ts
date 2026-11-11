/**
 * P0-2（2026-11-11）：拒绝计数器**按 (session, tool) 隔离**。
 *
 * 原实现只有一个全局 `consecutiveCount`（`trackDenial` 恒 `sessionId:'default'`，
 * `shouldAsk` 忽略工具名）⇒ A 工具被拒 3 次会让 B 工具、甚至另一个会话的判定
 * 被「连续拒绝」逻辑误伤。
 *
 * 本文件锁四件事：
 *  ① 同 (session, tool) 连续拒绝累计；
 *  ② 不同工具互不影响；
 *  ③ 不同会话互不影响；
 *  ④ `trackSuccess` 只清对应键（不清其它工具/会话）。
 */
import { describe, expect, test } from 'bun:test';

import { DenialTracker } from '@openliri/infra/permission';

describe('DenialTracker：按 (session, tool) 隔离（P0-2）', () => {
  test('同会话同工具连续 3 次 ⇒ 达到阈值', () => {
    const tracker = new DenialTracker();
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('bash', 's1');

    expect(tracker.shouldAsk('bash', 's1')).toBe(true);
    expect(tracker.getConsecutiveCount('bash', 's1')).toBe(3);
  });

  test('不同工具互不影响', () => {
    const tracker = new DenialTracker();
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('bash', 's1');

    expect(tracker.shouldAsk('file_write', 's1')).toBe(false);
  });

  test('不同会话互不影响', () => {
    const tracker = new DenialTracker();
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('bash', 's1');

    expect(tracker.shouldAsk('bash', 's2')).toBe(false);
  });

  test('trackSuccess 只清对应键', () => {
    const tracker = new DenialTracker();
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('bash', 's1');
    tracker.trackDenial('file_write', 's1');

    tracker.trackSuccess('bash', 's1');

    expect(tracker.getConsecutiveCount('bash', 's1')).toBe(0);
    expect(tracker.getConsecutiveCount('file_write', 's1')).toBe(1);
  });
});
