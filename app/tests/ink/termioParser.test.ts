// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// CSI 语义动作特征化（P3-2，2026-11-16）
//
// `parseCSI` 是一张「final byte → Action」的映射表，外移子段（光标移动 / DEC 私有模式）
// 不改变语义，但映射漏项只会静默变 unknown（不回退、不报错）⇒ 先用本表把每条映射与
// 兜底口径钉住，再做原样外移。断言走公开入口 `Parser.feed`。
import { describe, expect, it } from 'bun:test';
import { Parser } from '../../src/ink/ink/termio/parser';

const feed = (seq: string) => new Parser().feed(seq);

describe('parseCSI 光标移动映射', () => {
  it('A/B/C/D 四向移动带计数；无参数默认 1', () => {
    expect(feed('\x1b[2A')).toEqual([
      { type: 'cursor', action: { type: 'move', direction: 'up', count: 2 } },
    ]);
    expect(feed('\x1b[B')).toEqual([
      { type: 'cursor', action: { type: 'move', direction: 'down', count: 1 } },
    ]);
    expect(feed('\x1b[3C')).toEqual([
      {
        type: 'cursor',
        action: { type: 'move', direction: 'forward', count: 3 },
      },
    ]);
    expect(feed('\x1b[4D')).toEqual([
      { type: 'cursor', action: { type: 'move', direction: 'back', count: 4 } },
    ]);
  });

  it('E/F/G/d 单参数移动', () => {
    expect(feed('\x1b[3E')).toEqual([
      { type: 'cursor', action: { type: 'nextLine', count: 3 } },
    ]);
    expect(feed('\x1b[3F')).toEqual([
      { type: 'cursor', action: { type: 'prevLine', count: 3 } },
    ]);
    expect(feed('\x1b[7G')).toEqual([
      { type: 'cursor', action: { type: 'column', col: 7 } },
    ]);
    expect(feed('\x1b[9d')).toEqual([
      { type: 'cursor', action: { type: 'row', row: 9 } },
    ]);
  });

  it('H 与 f 同义：双参数定位（缺省第二个参数为 1）', () => {
    expect(feed('\x1b[2;5H')).toEqual([
      { type: 'cursor', action: { type: 'position', row: 2, col: 5 } },
    ]);
    expect(feed('\x1b[2;5f')).toEqual([
      { type: 'cursor', action: { type: 'position', row: 2, col: 5 } },
    ]);
    expect(feed('\x1b[3H')).toEqual([
      { type: 'cursor', action: { type: 'position', row: 3, col: 1 } },
    ]);
  });

  it('s / u 保存与恢复位置', () => {
    expect(feed('\x1b[s')).toEqual([
      { type: 'cursor', action: { type: 'save' } },
    ]);
    expect(feed('\x1b[u')).toEqual([
      { type: 'cursor', action: { type: 'restore' } },
    ]);
  });
});

describe('parseCSI 擦除 / 滚动映射', () => {
  it('J 按参数取区域，越界回 toEnd；3 为回滚缓冲', () => {
    expect(feed('\x1b[J')).toEqual([
      { type: 'erase', action: { type: 'display', region: 'toEnd' } },
    ]);
    expect(feed('\x1b[2J')).toEqual([
      { type: 'erase', action: { type: 'display', region: 'all' } },
    ]);
    expect(feed('\x1b[3J')).toEqual([
      { type: 'erase', action: { type: 'display', region: 'scrollback' } },
    ]);
    expect(feed('\x1b[9J')).toEqual([
      { type: 'erase', action: { type: 'display', region: 'toEnd' } },
    ]);
  });

  it('K 取行区域；X 擦字符带计数', () => {
    expect(feed('\x1b[1K')).toEqual([
      { type: 'erase', action: { type: 'line', region: 'toStart' } },
    ]);
    expect(feed('\x1b[4X')).toEqual([
      { type: 'erase', action: { type: 'chars', count: 4 } },
    ]);
  });

  it('S / T 滚动与 r 设滚动区', () => {
    expect(feed('\x1b[2S')).toEqual([
      { type: 'scroll', action: { type: 'up', count: 2 } },
    ]);
    expect(feed('\x1b[2T')).toEqual([
      { type: 'scroll', action: { type: 'down', count: 2 } },
    ]);
    expect(feed('\x1b[1;24r')).toEqual([
      { type: 'scroll', action: { type: 'setRegion', top: 1, bottom: 24 } },
    ]);
  });
});

describe('parseCSI 样式与私有模式映射', () => {
  it('SGR 只改状态、不产出动作', () => {
    const parser = new Parser();
    expect(parser.feed('\x1b[1;31m')).toEqual([]);
    expect(parser.style.bold).toBe(true);
    expect(parser.style.fg).toEqual({ type: 'named', name: 'red' });
  });

  it('DECSCUSR 带空格中间字节才生效', () => {
    expect(feed('\x1b[2 q')).toEqual([
      {
        type: 'cursor',
        action: { type: 'style', style: 'block', blinking: false },
      },
    ]);
    // 缺中间字节 ⇒ 不认，落 unknown（锁定现状）
    expect(feed('\x1b[2q')).toEqual([{ type: 'unknown', sequence: '\x1b[2q' }]);
  });

  it('DEC 私有模式：光标显隐 / 备用屏 / 粘贴 / 鼠标 / 焦点', () => {
    expect(feed('\x1b[?25h')).toEqual([
      { type: 'cursor', action: { type: 'show' } },
    ]);
    expect(feed('\x1b[?25l')).toEqual([
      { type: 'cursor', action: { type: 'hide' } },
    ]);
    expect(feed('\x1b[?1049h')).toEqual([
      { type: 'mode', action: { type: 'alternateScreen', enabled: true } },
    ]);
    expect(feed('\x1b[?2004h')).toEqual([
      { type: 'mode', action: { type: 'bracketedPaste', enabled: true } },
    ]);
    expect(feed('\x1b[?1000h')).toEqual([
      { type: 'mode', action: { type: 'mouseTracking', mode: 'normal' } },
    ]);
    expect(feed('\x1b[?1002h')).toEqual([
      { type: 'mode', action: { type: 'mouseTracking', mode: 'button' } },
    ]);
    expect(feed('\x1b[?1003l')).toEqual([
      { type: 'mode', action: { type: 'mouseTracking', mode: 'off' } },
    ]);
    expect(feed('\x1b[?1004h')).toEqual([
      { type: 'mode', action: { type: 'focusEvents', enabled: true } },
    ]);
  });

  it('未覆盖的 final byte 与私有 SGR 落 unknown（兜底口径不变）', () => {
    expect(feed('\x1b[5n')).toEqual([{ type: 'unknown', sequence: '\x1b[5n' }]);
    expect(feed('\x1b[?31m')).toEqual([
      { type: 'unknown', sequence: '\x1b[?31m' },
    ]);
  });
});
