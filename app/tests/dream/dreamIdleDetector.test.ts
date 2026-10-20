/**
 * BUG-9（2026-10-19）：系统忙碌（活跃流式会话）不得被判为空闲。
 *
 * 回归点：此前只监听 `USER_INTERACTION`，长任务运行中仍会触发梦境。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { DreamIdleDetector } from '../../src/dream/DreamIdleDetector';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('DreamIdleDetector：忙碌不判空闲（BUG-9）', () => {
  let detector: DreamIdleDetector | null = null;

  afterEach(() => {
    detector?.stop();
    detector = null;
  });

  it('isBusy=true ⇒ 超过空闲阈值也不触发', async () => {
    detector = new DreamIdleDetector(20, 5);
    let fired = 0;
    detector.start(
      () => {
        fired++;
      },
      () => true
    );

    await sleep(80);
    expect(fired).toBe(0);
  });

  it('忙碌解除后 ⇒ 超过阈值恢复触发', async () => {
    detector = new DreamIdleDetector(20, 5);
    let busy = true;
    let fired = 0;
    detector.start(
      () => {
        fired++;
      },
      () => busy
    );

    await sleep(60);
    expect(fired).toBe(0);

    busy = false;
    await sleep(80);
    expect(fired).toBeGreaterThan(0);
  });
});
