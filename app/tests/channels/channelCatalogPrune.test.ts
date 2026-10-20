/**
 * P1-0：通道目录的**编译期裁剪**语义（反向 DROP 开关，2026-10-20）。
 *
 * - 默认（未声明 `DROP_CHANNEL_FEISHU`）⇒ 飞书条目保留（与改造前逐字一致，**零行为变更**）；
 * - 构建/运行时传 `--feature=DROP_CHANNEL_FEISHU` ⇒ 条目消失，产物中连同
 *   `@larksuiteoapi/node-sdk`（实测 5.94 MB）一起被删除。
 *
 * 为什么用 if 分支而不是表驱动断言：`bun:bundle` 的 `feature()` **只能**用于 if / 三元条件，
 * 当值使用会直接抛 `feature() … can only be used directly in an if statement or ternary condition`。
 */
import { describe, expect, it } from 'bun:test';
import { feature } from 'bun:bundle';

import { CHANNEL_CATALOG } from '../../src/channels/ChannelCatalog.js';

describe('ChannelCatalog · 编译期裁剪（DROP_CHANNEL_FEISHU）', () => {
  it('飞书条目随开关有无（默认保留）', () => {
    const feishu = CHANNEL_CATALOG.find((e) => e.type === 'feishu');
    if (feature('DROP_CHANNEL_FEISHU')) {
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

  it('条目总数与开关一致（26 / 25）', () => {
    if (feature('DROP_CHANNEL_FEISHU')) {
      expect(CHANNEL_CATALOG).toHaveLength(25);
    } else {
      expect(CHANNEL_CATALOG).toHaveLength(26);
    }
  });

  it('裁剪只作用于被声明的通道（其它条目不受影响）', () => {
    for (const type of ['telegram', 'wechat', 'slack', 'email']) {
      expect(CHANNEL_CATALOG.some((e) => e.type === type)).toBe(true);
    }
  });

  it('目录内 type 不重复（裁剪不引入重复项）', () => {
    const types = CHANNEL_CATALOG.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
