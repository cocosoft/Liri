/**
 * B1（2026-09-26，《Liri 优化方案》）：输出上限的**唯一来源**与后端边界。
 *
 * 锁三件事：
 *  ① `SandboxPolicy` 是软/硬上限的唯一来源（策略层与常量一致，不再各写一份默认值）；
 *  ② `appendWithinLimit` 的逐块切片语义（含**多字节字符**的真实字节统计）；
 *  ③ PTY 后端**真实执行**下的截断可确定性判定（`truncated` / `truncatedBytes`）。
 *
 * 为什么 ③ 必须真跑：旧实现是"累计未超限就整块追加" ⇒ 命中与否取决于 OS 分块时机，
 * 边界断言写不出来（这正是 B1 要治的"不可确定性"）。
 */
import { describe, expect, it } from 'bun:test';
import {
  appendWithinLimit,
  createSandboxPolicy,
  MAX_OUTPUT_BYTES_HARD,
  MAX_OUTPUT_BYTES_SOFT,
  PRODUCTION_SANDBOX_POLICY,
  resolveOutputLimit,
} from '../../src/sandbox/SandboxPolicy';
import { PTYSandbox } from '../../src/sandbox/PTYSandbox';

describe('B1: resolveOutputLimit —— 输出上限的唯一来源', () => {
  it('不传参数 ⇒ 取唯一来源常量（后端不再自设 1MB 之类的就地默认）', () => {
    expect(resolveOutputLimit()).toEqual({
      soft: MAX_OUTPUT_BYTES_SOFT,
      hard: MAX_OUTPUT_BYTES_HARD,
    });
  });

  it('显式 soft 覆盖 ⇒ 只改软上限，硬上限仍取唯一来源', () => {
    expect(resolveOutputLimit({ soft: 100 })).toEqual({
      soft: 100,
      hard: MAX_OUTPUT_BYTES_HARD,
    });
  });

  it('边界：软 > 硬（误配反了）⇒ 回落为硬上限（不静默采用非法组合）', () => {
    expect(resolveOutputLimit({ soft: 1000, hard: 100 })).toEqual({
      soft: 100,
      hard: 100,
    });
  });

  it('策略层与唯一来源一致：createSandboxPolicy 默认取常量', () => {
    const policy = createSandboxPolicy();
    expect(policy.maxOutputBytes).toBe(MAX_OUTPUT_BYTES_SOFT);
    expect(policy.maxOutputBytesHard).toBe(MAX_OUTPUT_BYTES_HARD);
  });

  it('生产策略的软上限是**显式策略选择**（8MB），硬上限仍取唯一来源', () => {
    expect(PRODUCTION_SANDBOX_POLICY.maxOutputBytes).toBe(8 * 1024 * 1024);
    expect(PRODUCTION_SANDBOX_POLICY.maxOutputBytesHard).toBe(
      MAX_OUTPUT_BYTES_HARD
    );
  });
});

describe('B1: appendWithinLimit —— 逐块切片 + 真实字节统计', () => {
  it('未超限 ⇒ 原样追加、零丢弃', () => {
    expect(appendWithinLimit('abc', 'def', 10)).toEqual({
      text: 'abcdef',
      droppedBytes: 0,
    });
  });

  it('恰好等于上限 ⇒ 不丢弃', () => {
    expect(appendWithinLimit('abc', 'def', 6)).toEqual({
      text: 'abcdef',
      droppedBytes: 0,
    });
  });

  it('超限 ⇒ 只保留前 N 个字符，丢弃量按**真实字节**计', () => {
    // limit=4：acc 已 3 字符 ⇒ 只剩 1 字符额度；"中文" 2 字符只放得下"中"，丢弃"文"（3 字节）
    expect(appendWithinLimit('abc', '中文', 4)).toEqual({
      text: 'abc中',
      droppedBytes: 3,
    });
  });

  it('已达上限 ⇒ 整块丢弃（含多字节真实字节数）', () => {
    expect(appendWithinLimit('abcd', '中文', 4)).toEqual({
      text: 'abcd',
      droppedBytes: 6,
    });
  });
});

describe('B1: PTY 后端真实执行的截断边界', () => {
  it('小软上限 ⇒ truncated=true 且带出丢弃字节数、stdout 不越限', async () => {
    const sandbox = new PTYSandbox({ maxOutputBytes: 16 });
    const result = await sandbox.execute({ args: ['echo', 'x'.repeat(200)] });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(typeof result.truncatedBytes).toBe('number');
    expect(result.truncatedBytes).toBeGreaterThan(0);
    // stdout 只保留软上限字符 + 截断标记
    expect(result.stdout.length).toBeLessThanOrEqual(16 + '\n[输出已截断]'.length);
    expect(result.stdout.startsWith('x')).toBe(true);
  }, 30_000);

  it('未配软上限 ⇒ 走唯一来源（1MB），小输出不截断', async () => {
    const sandbox = new PTYSandbox();
    const result = await sandbox.execute({ args: ['echo', 'small'] });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.truncatedBytes).toBe(0);
  }, 30_000);
});
