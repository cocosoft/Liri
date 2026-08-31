/**
 * DrainManager 统一排空协议测试（P3-3，对标 Hermes drain_control write_drain_request / drain_requested）
 *
 * 覆盖：
 * - requestDrain：设置排空状态 + 原因 + 触发事件
 * - isDraining / getState / getReason 查询
 * - cancelDrain：恢复 + 触发事件
 * - 幂等：重复 requestDrain 不重复触发事件；未排空时 cancelDrain 无副作用
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DrainManager } from '../../../src/tasks/drain/DrainManager';

let mgr: DrainManager;

beforeEach(() => {
  mgr = new DrainManager();
});

describe('DrainManager（P3-3）', () => {
  test('requestDrain：设置排空状态 + 原因 + 触发事件', () => {
    let eventCount = 0;
    let eventReason: string | undefined;
    mgr.on('drain-requested', (state) => {
      eventCount++;
      eventReason = state.reason;
    });
    mgr.requestDrain('shutdown');
    expect(mgr.isDraining()).toBe(true);
    expect(mgr.getReason()).toBe('shutdown');
    expect(mgr.getState().draining).toBe(true);
    expect(mgr.getState().requestedAt).toBeGreaterThan(0);
    expect(eventCount).toBe(1);
    expect(eventReason).toBe('shutdown');
  });

  test('cancelDrain：恢复 + 触发事件', () => {
    let canceled = 0;
    mgr.on('drain-cancelled', () => canceled++);
    mgr.requestDrain('upgrade');
    expect(mgr.isDraining()).toBe(true);
    mgr.cancelDrain();
    expect(mgr.isDraining()).toBe(false);
    expect(mgr.getReason()).toBeUndefined();
    expect(canceled).toBe(1);
  });

  test('幂等：重复 requestDrain 不重复触发；未排空时 cancelDrain 无副作用', () => {
    let requested = 0;
    let canceled = 0;
    mgr.on('drain-requested', () => requested++);
    mgr.on('drain-cancelled', () => canceled++);
    mgr.requestDrain('a');
    mgr.requestDrain('b'); // 已排空，仅更新原因，不重复触发
    expect(requested).toBe(1);
    expect(mgr.getReason()).toBe('b');
    mgr.cancelDrain();
    mgr.cancelDrain(); // 已恢复，无副作用
    expect(canceled).toBe(1);
    expect(mgr.isDraining()).toBe(false);
  });

  test('getState 返回快照（修改快照不影响内部状态）', () => {
    mgr.requestDrain('maintenance');
    const state = mgr.getState();
    state.draining = false;
    expect(mgr.isDraining()).toBe(true); // 内部状态不受快照修改影响
  });
});
