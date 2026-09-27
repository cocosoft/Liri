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
 * P2-2 收敛契约：媒体工具名判定单一来源
 *
 * 语义 A（isMediaToolName）：多媒体结果类 ⇒ 结果走 ImageToolResult 专用渲染
 * 语义 B（isMediaDisplayToolName）：直接展示类 ⇒ 默认展开、跳过折叠分组
 * B ⊂ A，两集合语义不同，禁止合并为同一清单。
 */
import { describe, expect, test } from "vitest";
import {
  isMediaDisplayToolName,
  isMediaToolName,
} from "../utils/toolHumanSummary";

describe("P2-2 媒体工具名单一定义", () => {
  test("语义 A：多媒体结果类工具命中专用渲染", () => {
    for (const name of [
      "image_generate",
      "image_svg_generate",
      "image_analysis",
      "image_display",
      "video_display",
      "audio_play",
      "canvas",
      "image",
    ]) {
      expect(isMediaToolName(name)).toBe(true);
    }
    expect(isMediaToolName("bash")).toBe(false);
    expect(isMediaToolName("file_write")).toBe(false);
  });

  test("语义 B：直接展示类工具默认展开且不进折叠组", () => {
    for (const name of ["image_display", "video_display", "audio_play"]) {
      expect(isMediaDisplayToolName(name)).toBe(true);
      // B ⊆ A
      expect(isMediaToolName(name)).toBe(true);
    }
    // image_generate 属 A 不属 B（生成过程仍需折叠）
    expect(isMediaToolName("image_generate")).toBe(true);
    expect(isMediaDisplayToolName("image_generate")).toBe(false);
  });

  test("未定义或空工具名不误判", () => {
    expect(isMediaToolName(undefined)).toBe(false);
    expect(isMediaDisplayToolName(undefined)).toBe(false);
    expect(isMediaToolName("")).toBe(false);
  });
});
