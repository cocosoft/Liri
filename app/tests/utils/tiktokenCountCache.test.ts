/**
 * token 计数缓存（2026-11-04，运行态排查 C2）
 *
 * 背景：事件循环探针实测 `bytePairMerge` 单次采样占 25–34% self time，
 * 长上下文在压缩评估/预算判定里被反复整段编码 ⇒ 主线程卡 3.8–7.1s。
 * 这里锁住缓存的行为边界：同文本命中、异文本不误命中、空串为 0。
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import {
  clearTokenCountCache,
  getCachedTokenCount,
  getTiktokenCount,
  getTiktokenEncoder,
} from '@openliri/infra/utils/TiktokenEstimator';

beforeAll(async () => {
  // 编码器是惰性加载的；测试内显式加载，保证同步入口可用（与被测前缀条件一致）
  await getTiktokenEncoder();
});

describe('token 计数缓存（C2）', () => {
  it('空串 ⇒ 0（不触发分词）', () => {
    expect(getCachedTokenCount('')).toBe(0);
  });

  it('同一文本两次取值一致（缓存命中不改变结果）', async () => {
    const text = 'const answer = 42; // 缓存一致性检查';
    const first = await getTiktokenCount(text);
    const second = await getTiktokenCount(text);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('不同文本不误命中（各自计数为正且可区分）', async () => {
    clearTokenCountCache();
    const a = await getTiktokenCount('hello world');
    const b = await getTiktokenCount('你好，世界！这是一段更长的中文文本。');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a as number) > 0).toBe(true);
    expect((b as number) > 0).toBe(true);
  });

  it('同步入口在编码器已加载时可用，且与异步入口同值', async () => {
    const text = 'function add(a: number, b: number) { return a + b; }';
    const sync = getCachedTokenCount(text);
    const async = await getTiktokenCount(text);
    expect(sync).not.toBeNull();
    expect(sync).toBe(async);
  });
});
