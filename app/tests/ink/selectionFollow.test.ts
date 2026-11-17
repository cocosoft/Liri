// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试（P3-2）：`applyFollowScrollToSelection`（从 `Ink.onRender` 原样外移）。
 *
 * 锁住三类现状语义：
 * 1. 锚点不在 ScrollBox 视口内 / 无跟随事件 ⇒ **完全不动**（页脚选区不被平移）；
 * 2. 拖拽中只平移 anchor（focus 交给鼠标），跟随态两端一起平移；
 * 3. 两端都滚出视口 ⇒ 清空选区并回调一次（调用方据此通知 React）。
 */
import { describe, expect, it } from 'bun:test';

import {
  createSelectionState,
  startSelection,
} from '../../src/ink/ink/selection.js';
import {
  createScreen,
  CharPool,
  HyperlinkPool,
  StylePool,
} from '../../src/ink/ink/screen.js';
import { applyFollowScrollToSelection } from '../../src/ink/ink/selection-follow.js';

function makeScreen() {
  const stylePool = new StylePool();
  return createScreen(20, 30, stylePool, new CharPool(), new HyperlinkPool());
}

/** 视口 5..20 的一帧跟随事件 */
const FOLLOW = { delta: 3, viewportTop: 5, viewportBottom: 20 };

describe('applyFollowScrollToSelection — 现状语义', () => {
  it('无跟随事件 ⇒ 选区不动', () => {
    const selection = createSelectionState();
    startSelection(selection, 2, 10);
    selection.focus = { col: 4, row: 12 };
    applyFollowScrollToSelection({
      follow: null,
      selection,
      frontScreen: makeScreen(),
      onCleared: () => {},
    });
    expect(selection.anchor).toEqual({ col: 2, row: 10 });
    expect(selection.focus).toEqual({ col: 4, row: 12 });
  });

  it('锚点在视口外（页脚选区）⇒ 不平移', () => {
    const selection = createSelectionState();
    startSelection(selection, 2, 2);
    selection.focus = { col: 4, row: 3 };
    applyFollowScrollToSelection({
      follow: FOLLOW,
      selection,
      frontScreen: makeScreen(),
      onCleared: () => {},
    });
    expect(selection.anchor).toEqual({ col: 2, row: 2 });
    expect(selection.focus).toEqual({ col: 4, row: 3 });
  });

  it('拖拽中 ⇒ 只平移 anchor，focus 留给鼠标', () => {
    const selection = createSelectionState();
    startSelection(selection, 2, 10);
    selection.focus = { col: 4, row: 12 };
    selection.isDragging = true;
    applyFollowScrollToSelection({
      follow: FOLLOW,
      selection,
      frontScreen: makeScreen(),
      onCleared: () => {},
    });
    expect(selection.anchor).toEqual({ col: 2, row: 7 });
    expect(selection.focus).toEqual({ col: 4, row: 12 });
  });

  it('跟随态（非拖拽）⇒ 两端一起平移', () => {
    const selection = createSelectionState();
    startSelection(selection, 2, 10);
    selection.focus = { col: 4, row: 12 };
    // `startSelection` 是 mouse-down ⇒ 默认 isDragging=true；跟随态要显式置 false
    selection.isDragging = false;
    applyFollowScrollToSelection({
      follow: FOLLOW,
      selection,
      frontScreen: makeScreen(),
      onCleared: () => {},
    });
    expect(selection.anchor).toEqual({ col: 2, row: 7 });
    expect(selection.focus).toEqual({ col: 4, row: 9 });
  });

  it('focus 在视口外（跨页脚选区）⇒ 不平移也不捕获', () => {
    const selection = createSelectionState();
    startSelection(selection, 2, 10);
    selection.focus = { col: 4, row: 25 };
    selection.isDragging = false;
    applyFollowScrollToSelection({
      follow: FOLLOW,
      selection,
      frontScreen: makeScreen(),
      onCleared: () => {},
    });
    expect(selection.anchor).toEqual({ col: 2, row: 10 });
    expect(selection.focus).toEqual({ col: 4, row: 25 });
  });

  it('两端都滚出视口 ⇒ 清空并回调一次', () => {
    const selection = createSelectionState();
    startSelection(selection, 2, 5);
    selection.focus = { col: 3, row: 5 };
    selection.isDragging = false;
    let cleared = 0;
    applyFollowScrollToSelection({
      follow: FOLLOW,
      selection,
      frontScreen: makeScreen(),
      onCleared: () => {
        cleared += 1;
      },
    });
    expect(selection.anchor).toBeNull();
    expect(selection.focus).toBeNull();
    expect(cleared).toBe(1);
  });
});
