/**
 * B-3（2026-10-18）：`ChannelId` 开放标识守卫。
 *
 * 三件事：① 已知清单与 `CHANNEL_CATALOG` 双向一致（防「类型有、目录漏」）；
 * ② 第三方通道 id 可直接使用，而 `KnownChannelId` 仍保持闭合（拼错编译失败）；
 * ③ 外部字符串走 `parseChannelId` 边界校验（`DeliveryTarget.parse` 已接线）。
 */
import { describe, it, expect } from 'bun:test';

import { CHANNEL_CATALOG } from '../../src/channels/ChannelCatalog.js';
import { DeliveryTarget } from '../../src/channels/DeliveryTarget.js';
import {
  KNOWN_CHANNEL_IDS,
  parseChannelId,
} from '../../src/channels/types/IChannel.js';
import type {
  ChannelId,
  KnownChannelId,
} from '../../src/channels/types/IChannel.js';

describe('B-3 ChannelId 开放标识', () => {
  it('已知清单与目录双向一致，且目录无重复 type', () => {
    const catalogTypes = CHANNEL_CATALOG.map((entry) => entry.type);
    for (const id of KNOWN_CHANNEL_IDS) {
      expect(catalogTypes).toContain(id);
    }
    const known = new Set<string>(KNOWN_CHANNEL_IDS);
    for (const type of catalogTypes) {
      expect(known.has(type)).toBe(true);
    }
    expect(new Set(catalogTypes).size).toBe(catalogTypes.length);
  });

  it('第三方通道 id 可直接赋值给 ChannelId；KnownChannelId 仍闭合', () => {
    const custom: ChannelId = 'acme-corp';
    expect(custom).toBe('acme-corp');

    const known: KnownChannelId = 'telegram';
    expect(known).toBe('telegram');

    // @ts-expect-error 已知集合保持闭合（故意拼错 ⇒ 编译失败）
    const typo: KnownChannelId = 'telegramm';
    expect(typo).toBe('telegramm');
  });

  it('parseChannelId：合法 / 空串 / 含空白 / 非字符串', () => {
    expect(parseChannelId('telegram')).toBe('telegram');
    expect(parseChannelId(' acme-corp ')).toBe('acme-corp');
    expect(parseChannelId('')).toBeUndefined();
    expect(parseChannelId('   ')).toBeUndefined();
    expect(parseChannelId('a b')).toBeUndefined();
    expect(parseChannelId(42)).toBeUndefined();
    expect(parseChannelId(null)).toBeUndefined();
  });

  it('DeliveryTarget.parse 接线：脏平台串 ⇒ null，第三方 id 可用', () => {
    expect(DeliveryTarget.parse(':chat')).toBeNull();
    expect(DeliveryTarget.parse('   :chat')).toBeNull();
    expect(DeliveryTarget.parse('a b:chat')).toBeNull();
    expect(DeliveryTarget.parse('acme-corp:chat')?.platform).toBe('acme-corp');
    expect(DeliveryTarget.parse('telegram:chat:thread')?.threadId).toBe(
      'thread'
    );
  });
});
