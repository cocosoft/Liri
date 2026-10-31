// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `MailChannelHandler` 真伪口径（2026-10-31，P0.5）。
 *
 * 缺陷：`sendFromChannel` 只打一行 info「渠道邮件发送」后**什么都不做**却正常返回；
 * `registerTools()` 声称「MailChannelHandler 工具已注册」但**零注册**。
 * 口径：与 `DocChannelHandler`（G-12）一致 —— 未接线一律**显式报错**，不假装成功。
 */
import { describe, expect, it } from 'bun:test';
import { MailChannelHandler } from '../../src/modules/mail/channel/MailChannelHandler';

describe('MailChannelHandler：未接线必须如实报错', () => {
  it('sendFromChannel ⇒ 抛 MAIL_CHANNEL_UNIMPLEMENTED（不再静默成功）', async () => {
    const handler = new MailChannelHandler();
    await expect(
      handler.sendFromChannel('chan-1', {
        to: 'a@b.c',
        subject: '周报',
        body: '正文',
      })
    ).rejects.toMatchObject({
      code: 'MAIL_CHANNEL_UNIMPLEMENTED',
      message: expect.stringContaining('未实现'),
    });
  });

  it('registerTools ⇒ 不抛错、零副作用（不再声称"已注册"）', () => {
    const handler = new MailChannelHandler();
    expect(() => handler.registerTools()).not.toThrow();
    expect(handler.registerTools()).toBeUndefined();
  });
});
