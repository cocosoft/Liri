/**
 * 出站重试安全（N10，2026-10-19）
 *
 * 约束：只有「请求必然未送达」的错误才允许重试一次；
 * 超时/连接重置等**不确定态**必须立即停止，避免同一条消息发两遍。
 */
import { describe, expect, it } from 'bun:test';
import { DeliveryRouter } from '../../src/channels/DeliveryRouter';
import type { DeliveryContent } from '../../src/channels/DeliveryRouter';

type TrySendFormat = (
  channel: unknown,
  target: string,
  content: DeliveryContent,
  steps: string[]
) => Promise<unknown>;

function makeChannel(sendText: () => Promise<boolean>) {
  return {
    name: 'test-channel',
    capabilities: { interactive: false },
    meta: { markdownCapable: false },
    plugin: { outbound: { sendText } },
  };
}

function codeError(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

describe('DeliveryRouter 文本重试安全', () => {
  it('pre_send 错误 ⇒ 重试一次（共两次调用）', async () => {
    let calls = 0;
    const channel = makeChannel(async () => {
      calls++;
      throw codeError('ECONNREFUSED');
    });
    const router = new DeliveryRouter();

    const result = await (
      router as unknown as { _trySendFormat: TrySendFormat }
    )._trySendFormat(
      channel,
      'target',
      { format: 'text', content: 'hello' },
      []
    );

    expect(result).toBeNull();
    expect(calls).toBe(2);
  });

  it('不确定态（超时）⇒ 不重试且返回“可能已送达”失败态', async () => {
    let calls = 0;
    const channel = makeChannel(async () => {
      calls++;
      throw codeError('ETIMEDOUT');
    });
    const router = new DeliveryRouter();

    const result = (await (
      router as unknown as { _trySendFormat: TrySendFormat }
    )._trySendFormat(
      channel,
      'target',
      { format: 'text', content: 'hello' },
      []
    )) as { success: boolean; actualFormat: string; error?: string } | null;

    expect(calls).toBe(1);
    expect(result?.success).toBe(false);
    expect(result?.actualFormat).toBe('text');
    expect(result?.error).toContain('可能已送达');
  });

  it('首次成功 ⇒ 只调用一次并返回成功', async () => {
    let calls = 0;
    const channel = makeChannel(async () => {
      calls++;
      return true;
    });
    const router = new DeliveryRouter();

    const result = (await (
      router as unknown as { _trySendFormat: TrySendFormat }
    )._trySendFormat(
      channel,
      'target',
      { format: 'text', content: 'hello' },
      []
    )) as { success: boolean; actualFormat: string } | null;

    expect(calls).toBe(1);
    expect(result?.success).toBe(true);
    expect(result?.actualFormat).toBe('text');
  });

  it('interactive 不确定态 ⇒ 不再降级到 markdown（避免换格式重发）', async () => {
    let markdownCalls = 0;
    const channel = {
      name: 'test-channel',
      capabilities: { interactive: true },
      meta: { markdownCapable: true },
      plugin: {
        outbound: {
          sendInteractive: async () => {
            throw codeError('ECONNRESET');
          },
          sendMarkdown: async () => {
            markdownCalls++;
            return true;
          },
        },
      },
    };
    const router = new DeliveryRouter();

    const result = (await (
      router as unknown as {
        _sendWithFallback: (
          c: unknown,
          t: string,
          content: DeliveryContent
        ) => Promise<{ success: boolean; actualFormat: string }>;
      }
    )._sendWithFallback(channel, 'target', {
      format: 'interactive',
      card: { title: 't', content: '', buttons: [] },
      fallbackText: 'c',
    })) as { success: boolean; actualFormat: string };

    expect(markdownCalls).toBe(0);
    expect(result.success).toBe(false);
    expect(result.actualFormat).toBe('interactive');
  });

  it('interactive pre_send 错误 ⇒ 保留原有降级（markdown 接管）', async () => {
    let markdownCalls = 0;
    const channel = {
      name: 'test-channel',
      capabilities: { interactive: true },
      meta: { markdownCapable: true },
      plugin: {
        outbound: {
          sendInteractive: async () => {
            throw codeError('ECONNREFUSED');
          },
          sendMarkdown: async () => {
            markdownCalls++;
            return true;
          },
        },
      },
    };
    const router = new DeliveryRouter();

    const result = (await (
      router as unknown as {
        _sendWithFallback: (
          c: unknown,
          t: string,
          content: DeliveryContent
        ) => Promise<{ success: boolean; actualFormat: string }>;
      }
    )._sendWithFallback(channel, 'target', {
      format: 'interactive',
      card: { title: 't', content: '', buttons: [] },
      fallbackText: 'c',
    })) as { success: boolean; actualFormat: string };

    expect(markdownCalls).toBe(1);
    expect(result.success).toBe(true);
    expect(result.actualFormat).toBe('markdown');
  });
});
