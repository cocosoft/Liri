/**
 * BaseAIProvider.readStreamChunkWithTimeout 防回归测试
 *
 * 覆盖 P2-13 流式读取超时机制的根因缺陷：
 * 修复前每轮 Promise.race 新建 60s 计时器但从不清除 —— 流活跃（每轮 read
 * 先于 timer 返回）时 timer 到期对已 settle 的 race 里的 promise reject，
 * 无人消费 → unhandledRejection（长响应 >60s 必现）。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { BaseAIProvider } from '../../src/ai/providers/BaseAIProvider.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('BaseAIProvider.readStreamChunkWithTimeout', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  afterEach(() => {
    process.removeListener('unhandledRejection', onUnhandled);
    unhandled.length = 0;
  });

  /** Object.create 绕过构造函数，直接访问 protected 方法 */
  function makeProvider(): BaseAIProvider {
    return Object.create(BaseAIProvider.prototype) as BaseAIProvider;
  }

  it('流活跃时每轮清除计时器，不产生孤儿超时 rejection（根因回归）', async () => {
    process.on('unhandledRejection', onUnhandled);
    const provider = makeProvider();

    let calls = 0;
    let canceled = 0;
    const reader = {
      async read() {
        calls++;
        return { done: false, value: new Uint8Array([1]) };
      },
      async cancel() {
        canceled++;
      },
      releaseLock() {},
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    // 模拟 5 轮快速读取，每轮间隔 2ms < timeout(10ms)：总时长超过单轮 timeout
    for (let i = 0; i < 5; i++) {
      const r = await (provider as any).readStreamChunkWithTimeout(reader, 10);
      expect(r.done).toBe(false);
      await sleep(2);
    }

    // 等待超过 timeout，确认无孤儿 rejection 且流未被误 cancel
    await sleep(30);
    expect(calls).toBe(5);
    expect(canceled).toBe(0);
    expect(unhandled).toHaveLength(0);
  });

  it('单次读取真挂起超过 timeout 时正常抛错且不泄漏 rejection', async () => {
    process.on('unhandledRejection', onUnhandled);
    const provider = makeProvider();

    let canceled = 0;
    const reader = {
      read: () => new Promise<never>(() => {}), // 永不 resolve（真挂起）
      async cancel() {
        canceled++;
      },
      releaseLock() {},
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    await expect(
      (provider as any).readStreamChunkWithTimeout(reader, 20)
    ).rejects.toThrow(/无数据/);
    // 超时路径应取消底层流（释放挂起连接）
    expect(canceled).toBe(1);
    expect(unhandled).toHaveLength(0);
  });

  it('首次无数据超时后流恢复（重试窗口内读到数据）不报错', async () => {
    process.on('unhandledRejection', onUnhandled);
    const provider = makeProvider();

    let calls = 0;
    let canceled = 0;
    const reader = {
      async read() {
        calls++;
        if (calls === 1) {
          // 第一次调用挂起超过 timeout（20ms），模拟网络抖动/慢响应
          await sleep(40);
        }
        return { done: false, value: new Uint8Array([1]) };
      },
      async cancel() {
        canceled++;
      },
      releaseLock() {},
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    // timeout=20ms, timeoutRetries=1：首次超时（20ms）后自动重试窗口内（40ms）读到数据
    const r = await (provider as any).readStreamChunkWithTimeout(
      reader,
      20,
      1
    );
    expect(r.done).toBe(false);
    expect(calls).toBe(1); // 同一 read 挂起后恢复返回
    expect(canceled).toBe(0); // 恢复后不应取消流
    expect(unhandled).toHaveLength(0);
  });
});
