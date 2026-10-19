/**
 * 渠道消息到达顺序（DEEP-6 回归）
 *
 * 现象：同一会话内快速连发两条消息时，后一条可能先进入 LLM（前一条的
 * 准入/去重等前置步骤耗时更长），导致回复顺序与发送顺序相反。
 *
 * 约束：串行化的**登记点**必须与消息到达同步，不能等到前置步骤完成后再登记。
 */
import { describe, expect, it, spyOn } from 'bun:test';
import type { MessageContext } from '../../src/channels/types/IChannel';
import { routeChannelMessage } from '../../src/channels/routing/messageRouter';
import { getPairingStore } from '../../src/channels/policy/PairingStore';

let seq = 0;

function makeMessage(content: string): MessageContext {
  seq++;
  return {
    channelId: 'telegram',
    senderId: 'order-sender',
    messageId: `order-${Date.now()}-${seq}`,
    messageType: 'text',
    content,
    timestamp: Date.now(),
    isDirectMessage: true,
    conversationId: 'order-conversation',
    rawPayload: {},
  };
}

describe('routeChannelMessage 到达顺序（DEEP-6）', () => {
  it('前一条的准入授权较慢时，后一条不得插队启动 LLM', async () => {
    const seen: string[] = [];
    const coreAPI = {
      chat: async (): Promise<{ content: string }> => ({ content: 'ok' }),
      chatStream: async function* chatStream(request: { content: string }) {
        seen.push(request.content);
        yield { type: 'text', content: 'ok', sessionId: '' } as const;
        return { content: 'ok', finishReason: 'stop' };
      },
    };

    const store = getPairingStore();
    let authCalls = 0;
    const spy = spyOn(store, 'isApproved').mockImplementation(async () => {
      authCalls++;
      // 第一条消息的准入更慢 ⇒ 第二条会先完成前置步骤
      if (authCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return true;
    });

    try {
      const first = makeMessage('first');
      const second = makeMessage('second');
      const options = {
        coreAPI: coreAPI as never,
        channelName: 'telegram',
        dmPolicy: { policy: 'pairing' as const, allowFrom: [] },
      };

      await Promise.all([
        routeChannelMessage(first, options),
        routeChannelMessage(second, options),
      ]);

      expect(seen).toEqual(['first', 'second']);
    } finally {
      spy.mockRestore();
    }
  });
});
