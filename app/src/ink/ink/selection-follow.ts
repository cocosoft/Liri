/**
 * 跟随滚动的选区平移（P3-2，2026-11-17；从 `Ink.onRender` **原样外移**）
 *
 * 为什么单独成模块：`onRender` 的圈复杂度里有 13 个判定点都在这一件事上
 * （跟随滚动 → 选区随文本一起上移 / 触顶清空）。判定顺序与边界写法逐字保留，
 * 外移只把 `this.xxx` 换成入参。
 *
 * 关键约束（照抄原注释语义）：
 * - `frontScreen` 必须是**上一帧**的屏幕（此时前后缓冲尚未交换）——`captureScrolledRows`
 *   要读那些即将被滚出的行，文本才在选区滚出视口前一直可复制；
 * - `capture` 与 `shift` 必须成对出现，且 capture 留在每个 shift 分支内部
 *   （否则同一批视口行每帧重复相交，`scrolledOffAbove` 无界增长）；
 * - 选区被清空时**不能**通知 React 走 `notifySelectionChange`（会递归回 `onRender`）⇒
 *   由调用方在 `onCleared` 里直接触发订阅者。
 */
import type { FollowScroll } from './render-node-to-output.js';
import type { Screen } from './screen.js';
import {
  captureScrolledRows,
  hasSelection,
  shiftAnchor,
  shiftSelectionForFollow,
  type SelectionState,
} from './selection.js';

export function applyFollowScrollToSelection(input: {
  follow: FollowScroll | null;
  selection: SelectionState;
  /** 上一帧屏幕（前后缓冲交换**之前**的快照） */
  frontScreen: Screen;
  /** 选区被清空时回调（直接触发 React 端订阅者，不重入 onRender） */
  onCleared: () => void;
}): void {
  const { follow, selection, frontScreen, onCleared } = input;
  // Only translate if the selection is ON scrollbox content. Selections in the
  // footer/prompt/StickyPromptHeader are on static text — the scroll doesn't
  // move what's under them. Without this guard, a footer selection would be
  // shifted by -delta then clamped to viewportBottom, teleporting it into the
  // scrollbox. Mirror the bounds check the deleted check() in
  // ScrollKeybindingHandler had.
  if (
    !follow ||
    !selection.anchor ||
    selection.anchor.row < follow.viewportTop ||
    selection.anchor.row > follow.viewportBottom
  ) {
    return;
  }
  const { delta, viewportTop, viewportBottom } = follow;
  if (selection.isDragging) {
    if (hasSelection(selection)) {
      captureScrolledRows(
        selection,
        frontScreen,
        viewportTop,
        viewportTop + delta - 1,
        'above'
      );
    }
    shiftAnchor(selection, -delta, viewportTop, viewportBottom);
    return;
  }
  // Flag-3 guard: the anchor check above only proves ONE endpoint is on
  // scrollbox content. A drag from row 3 (scrollbox) into the footer at row 6,
  // then release, leaves focus outside the viewport — shiftSelectionForFollow
  // would clamp it to viewportBottom, teleporting the highlight from static
  // footer into the scrollbox. Symmetric check: require BOTH ends inside to
  // translate. A straddling selection falls through to NEITHER shift NOR
  // capture: the footer endpoint pins the selection, text scrolls away under
  // the highlight, and getSelectedText reads the CURRENT screen contents — no
  // accumulation. Dragging branch doesn't need this: shiftAnchor ignores focus,
  // and the anchor DOES shift (so capture is correct there even when focus is
  // in the footer).
  if (
    selection.focus &&
    (selection.focus.row < viewportTop || selection.focus.row > viewportBottom)
  ) {
    return;
  }
  if (hasSelection(selection)) {
    captureScrolledRows(
      selection,
      frontScreen,
      viewportTop,
      viewportTop + delta - 1,
      'above'
    );
  }
  const cleared = shiftSelectionForFollow(
    selection,
    -delta,
    viewportTop,
    viewportBottom
  );
  // Auto-clear (both ends overshot minRow) must notify React-land so
  // useHasSelection re-renders and the footer copy/escape hint disappears.
  if (cleared) onCleared();
}
