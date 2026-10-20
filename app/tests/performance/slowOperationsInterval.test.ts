/**
 * BUG-7（2026-10-19）：`using` 必须落在定时器回调内，才能计量 tick 的真实耗时。
 *
 * 回归点：此前 `using` 在工厂函数体内，函数 return 时立即 dispose ⇒ 只记录
 * “创建定时器”的 ~0ms，interval 慢操作指标全是噪声。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setIntervalWithLogging } from '../../src/performance/SlowOperations';
import {
  clearSlowOperations,
  getSlowOperations,
} from '../../src/performance/SlowOperationStore';

/** 忙等模拟慢回调（阈值在 test/development 下均 ≤300ms） */
function busyWait(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // 故意阻塞事件循环，制造可被 SlowLogger 捕获的耗时
  }
}

describe('setIntervalWithLogging（BUG-7）', () => {
  beforeEach(() => clearSlowOperations());
  afterEach(() => clearSlowOperations());

  it('记录的是回调 tick 的耗时，而不是创建定时器的耗时', async () => {
    const handle = setIntervalWithLogging(
      () => {
        busyWait(350);
      },
      20,
      'bug7-tick'
    );

    // 让第一个 tick 完成（busy wait 会阻塞，定时器队列在之后恢复）
    await new Promise((resolve) => setTimeout(resolve, 60));
    clearInterval(handle);

    const records = getSlowOperations().filter((r) =>
      r.description.includes('interval(bug7-tick')
    );
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]!.duration).toBeGreaterThanOrEqual(300);
  });
});
