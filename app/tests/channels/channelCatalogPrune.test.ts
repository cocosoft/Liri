/**
 * P1：通道目录的**编译期裁剪**语义（反向 DROP 开关，2026-10-20）。
 *
 * 三层开关（`与` 关系）：
 * - `DROP_CHANNELS_ALL` 声明 ⇒ **整组**条目与其 `import()` 目标（含各通道 SDK）一起消失；
 * - 否则 `DROP_CHANNEL_FEISHU` 声明 ⇒ 仅飞书条目消失；
 * - 两者都未声明 ⇒ 全量 26 条（**默认零行为变更**）。
 *
 * 为什么用 if 分支而不是表驱动断言：`bun:bundle` 的 `feature()` **只能**用于 if / 三元条件，
 * 当值使用会直接抛 `feature() … can only be used directly in an if statement or ternary condition`。
 */
import { describe, expect, it } from 'bun:test';
import { feature } from 'bun:bundle';

import { CHANNEL_CATALOG } from '../../src/channels/ChannelCatalog.js';

describe('ChannelCatalog · 编译期裁剪（DROP_CHANNEL_FEISHU / DROP_CHANNELS_ALL）', () => {
  it('飞书条目随开关有无（默认保留）', () => {
    const feishu = CHANNEL_CATALOG.find((e) => e.type === 'feishu');
    if (feature('DROP_CHANNELS_ALL')) {
      expect(feishu).toBeUndefined();
    } else if (feature('DROP_CHANNEL_FEISHU')) {
      expect(feishu).toBeUndefined();
    } else {
      expect(feishu).toBeDefined();
      expect(feishu?.exportKey).toBe('feishuChannel');
      expect(feishu?.credentials).toEqual([
        'FEISHU_APP_ID',
        'FEISHU_APP_SECRET',
      ]);
    }
  });

  it('条目总数与开关一致（26 / 25 / 0）', () => {
    if (feature('DROP_CHANNELS_ALL')) {
      expect(CHANNEL_CATALOG).toHaveLength(0);
    } else if (feature('DROP_CHANNEL_FEISHU')) {
      expect(CHANNEL_CATALOG).toHaveLength(25);
    } else {
      expect(CHANNEL_CATALOG).toHaveLength(26);
    }
  });

  it('单通道裁剪不影响其它通道', () => {
    if (feature('DROP_CHANNELS_ALL')) {
      expect(CHANNEL_CATALOG).toHaveLength(0);
      return;
    }
    for (const type of ['telegram', 'wechat', 'slack', 'email']) {
      expect(CHANNEL_CATALOG.some((e) => e.type === type)).toBe(true);
    }
  });

  it('目录内 type 不重复（裁剪不引入重复项）', () => {
    const types = CHANNEL_CATALOG.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
