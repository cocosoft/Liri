/**
 * 钉钉机器人消息映射契约（2026-10-19）
 *
 * 依据：https://open.dingtalk.com/document/dingstart/robot-receive-message
 *       https://open-dingtalk.github.io/developerpedia/docs/learn/stream/protocol/
 */
import { describe, expect, it } from 'bun:test';
import { parseDingTalkRobotMessage } from '@modules/channels/dingtalk/DingTalkChannel';

const BASE = {
  msgtype: 'text',
  msgId: 'msg-1',
  conversationId: 'cid-abc',
  conversationType: '1',
  senderStaffId: 'staff-1',
  senderNick: '张三',
  createAt: 1700000000000,
  text: { content: '  你好  ' },
};

describe('parseDingTalkRobotMessage（Stream 消息映射）', () => {
  it('单聊：conversationType=1 ⇒ isDirectMessage，senderStaffId 作为 senderId', () => {
    const parsed = parseDingTalkRobotMessage(BASE, 'fallback-id');
    expect(parsed).not.toBeNull();
    expect(parsed!.ctx).toMatchObject({
      channelId: 'dingtalk',
      senderId: 'staff-1',
      senderName: '张三',
      conversationId: 'cid-abc',
      messageId: 'msg-1',
      messageType: 'text',
      content: '你好',
      isDirectMessage: true,
    });
    expect(parsed!.ctx.groupId).toBeUndefined();
  });

  it('群聊：conversationType=2 ⇒ groupId=conversationId，isDirectMessage=false', () => {
    const parsed = parseDingTalkRobotMessage(
      { ...BASE, conversationType: '2' },
      'fallback-id'
    );
    expect(parsed!.ctx.isDirectMessage).toBe(false);
    expect(parsed!.ctx.groupId).toBe('cid-abc');
  });

  it('缺 msgId 时回退到 Stream 帧的 messageId', () => {
    const { msgId: _drop, ...noMsgId } = BASE;
    const parsed = parseDingTalkRobotMessage(noMsgId, 'frame-id');
    expect(parsed!.ctx.messageId).toBe('frame-id');
  });

  it('非文本或空文本 ⇒ null（不抢其它消息路径）', () => {
    expect(
      parseDingTalkRobotMessage({ ...BASE, msgtype: 'picture' }, 'f')
    ).toBeNull();
    expect(
      parseDingTalkRobotMessage({ ...BASE, text: { content: '   ' } }, 'f')
    ).toBeNull();
  });

  it('携带 sessionWebhook 时原样带出（含过期时间）；缺省时不产出该字段', () => {
    const parsed = parseDingTalkRobotMessage(
      {
        ...BASE,
        sessionWebhook:
          'https://oapi.dingtalk.com/robot/sendBySession?session=x',
        sessionWebhookExpiredTime: 1800000000000,
      },
      'f'
    );
    expect(parsed!.sessionWebhook).toEqual({
      conversationId: 'cid-abc',
      senderId: 'staff-1',
      url: 'https://oapi.dingtalk.com/robot/sendBySession?session=x',
      expiresAt: 1800000000000,
    });

    expect(
      parseDingTalkRobotMessage(BASE, 'f')!.sessionWebhook
    ).toBeUndefined();
  });
});
