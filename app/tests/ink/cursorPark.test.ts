// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试（P3-2）：`applyDeclaredCursor`（从 `Ink.onRender` 原样外移）。
 *
 * 锁住四类现状语义：
 * 1. 空 diff 且 park 目标未变 ⇒ **零写入**快速路径；
 * 2. 主屏：上一帧 park 在别处且有 diff ⇒ 先补一次回退移动（log-update 假设物理光标在
 *    `prevCursor`）；
 * 3. alt 屏：用绝对定位，且坐标夹到终端尺寸内（1 起算）；
 * 4. 声明清除（失焦/卸载）且无 diff ⇒ 把物理光标退回 `frameCursor` 并清空 park 记录。
 */
import { describe, expect, it } from 'bun:test';

import type { CursorDeclaration } from '../../src/ink/ink/components/CursorDeclarationContext.js';
import type { Patch } from '../../src/ink/ink/frame.js';
import { applyDeclaredCursor } from '../../src/ink/ink/cursor-park.js';
import { cursorPosition } from '../../src/ink/ink/termio/csi.js';

/** 声明节点只用到 `relativeX/relativeY`，`node` 不进本函数的任何分支 */
const DECL = {
  relativeX: 3,
  relativeY: 2,
  node: {} as CursorDeclaration['node'],
} as CursorDeclaration;

const BASE = {
  prevCursor: { x: 0, y: 0 },
  frameCursor: { x: 0, y: 0 },
  terminalRows: 24,
  terminalWidth: 80,
  altScreenActive: false,
  hasDiff: false,
};

function stdoutPatches(patches: Patch[]): string[] {
  return patches
    .filter(
      (patch): patch is { type: 'stdout'; content: string } =>
        patch.type === 'stdout'
    )
    .map((patch) => patch.content);
}

describe('applyDeclaredCursor — 现状语义', () => {
  it('无声明、无 park、无 diff ⇒ 返回 null 且零写入', () => {
    const patches: Patch[] = [];
    const next = applyDeclaredCursor({
      ...BASE,
      declaration: null,
      rect: undefined,
      parked: null,
      patches,
    });
    expect(next).toBeNull();
    expect(patches).toEqual([]);
  });

  it('空 diff 且目标与 park 相同 ⇒ 零写入（快速路径）', () => {
    const patches: Patch[] = [];
    const next = applyDeclaredCursor({
      ...BASE,
      declaration: DECL,
      rect: { x: 10, y: 10 },
      parked: { x: 13, y: 12 },
      patches,
    });
    expect(next).toEqual({ x: 13, y: 12 });
    expect(patches).toEqual([]);
  });

  it('主屏 + 有 diff + 上一帧 park 在别处 ⇒ 先补回退移动', () => {
    const patches: Patch[] = [];
    const next = applyDeclaredCursor({
      ...BASE,
      hasDiff: true,
      declaration: null,
      rect: undefined,
      parked: { x: 10, y: 5 },
      patches,
    });
    expect(next).toBeNull();
    // 回退到 prevCursor(0,0)：dx=-10, dy=-5 ⇒ 一条 stdout 补丁
    expect(stdoutPatches(patches)).toHaveLength(1);
    expect(patches[0]?.type).toBe('stdout');
  });

  it('alt 屏 + 声明目标越界 ⇒ 绝对定位夹到 (1,1)', () => {
    const patches: Patch[] = [];
    const next = applyDeclaredCursor({
      ...BASE,
      altScreenActive: true,
      hasDiff: true,
      declaration: DECL,
      // relativeX/Y 让目标落在负坐标
      rect: { x: -10, y: -10 },
      parked: null,
      patches,
    });
    expect(next).toEqual({ x: -7, y: -8 });
    expect(stdoutPatches(patches)).toEqual([cursorPosition(1, 1)]);
  });

  it('主屏 + 无 diff + 声明清除 ⇒ 退回 frameCursor 并清空 park', () => {
    const patches: Patch[] = [];
    const next = applyDeclaredCursor({
      ...BASE,
      declaration: null,
      rect: undefined,
      parked: { x: 10, y: 5 },
      frameCursor: { x: 0, y: 0 },
      patches,
    });
    expect(next).toBeNull();
    expect(stdoutPatches(patches)).toHaveLength(1);
  });

  it('主屏 + 无 diff + 目标移动 ⇒ 从上一帧 park 位置做相对移动', () => {
    const patches: Patch[] = [];
    const next = applyDeclaredCursor({
      ...BASE,
      declaration: DECL,
      rect: { x: 0, y: 0 },
      parked: { x: 10, y: 5 },
      patches,
    });
    expect(next).toEqual({ x: 3, y: 2 });
    // (3,2) 相对 (10,5) ⇒ dx=-7, dy=-3 ⇒ 一条 stdout 补丁
    expect(stdoutPatches(patches)).toHaveLength(1);
  });
});
