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

import type { InteractiveCard } from './types/IChannel';

/** 降级链顺序（模块级常量，新增格式只需在此数组加一项） */
export const DELIVERY_FORMAT_CHAIN = [
  'interactive',
  'markdown',
  'text',
] as const;

/** 格式名（= 降级链成员；就地取联合类型，避免从 `DeliveryRouter` 反向导入造成环） */
export type DeliveryFormatName = (typeof DELIVERY_FORMAT_CHAIN)[number];

/**
 * 通道对"高保真格式"的**声明式**支持（阶段 1.2）。
 * 缺省均为 `true` ⇒ 与既有"逐级尝试"行为**完全一致**（不改变现状）。
 */
export interface DeliveryFormatSupport {
  interactive: boolean;
  markdown: boolean;
}

/**
 * 解析从 `from` 到更低格式的**候选降级序列**（**声明驱动**）：通道**明确声明不支持**的格式
 * **直接跳过** —— 不再"先发一次、失败再降级"（少一次注定失败的往返）。`text` 为兜底恒在链尾。
 *
 * 例：`from='interactive'` 且 `{interactive:true, markdown:false}` ⇒ `['text']`（跳过 markdown）。
 */
export function resolveDeliveryFallbacks(
  from: DeliveryFormatName,
  support: DeliveryFormatSupport
): DeliveryFormatName[] {
  const idx = DELIVERY_FORMAT_CHAIN.indexOf(from);
  if (idx === -1) return [];
  const out: DeliveryFormatName[] = [];
  for (let i = idx + 1; i < DELIVERY_FORMAT_CHAIN.length; i++) {
    const f = DELIVERY_FORMAT_CHAIN[i];
    if (f === 'interactive' && !support.interactive) continue;
    if (f === 'markdown' && !support.markdown) continue;
    out.push(f); // `text` 恒入（任何通道都能收纯文本）
  }
  return out;
}

/**
 * Interactive → Markdown 转换
 *
 * 2026-10-20（W-1）：卡片类型**收敛为唯一一种** `InteractiveCard`（`channels/types/IChannel.ts`），
 * 本函数按 `title → color → content → buttons → fallbackText` 渲染。
 * 原 `DeliveryInteractiveCard.options[{label,value}]` 已并入 `buttons[{text,value,style?}]`。
 */
export function interactiveToMarkdown(
  card: InteractiveCard,
  fallbackText: string
): string {
  const lines: string[] = [];

  if (card.title) {
    lines.push(`**${card.title}**`);
  }
  if (card.color) {
    lines.push(`_(${card.color})_`);
  }
  if (card.content) {
    lines.push('');
    lines.push(card.content);
  }
  if (card.buttons && card.buttons.length > 0) {
    lines.push('');
    for (const btn of card.buttons) {
      lines.push(`- ${btn.text}`);
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
