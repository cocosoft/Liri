/**
 * U-01 方案 A（2026-10-20 用户裁定）：主动消息投递目标 = **显式配置才外发**。
 *
 * 核心口径：`proactive.target.channelId` 与 `conversationId` **同时**非空才走 `channel`；
 * 其余一律 `local`（写通知中心，不外发）。负向对照优先。
 */
import { describe, expect, it } from 'bun:test';

import {
  resolveProactiveTarget,
  type ProactiveTargetConfigPort,
} from '../../src/proactive/ProactiveTargetResolver';
import { buildCronProactivePayload } from '../../src/proactive/ProactiveCronProducer';

function port(values: Record<string, unknown>): ProactiveTargetConfigPort {
  return {
    getValue: (key: string) => values[key],
  };
}

describe('resolveProactiveTarget（配置兜底）', () => {
  it('两项都配 ⇒ channel 目标', () => {
    expect(
      resolveProactiveTarget(
        port({
          'proactive.target.channelId': 'telegram',
          'proactive.target.conversationId': '12345',
        })
      )
    ).toEqual({
      mode: 'channel',
      channelId: 'telegram',
      conversationId: '12345',
    });
  });

  it('只配一项 ⇒ local（不外发）', () => {
    expect(
      resolveProactiveTarget(port({ 'proactive.target.channelId': 'telegram' }))
    ).toEqual({ mode: 'local' });
    expect(
      resolveProactiveTarget(
        port({ 'proactive.target.conversationId': '12345' })
      )
    ).toEqual({ mode: 'local' });
  });

  it('空串 / 纯空白 / 非字符串 ⇒ 视为未配置（local）', () => {
    for (const values of [
      {
        'proactive.target.channelId': '',
        'proactive.target.conversationId': '1',
      },
      {
        'proactive.target.channelId': '   ',
        'proactive.target.conversationId': '1',
      },
      {
        'proactive.target.channelId': 42,
        'proactive.target.conversationId': '1',
      },
      {
        'proactive.target.channelId': null,
        'proactive.target.conversationId': null,
      },
    ]) {
      expect(
        resolveProactiveTarget(port(values as Record<string, unknown>))
      ).toEqual({ mode: 'local' });
    }
  });

  it('完全未配置 ⇒ local', () => {
    expect(resolveProactiveTarget(port({}))).toEqual({ mode: 'local' });
  });

  it('首尾空白被裁剪（避免 IM id 带空格导致投递失败）', () => {
    expect(
      resolveProactiveTarget(
        port({
          'proactive.target.channelId': ' telegram ',
          'proactive.target.conversationId': ' 12345 ',
        })
      )
    ).toEqual({
      mode: 'channel',
      channelId: 'telegram',
      conversationId: '12345',
    });
  });
});

describe('buildCronProactivePayload（目标参数）', () => {
  const input = {
    job: { id: 'j1', name: 'job' },
    result: { success: true },
    title: 't',
    body: 'b',
  };

  it('缺省目标 ⇒ local（保持现状）', () => {
    expect(buildCronProactivePayload(input, 1_700_000_000_000).target).toEqual({
      mode: 'local',
    });
  });

  it('传入 channel 目标 ⇒ 原样落载荷', () => {
    expect(
      buildCronProactivePayload(input, 1_700_000_000_000, {
        mode: 'channel',
        channelId: 'feishu',
        conversationId: 'cid',
      }).target
    ).toEqual({ mode: 'channel', channelId: 'feishu', conversationId: 'cid' });
  });
});
