/**
 * G-06（2026-10-19）：飞书入站图片/文件 **size 回填**契约。
 *
 * 覆盖：下载成功 ⇒ `attachments` 带 `size`（计入预算预留）；下载失败/异常 ⇒
 * 退回纯文本且不阻塞消息处理。
 */
import { describe, expect, test } from 'bun:test';
import { createFeishuChannel } from '../../src/channels/feishu/FeishuChannel';
import type { MessageContext } from '../../src/channels/types';
import type { RegisterFileResult } from '../../src/services/file/types';

type DownloadFn = (
  key: string,
  base: unknown,
  fileName?: string
) => Promise<RegisterFileResult | undefined>;

interface TestablePlugin {
  buildMessageContext(
    event: Record<string, unknown>
  ): Promise<MessageContext | null>;
  downloadFeishuImage: DownloadFn;
  downloadFeishuFile: DownloadFn;
}

function makePlugin(): TestablePlugin {
  return createFeishuChannel() as unknown as TestablePlugin;
}

function event(
  messageType: 'image' | 'file',
  content: Record<string, unknown>
): Record<string, unknown> {
  return {
    sender: { sender_id: { open_id: 'ou_sender' } },
    message: {
      message_type: messageType,
      chat_type: 'p2p',
      chat_id: 'oc_chat',
      content: JSON.stringify(content),
      message_id: 'om_1',
      create_time: '1728800000000',
    },
  };
}

function registered(size: number, savedName: string): RegisterFileResult {
  return {
    action: 'created',
    fileId: `file_${savedName}`,
    savedPath: `/tmp/${savedName}`,
    savedName,
    originalName: savedName,
    md5: 'md5',
    size,
  };
}

describe('飞书入站附件：size 回填', () => {
  test('图片下载成功 ⇒ attachments 带 size（计入预算预留）', async () => {
    const plugin = makePlugin();
    plugin.downloadFeishuImage = async () => registered(2048, 'pic.png');

    const ctx = await plugin.buildMessageContext(
      event('image', { image_key: 'img_1' })
    );

    expect(ctx?.messageType).toBe('text');
    expect(ctx?.attachments).toEqual([
      { fileId: 'file_pic.png', fileName: 'pic.png', size: 2048 },
    ]);
  });

  test('文件下载成功 ⇒ attachments 带 size', async () => {
    const plugin = makePlugin();
    plugin.downloadFeishuFile = async () => registered(4096, 'report.pdf');

    const ctx = await plugin.buildMessageContext(
      event('file', { file_key: 'fk_1', file_name: 'report.pdf' })
    );

    expect(ctx?.attachments).toEqual([
      { fileId: 'file_report.pdf', fileName: 'report.pdf', size: 4096 },
    ]);
  });

  test('下载返回 undefined ⇒ 退回纯文本（无 attachments）', async () => {
    const plugin = makePlugin();
    plugin.downloadFeishuImage = async () => undefined;

    const ctx = await plugin.buildMessageContext(
      event('image', { image_key: 'img_2' })
    );

    expect(ctx?.messageType).toBe('text');
    expect(ctx?.attachments).toBeUndefined();
  });

  test('下载抛错 ⇒ 不阻塞消息处理，仍返回文本上下文', async () => {
    const plugin = makePlugin();
    plugin.downloadFeishuFile = async () => {
      throw new Error('network down');
    };

    const ctx = await plugin.buildMessageContext(
      event('file', { file_key: 'fk_2', file_name: 'a.bin' })
    );

    expect(ctx?.messageType).toBe('text');
    expect(ctx?.attachments).toBeUndefined();
  });
});
