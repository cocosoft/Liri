/**
 * B3（架构归一 Step3）：tracker 跨轮不清零 → 重复上报上一轮交付物
 *
 * 根因：CoreAPIImpl.chatStream 末尾 `tracker.reset()`（CoreAPIImpl.ts:1140）原位于
 * `if (deliverable && files.length > 0)` 块内 → 无交付物轮次永不清零，
 * 下一轮复用同一 tracker 时重复上报上一轮 phase/deliverable。
 * 修复：reset() 移出 if，轮次结束无条件调用。
 *
 * 本测试验证 reset() 后 tracker 状态回到空（该不变量正是无条件 reset 所保障的）。
 */
import { describe, expect, test } from 'bun:test';
import { ExecutionPhaseTracker } from '../../src/session/ExecutionPhaseTracker.js';

function makeTracker() {
  const tracker = new ExecutionPhaseTracker('sess-1', () => {});
  return tracker;
}

describe('ExecutionPhaseTracker B3 — 轮次间 reset 无条件清零', () => {
  test('上一轮记录交付物后，reset() 清除全部状态（buildDeliverableData 回退 null）', () => {
    const tracker = makeTracker();
    // 上一轮：进入 implementing 并记录交付物
    tracker.enter('implementing', '上一轮');
    tracker.addArtifact({ type: 'code', summary: '写入文件', files: ['a.ts'] });
    expect(tracker.buildDeliverableData()?.files.length ?? 0).toBeGreaterThan(
      0
    );

    // 本轮结束（无论是否有交付物）统一走 reset()（B3 修复后的调用位置）
    tracker.reset();

    expect(tracker.buildDeliverableData()).toBeNull();
    expect(tracker.getCurrentPhase()).toBeNull();
    expect(tracker.getHistory()).toHaveLength(0);
    expect(tracker.getCurrentProgress()).toBe(0);
    expect(tracker.buildProgressData().currentStep).toBe('');
  });

  test('reset() 幂等：连续调用无副作用', () => {
    const tracker = makeTracker();
    tracker.enter('analyzing', '开始');
    tracker.reset();
    expect(() => tracker.reset()).not.toThrow();
    expect(tracker.getHistory()).toHaveLength(0);
  });
});
