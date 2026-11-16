// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`Output.get()` 的 **write × clip** 行为（P3-2 外移前置，2026-11-17）
 *
 * 目的：在把 `get()` 的 clip 应用段原样外移到独立模块**之前**，先用测试钉住当前行为
 * （水平裁剪 / 垂直裁剪 / 整块跳过 / softWrap 续行 join / 宽字符重切）。外移后本文件必须
 * **逐字不变、全绿**，以此作为「原样外移、零语义变更」的证据。
 *
 * 覆盖面界定（如实）：只锁 clip 应用段的输入输出；不锁 blit / shift / clear / noSelect
 * （它们不在本次外移范围内）。
 */

import { describe, expect, it } from 'bun:test';

import Output from '../../src/ink/ink/output';
import {
  CharPool,
  createScreen,
  HyperlinkPool,
  StylePool,
  charInCellAt,
  type Screen,
} from '../../src/ink/ink/screen';

function setup(width = 20, height = 6) {
  const stylePool = new StylePool();
  const screen = createScreen(
    width,
    height,
    stylePool,
    new CharPool(),
    new HyperlinkPool()
  );
  const output = new Output({ width, height, stylePool, screen });
  return { output, screen };
}

/** 行文本（尾部空白裁掉，便于断言可见内容） */
function rowText(screen: Screen, y: number): string {
  let text = '';
  for (let x = 0; x < screen.width; x++) {
    text += charInCellAt(screen, x, y) ?? ' ';
  }
  return text.replace(/\s+$/, '');
}

describe('Output.get() · write × clip（特征化）', () => {
  it('水平裁剪：只写 clip 区间内的字符，x 随之左移', () => {
    const { output, screen } = setup();
    output.clip({ x1: 2, x2: 5, y1: undefined, y2: undefined });
    output.write(0, 0, 'abcdef');
    output.unclip();
    output.get();
    expect(rowText(screen, 0)).toBe('  cde');
  });

  it('完全在 clip 右侧之外 ⇒ 整条跳过', () => {
    const { output, screen } = setup();
    output.clip({ x1: 10, x2: 20, y1: undefined, y2: undefined });
    output.write(0, 0, 'abc');
    output.unclip();
    output.get();
    expect(rowText(screen, 0)).toBe('');
  });

  it('垂直裁剪：只保留 clip 纵向区间内的行', () => {
    const { output, screen } = setup();
    output.clip({ x1: undefined, x2: undefined, y1: 2, y2: 4 });
    output.write(0, 0, 'a\nb\nc\nd');
    output.unclip();
    output.get();
    expect(rowText(screen, 0)).toBe('');
    expect(rowText(screen, 1)).toBe('');
    expect(rowText(screen, 2)).toBe('c');
    expect(rowText(screen, 3)).toBe('d');
  });

  it('完全在 clip 下方之外 ⇒ 整条跳过', () => {
    const { output, screen } = setup();
    output.clip({ x1: undefined, x2: undefined, y1: 0, y2: 2 });
    output.write(0, 5, 'below');
    output.unclip();
    output.get();
    expect(rowText(screen, 5)).toBe('');
  });

  it('softWrap：被垂直裁掉首行时，首可见行仍记录上一行内容终点（join 点）', () => {
    const { output, screen } = setup();
    output.clip({ x1: undefined, x2: undefined, y1: 1, y2: 3 });
    // softWrap[1]=true ⇒ 第 2 行是第 1 行的续行
    output.write(0, 0, 'A\nB', [false, true]);
    output.unclip();
    output.get();
    expect(rowText(screen, 1)).toBe('B');
    // 上一行（被裁掉）内容终点 = x + 宽度('A') = 1
    expect(screen.softWrap[1]).toBe(1);
  });

  it('宽字符裁剪（如实钉住现状）：sliceAnsi 是简单 slice ⇒ 一次重切仍可能越界一格', () => {
    const { output, screen } = setup();
    output.clip({ x1: 0, x2: 3, y1: undefined, y2: undefined });
    output.write(0, 0, '中文测试');
    output.unclip();
    output.get();
    // ⚠️ 既有行为（**本次只外移、不改语义**）：`sliceAnsi` 实为 `text.slice()`（按字符而非
    // 单元格），`to` 却按单元格算 ⇒ 第一次切出「中文测」（宽 6 > 3），重切 `to-1` 得「中文」
    // （宽 4，仍 > 3）且只重试一次 ⇒ 实际占用 0..3 四格（比 clip.x2=3 越界一格）。
    // 该缺陷与「宽字符重切」注释所声明的语义不一致，属既存问题；修它需换真正的 ANSI 感知
    // 切片器（另立任务），本文件只用于保证外移前后**逐字等价**。
    expect(rowText(screen, 0)).toBe('中文');
    expect(charInCellAt(screen, 4, 0)).toBe(' ');
  });
});
