// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`ink/termio/tokenize`（P3-2 拆分前置）。
 *
 * 这是一个纯状态机（ground / escape / csi / ss3 / osc / dcs / apc），
 * 先把「文本块 / 转义序列边界 / 跨 feed 续传 / flush / X10 鼠标门控」锁住，
 * 再把分支判据外移为纯函数（行为必须逐字不变）。
 */
import { describe, expect, it } from 'bun:test';
import { createTokenizer } from '../../src/ink/ink/termio/tokenize';

describe('createTokenizer 既有行为', () => {
  it('纯文本 ⇒ 单个 text token', () => {
    const t = createTokenizer();
    expect(t.feed('hello')).toEqual([{ type: 'text', value: 'hello' }]);
  });

  it('完整 CSI ⇒ 一个 sequence token', () => {
    const t = createTokenizer();
    expect(t.feed('\x1b[A')).toEqual([{ type: 'sequence', value: '\x1b[A' }]);
  });

  it('文本与序列混排 ⇒ 边界正确', () => {
    const t = createTokenizer();
    expect(t.feed('a\x1b[Ab')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'sequence', value: '\x1b[A' },
      { type: 'text', value: 'b' },
    ]);
  });

  it('跨 feed 续传：先缓冲不完整序列，后续补齐', () => {
    const t = createTokenizer();
    expect(t.feed('\x1b[')).toEqual([]);
    expect(t.buffer()).toBe('\x1b[');
    expect(t.feed('A')).toEqual([{ type: 'sequence', value: '\x1b[A' }]);
    expect(t.buffer()).toBe('');
  });

  it('flush ⇒ 强制输出不完整序列', () => {
    const t = createTokenizer();
    expect(t.feed('\x1b[12')).toEqual([]);
    expect(t.flush()).toEqual([{ type: 'sequence', value: '\x1b[12' }]);
  });

  it('OSC 以 BEL / ST 结束', () => {
    const bel = createTokenizer();
    expect(bel.feed('\x1b]0;t\x07')).toEqual([
      { type: 'sequence', value: '\x1b]0;t\x07' },
    ]);
    const st = createTokenizer();
    expect(st.feed('\x1b]0;t\x1b\\')).toEqual([
      { type: 'sequence', value: '\x1b]0;t\x1b\\' },
    ]);
  });

  it('DCS / APC 以 BEL 或 ST 结束', () => {
    expect(createTokenizer().feed('\x1bPdata\x07')).toEqual([
      { type: 'sequence', value: '\x1bPdata\x07' },
    ]);
    expect(createTokenizer().feed('\x1b_apc\x1b\\')).toEqual([
      { type: 'sequence', value: '\x1b_apc\x1b\\' },
    ]);
  });

  it('SS3 与两字符转义序列', () => {
    expect(createTokenizer().feed('\x1bOA')).toEqual([
      { type: 'sequence', value: '\x1bOA' },
    ]);
    expect(createTokenizer().feed('\x1b7')).toEqual([
      { type: 'sequence', value: '\x1b7' },
    ]);
  });

  it('非法 ESC + 非终结字节 ⇒ 退化为文本（不吞字符）', () => {
    const t = createTokenizer();
    expect(t.feed('\x1b\n')).toEqual([{ type: 'text', value: '\x1b\n' }]);
  });

  it('X10 鼠标门控：默认关闭 ⇒ `ESC [ M` 按普通 CSI 收尾，载荷留给文本', () => {
    const t = createTokenizer();
    expect(t.feed('\x1b[Mabc')).toEqual([
      { type: 'sequence', value: '\x1b[M' },
      { type: 'text', value: 'abc' },
    ]);
  });

  it('X10 鼠标门控：开启 ⇒ 连同 3 字节载荷整体作为一个序列', () => {
    const t = createTokenizer({ x10Mouse: true });
    expect(t.feed('\x1b[Mabc')).toEqual([
      { type: 'sequence', value: '\x1b[Mabc' },
    ]);
  });

  it('X10 开启但载荷不足 4 字节 ⇒ 缓冲等待，不误吞', () => {
    const t = createTokenizer({ x10Mouse: true });
    expect(t.feed('\x1b[Ma')).toEqual([]);
    expect(t.buffer()).toBe('\x1b[Ma');
  });

  it('reset ⇒ 清空状态与缓冲', () => {
    const t = createTokenizer();
    t.feed('\x1b[');
    t.reset();
    expect(t.buffer()).toBe('');
    expect(t.feed('x')).toEqual([{ type: 'text', value: 'x' }]);
  });
});
