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
 * 渠道绑定提取（2026-11-11）：入站 `metadata` → `session.metadata.channelBinding`。
 *
 * 口径（与 `channels/binding.ts` 同源）：
 * - `channel` 映射为 `channelId`（Router 的字段名与 Inbox 列名不同）；
 * - 只取**非空字符串**，空串 / 空白 / 非字符串一律丢弃；
 * - 全空 ⇒ `undefined`（不臆造来源，CS03）。
 */
import { describe, expect, it } from 'bun:test';

import { pickChannelBinding } from '@modules/channels/binding';

describe('pickChannelBinding — 入站元数据 → 渠道绑定', () => {
  it('四个字段齐全 ⇒ 全部带出（channel → channelId）', () => {
    expect(
      pickChannelBinding({
        channel: 'qq',
        channelSessionId: 'c2c:9FF0',
        channelConversationId: 'c2c:9FF0',
        traceId: 'ch_trc_qq_1794322804524_8b15',
      })
    ).toEqual({
      channelId: 'qq',
      channelSessionId: 'c2c:9FF0',
      channelConversationId: 'c2c:9FF0',
      traceId: 'ch_trc_qq_1794322804524_8b15',
    });
  });

  it('空串 / 纯空白 / 非字符串 ⇒ 一律丢弃', () => {
    expect(
      pickChannelBinding({
        channel: '   ',
        channelSessionId: 42,
        channelConversationId: null,
        traceId: '',
      })
    ).toBeUndefined();
  });

  it('无元数据 / 全空 ⇒ undefined（不臆造来源）', () => {
    expect(pickChannelBinding(undefined)).toBeUndefined();
    expect(pickChannelBinding({})).toBeUndefined();
  });

  it('部分字段有值 ⇒ 保留有值项，缺省项为 undefined', () => {
    expect(pickChannelBinding({ channel: 'feishu' })).toEqual({
      channelId: 'feishu',
      channelSessionId: undefined,
      channelConversationId: undefined,
      traceId: undefined,
    });
  });
});
