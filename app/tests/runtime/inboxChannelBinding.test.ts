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
 * Inbox 渠道绑定补齐（2026-11-11）。
 *
 * 背景：`inbox_items.channel_id` / `channel_session_id` / `trace_id` 此前在生产从未被写入
 * （真机库 171 条全空）⇒ reply 回传无触发源、IM 文本审批定位不到待办。
 * 补齐点收敛在 `InboxManager.submit`（唯一提交入口），由宿主注入 resolver 提供映射。
 *
 * 锁定三条语义：
 * 1. 注入 resolver 且字段空缺 ⇒ 补齐，并写 `session_inbox_map`（IM 审批查找依赖它）；
 * 2. **显式传入优先**于 resolver（`??` 语义）；
 * 3. 未注入 resolver ⇒ 与改动前逐字一致（零行为变更）。
 */
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import {
  InboxManager,
  setInboxChannelResolver,
} from '@openliri/service/runtime/InboxManager';

const mgr = new InboxManager(':memory:');

afterEach(() => {
  setInboxChannelResolver(null);
});

afterAll(() => {
  mgr.dispose();
});

function submit(
  sessionId: string,
  extra: Record<string, unknown> = {}
): ReturnType<InboxManager['submit']> {
  return mgr.submit({
    sessionId,
    type: 'approval',
    title: '渠道绑定探针',
    message: 'm',
    source: 'test',
    offlineCapable: true,
    ...extra,
  });
}

describe('InboxManager：渠道绑定补齐', () => {
  it('注入 resolver ⇒ 空字段被补齐，session_inbox_map 可反查', async () => {
    setInboxChannelResolver(async () => ({
      channelId: 'qq',
      channelSessionId: 'cs-qq-1',
      channelConversationId: 'c2c:9FF0',
      traceId: 'ch_trc_qq_1_abcd',
    }));

    const item = await submit('sess-bind-1');

    expect(item.channelId).toBe('qq');
    expect(item.channelSessionId).toBe('cs-qq-1');
    expect(item.channelConversationId).toBe('c2c:9FF0');
    expect(item.traceId).toBe('ch_trc_qq_1_abcd');

    // IM 文本审批靠这张映射找到待办
    const byChannelSession = await mgr.getBySession('cs-qq-1');
    expect(byChannelSession.map((i) => i.id)).toContain(item.id);
  });

  it('显式传入优先于 resolver', async () => {
    setInboxChannelResolver(async () => ({ channelId: 'qq' }));

    const item = await submit('sess-bind-2', { channelId: 'feishu' });

    expect(item.channelId).toBe('feishu');
  });

  it('未注入 resolver ⇒ 与改动前一致（三个绑定字段为空）', async () => {
    const item = await submit('sess-bind-3');

    expect(item.channelId).toBeUndefined();
    expect(item.channelSessionId).toBeUndefined();
    expect(item.traceId).toBeUndefined();
  });

  it('resolver 返回 undefined（查不到会话）⇒ 不臆造绑定', async () => {
    setInboxChannelResolver(async () => undefined);

    const item = await submit('sess-bind-4');

    expect(item.channelId).toBeUndefined();
    expect(item.channelSessionId).toBeUndefined();
  });
});
