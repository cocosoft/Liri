/**
 * 声明式光标落位（P3-2，2026-11-17；从 `Ink.onRender` **原样外移**）
 *
 * 把"本帧结束后物理光标停在哪"这一段从 `onRender` 抽出：它是纯计算 + 往 patch
 * 列表里插两类写入（主屏的**相对移动**与 alt 屏的**绝对定位**），判定顺序、夹取
 * 边界与提前返回条件逐字保留。
 *
 * 不变量（照抄原注释语义）：
 * - 主屏：`log-update` 的相对移动假设物理光标在 `prevCursor`；若上一帧把光标 park
 *   在别处，**先补一次回退移动**再交给 diff；
 * - alt 屏：每帧开头有 CSI H 兜底，用绝对 CUP（1 起算，夹到终端尺寸内）即可；
 * - 空 diff + park 目标未变 ⇒ **零写入**快速路径（本函数的第一个 if 就是它）；
 * - 声明被清除时（失焦/卸载）要把物理光标退回 `frameCursor` 再忘记 park 位置，
 *   否则下一帧的前导移动会从错误位置算起。
 */
import type { CursorDeclaration } from './components/CursorDeclarationContext.js';
import type { Patch } from './frame.js';
import { cursorMove, cursorPosition } from './termio/csi.js';

/** 屏幕坐标（`col`/`row` 语义按调用方，本模块只做加减） */
export interface Point {
  x: number;
  y: number;
}

/**
 * 应用本帧的声明式光标落位。
 *
 * @returns 下一帧应记录的 `displayCursor`（`null` = 本帧没有 park）
 */
export function applyDeclaredCursor(input: {
  declaration: CursorDeclaration | null;
  /** 声明节点在本帧的绝对屏幕矩形（`nodeCache.get(declaration.node)`） */
  rect: Point | undefined;
  /** 上一帧 park 的位置（`null` = 上一帧没 park） */
  parked: Point | null;
  /** 上一帧的 `frame.cursor`（主屏相对移动的基准） */
  prevCursor: Point;
  /** 本帧的 `frame.cursor`（无 diff 时的基准） */
  frameCursor: Point;
  terminalRows: number;
  terminalWidth: number;
  altScreenActive: boolean;
  hasDiff: boolean;
  /** 就地插入补丁（与调用方共用同一个数组） */
  patches: Patch[];
}): Point | null {
  const {
    declaration,
    rect,
    parked,
    prevCursor,
    frameCursor,
    terminalRows,
    terminalWidth,
    altScreenActive,
    hasDiff,
    patches,
  } = input;

  const target =
    declaration !== null && rect !== undefined
      ? {
          x: rect.x + declaration.relativeX,
          y: rect.y + declaration.relativeY,
        }
      : null;

  // Preserve the empty-diff zero-write fast path: skip all cursor writes
  // when nothing rendered AND the park target is unchanged.
  const targetMoved =
    target !== null &&
    (parked === null || parked.x !== target.x || parked.y !== target.y);
  if (!(hasDiff || targetMoved || (target === null && parked !== null))) {
    return parked;
  }

  // Main-screen preamble: log-update's relative moves assume the physical
  // cursor is at prevFrame.cursor. If last frame parked it elsewhere, move
  // back before the diff runs. Alt-screen's CSI H already resets to (0,0)
  // so no preamble needed.
  if (parked !== null && !altScreenActive && hasDiff) {
    const pdx = prevCursor.x - parked.x;
    const pdy = prevCursor.y - parked.y;
    if (pdx !== 0 || pdy !== 0) {
      patches.unshift({ type: 'stdout', content: cursorMove(pdx, pdy) });
    }
  }

  if (target !== null) {
    if (altScreenActive) {
      // Absolute CUP (1-indexed); next frame's CSI H resets regardless.
      const row = Math.min(Math.max(target.y + 1, 1), terminalRows);
      const col = Math.min(Math.max(target.x + 1, 1), terminalWidth);
      patches.push({ type: 'stdout', content: cursorPosition(row, col) });
    } else {
      // After the diff (or preamble), cursor is at frame.cursor. If no diff
      // AND previously parked, it's still at the old park position
      // (log-update wrote nothing). Otherwise it's at frame.cursor.
      const from = !hasDiff && parked !== null ? parked : frameCursor;
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      if (dx !== 0 || dy !== 0) {
        patches.push({ type: 'stdout', content: cursorMove(dx, dy) });
      }
    }
    return target;
  }

  // Declaration cleared (input blur, unmount). Restore physical cursor to
  // frame.cursor before forgetting the park position — otherwise
  // displayCursor=null lies about where the cursor is, and the NEXT frame's
  // preamble (or log-update's relative moves) computes from a wrong spot.
  // The preamble above handles hasDiff; this handles !hasDiff (e.g.
  // accessibility mode where blur doesn't change renderedValue since invert
  // is identity).
  if (parked !== null && !altScreenActive && !hasDiff) {
    const rdx = frameCursor.x - parked.x;
    const rdy = frameCursor.y - parked.y;
    if (rdx !== 0 || rdy !== 0) {
      patches.push({ type: 'stdout', content: cursorMove(rdx, rdy) });
    }
  }
  return null;
}
