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
 * 侧栏面板的命中判定（`mouseleave` 的后代识别）
 *
 * 用途：`SessionHistorySidebar` 的 `position: fixed` 右键菜单 / 确认框虽然**视觉上**在面板
 * 盒子之外，但仍是面板的 **DOM 后代**；鼠标移入它们会先触发面板的 `mouseleave`。若不识别
 * 这一点，菜单会在点击瞬间被卸载 ⇒ 用 `relatedTarget` 做后代判定。
 *
 * ⚠️ 缺陷背景（2026-10-21 浏览器实测）：`relatedTarget` **不保证是 Node**
 * （指针移到浏览器 UI / 移出文档时可能是 `window`、`null` 或其它宿主对象），
 * 直接传给 `Element.contains` 会抛
 * `TypeError: Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'`。
 * 故这里先做 `instanceof Node` 守卫 —— 非 Node 一律视为"不在面板内"（fail-safe：结束 peek）。
 */

/**
 * 指针是否仍在面板内（含 fixed 定位的 DOM 后代）
 *
 * @param panel 面板根节点（可为 null / undefined）
 * @param relatedTarget `MouseEvent.relatedTarget`（类型未知，可能不是 Node）
 */
export function isInsidePanel(
  panel: Element | null | undefined,
  relatedTarget: unknown,
): boolean {
  return relatedTarget instanceof Node && !!panel?.contains(relatedTarget);
}
