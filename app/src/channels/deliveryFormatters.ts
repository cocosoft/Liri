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
 * 投递格式转换器（纯函数）
 *
 * 用于 DeliveryRouter 的降级链路：
 *   interactive → markdown → text
 *
 * 每个转换函数接受上一级格式的内容，返回下一级格式的纯文本。
 */

import type { DeliveryInteractiveCard } from './DeliveryRouter';

/** 降级链顺序（模块级常量，新增格式只需在此数组加一项） */
export const DELIVERY_FORMAT_CHAIN = [
  'interactive',
  'markdown',
  'text',
] as const;

/**
 * Interactive → Markdown 转换
 * 将交互卡片的 title + options 转为 Markdown 文本
 */
export function interactiveToMarkdown(
  card: DeliveryInteractiveCard,
  fallbackText: string
): string {
  const lines: string[] = [];

  if (card.title) {
    lines.push(`**${card.title}**`);
  }
  if (card.color) {
    lines.push(`_(${card.color})_`);
  }
  if (card.options && card.options.length > 0) {
    lines.push('');
    for (const opt of card.options) {
      lines.push(`- ${opt.label}`);
    }
  }
  if (fallbackText) {
    lines.push('');
    lines.push(fallbackText);
  }

  return lines.join('\n');
}

/**
 * Markdown → Text 转换
 * 剥离常见 Markdown 格式符号
 */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, '$1') // **加粗** → 加粗
    .replace(/\*(.+?)\*/g, '$1') // *斜体* → 斜体
    .replace(/`(.+?)`/g, '$1') // `代码` → 代码
    .replace(/\[(.+?)]\(.+?\)/g, '$1') // [链接](url) → 链接
    .trim();
}
