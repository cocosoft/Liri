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

import {
  CHANNEL_CATALOG,
  describeChannelUnavailable,
  isChannelDroppedByBuild,
} from '../../src/channels/ChannelCatalog.js';

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

  /**
   * 目录基线（**棘轮**）：新增/删除通道时必须同步更新此处 +1/−1 ——
   * 目的不是"禁止变更"，而是让目录变更**必须显式确认**。
   * 2026-10-20：26 → 27（新增 `mobile` 接入通道）。
   */
  const CATALOG_BASELINE = 27;

  it(`条目总数与开关一致（${CATALOG_BASELINE} / ${CATALOG_BASELINE - 1} / 0）`, () => {
    if (feature('DROP_CHANNELS_ALL')) {
      expect(CHANNEL_CATALOG).toHaveLength(0);
    } else if (feature('DROP_CHANNEL_FEISHU')) {
      expect(CHANNEL_CATALOG).toHaveLength(CATALOG_BASELINE - 1);
    } else {
      expect(CHANNEL_CATALOG).toHaveLength(CATALOG_BASELINE);
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

  /**
   * 拆桶后（2026-10-20）：通道实现**只**能经 `CHANNEL_CATALOG[].load()` 拿到。
   * 本用例守住这条链：`exportKey` 必须真的存在于 `load()` 的结果上 —— 否则桶删了、
   * 加载器又对不上，就是"通道静默消失"的隐性回归（此前被桶的再导出掩盖）。
   */
  it('load() 与 exportKey 一致（拆桶后加载链不空转）', async () => {
    if (feature('DROP_CHANNELS_ALL')) return; // 整组裁剪下无可加载条目
    const types = feature('DROP_CHANNEL_FEISHU')
      ? ['telegram', 'email']
      : ['telegram', 'feishu', 'email'];
    for (const type of types) {
      const entry = CHANNEL_CATALOG.find((e) => e.type === type);
      expect(entry).toBeDefined();
      const mod = await entry!.load();
      expect(typeof mod[entry!.exportKey]).not.toBe('undefined');
    }
  });
});

/**
 * R4（主包瘦身）：被裁通道的**可读错误** —— 裁掉与"拼错 type"必须给出不同指引。
 * 判据是"目录里有没有该条目"与 `isChannelDroppedByBuild()` 是否一致。
 */
describe('ChannelCatalog · 被裁通道的可读错误（R4）', () => {
  it('「裁掉」与「未登记」两种文案互斥，且都带 type 名', () => {
    const dropped = isChannelDroppedByBuild('feishu');
    const text = describeChannelUnavailable('feishu');
    const inCatalog = CHANNEL_CATALOG.some((e) => e.type === 'feishu');

    expect(text).toContain('feishu');
    // 目录成员的"有无"必须与裁剪判定同向 —— 否则文案会误导用户去改凭据
    expect(inCatalog).toBe(!dropped);
    if (dropped) {
      expect(text).toContain('编译期裁掉');
      expect(text).not.toContain('拼写错误');
    } else {
      expect(text).toContain('未在 CHANNEL_CATALOG 中登记');
      expect(text).not.toContain('编译期裁掉');
    }
  });

  it('未知 type 的文案可直接定位（不回落到笼统的 Channel not found）', () => {
    const text = describeChannelUnavailable('no-such-channel');
    expect(text).toContain('no-such-channel');
  });
});
