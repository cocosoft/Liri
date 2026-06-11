// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * Ink 常量定义
 * 包含渲染引擎共享的常量与补丁对象
 */

import { CURSOR_HOME, cursorPosition, ERASE_SCREEN } from './termio/csi.js';

// Shared frame interval for render throttling and animations (~60fps)
export const FRAME_INTERVAL_MS = 16;

// Alt-screen: renderer.ts sets cursor.visible = !isTTY || screen.height===0,
// which is always false in alt-screen (TTY + content fills screen).
// Reusing a frozen object saves 1 allocation per frame.
export const ALT_SCREEN_ANCHOR_CURSOR = Object.freeze({
  x: 0,
  y: 0,
  visible: false,
  save: () => {},
  restore: () => {},
  moveTo: (_x: number, _y: number) => {},
  reset: () => {},
});

export const CURSOR_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: CURSOR_HOME,
});

export const ERASE_THEN_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: ERASE_SCREEN + CURSOR_HOME,
});

// Cached per-Ink-instance, invalidated on resize. frame.cursor.y for
// alt-screen is always terminalRows - 1 (renderer.ts).
export function makeAltScreenParkPatch(terminalRows: number) {
  return Object.freeze({
    type: 'stdout' as const,
    content: cursorPosition(terminalRows, 1),
  });
}
