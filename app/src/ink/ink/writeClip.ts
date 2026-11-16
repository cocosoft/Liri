// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * writeClip.ts — `write` 操作的 **clip 应用段**（2026-11-17，P3-2 复杂度外移）
 *
 * 从 `output.ts` 的 `Output.get()` 逐字外移（第 60 项复杂度告警）：只把「按当前 clip 裁剪
 * 文本 / 行窗口 / softWrap 起点」这一段纯计算搬出来，**判定顺序、边界写法、注释语义
 * 一字未改**。等价性由 `tests/ink/outputWriteClip.test.ts`（外移前先写的特征化用例）锁定。
 *
 * 已知既存缺陷（**本次不改**）：`sliceAnsi` 实为 `text.slice()`（按字符而非单元格），而 `to`
 * 按单元格计算 ⇒ 宽字符边界只重切一次仍可能越界一格。属切片器本身的问题，单独立项修。
 */

import sliceAnsi from '../utils/sliceAnsi.js';
import { stringWidth } from './stringWidth.js';
import { widestLine } from './widest-line.js';

export type Clip = {
  x1: number | undefined;
  x2: number | undefined;
  y1: number | undefined;
  y2: number | undefined;
};

/** clip 应用后的写入参数（`null` = 该 write 整条被裁掉） */
export type ClippedWrite = {
  x: number;
  y: number;
  lines: string[];
  /** 首可见行在原始 `lines` 中的下标（供 softWrap 位图取用） */
  swFrom: number;
  /** 首可见行若是续行，其 join 点 = 被裁掉首行的内容终点 */
  prevContentEnd: number;
};

/**
 * 把 clip 应用到一条 `write` 操作上。
 *
 * @returns 裁剪后的 `{x, y, lines, swFrom, prevContentEnd}`；整条落在 clip 之外时返回 `null`
 *          （调用方按 `continue` 处理，与内联版逐字等价）。
 */
export function applyClipToWrite(
  x0: number,
  y0: number,
  text: string,
  softWrap: boolean[] | undefined,
  clip: Clip | undefined
): ClippedWrite | null {
  let x = x0;
  let y = y0;
  let lines = text.split('\n');
  let swFrom = 0;
  let prevContentEnd = 0;

  if (clip) {
    const clipHorizontally =
      typeof clip?.x1 === 'number' && typeof clip?.x2 === 'number';

    const clipVertically =
      typeof clip?.y1 === 'number' && typeof clip?.y2 === 'number';

    // If text is positioned outside of clipping area altogether,
    // skip to the next operation to avoid unnecessary calculations
    if (clipHorizontally) {
      const width = widestLine(text);

      if (x + width <= clip.x1! || x >= clip.x2!) {
        return null;
      }
    }

    if (clipVertically) {
      const height = lines.length;

      if (y + height <= clip.y1! || y >= clip.y2!) {
        return null;
      }
    }

    if (clipHorizontally) {
      lines = lines.map((line) => {
        const from = x < clip.x1! ? clip.x1! - x : 0;
        const width = stringWidth(line);
        const to = x + width > clip.x2! ? clip.x2! - x : width;
        let sliced = sliceAnsi(line, from, to);
        // Wide chars (CJK, emoji) occupy 2 cells. When `to` lands on the
        // first cell of a wide char, sliceAnsi includes the entire glyph
        // and the result overflows clip.x2 by one cell, writing a
        // SpacerTail into the adjacent sibling. Re-slice one cell earlier;
        // wide chars are exactly 2 cells, so a single retry always fits.
        if (stringWidth(sliced) > to - from) {
          sliced = sliceAnsi(line, from, to - 1);
        }
        return sliced;
      });

      if (x < clip.x1!) {
        x = clip.x1!;
      }
    }

    if (clipVertically) {
      const from = y < clip.y1! ? clip.y1! - y : 0;
      const height = lines.length;
      const to = y + height > clip.y2! ? clip.y2! - y : height;

      // If the first visible line is a soft-wrap continuation, we need the
      // clipped previous line's content end so screen.softWrap[lineY]
      // correctly records the join point even though that line's cells
      // were never written.
      if (softWrap && from > 0 && softWrap[from] === true) {
        prevContentEnd = x + stringWidth(lines[from - 1]!);
      }

      lines = lines.slice(from, to);
      swFrom = from;

      if (y < clip.y1!) {
        y = clip.y1!;
      }
    }
  }

  return { x, y, lines, swFrom, prevContentEnd };
}
