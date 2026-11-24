/**
 * 方案 B（2026-11-25）：AutoDream 是否真正执行必须可判定。
 *
 * 回归点：旧实现返回 `void`，`UnifiedDreamCycle` 无法区分"跑了但失败"与
 * "被 minHours/节流/会话数门槛静默跳过" ⇒ 周期完成但伙伴侧无任何事件。
 * 现在返回 boolean，调用方在 `false` 时补发周期级 `DREAM_COMPLETED`。
 */
import { describe, expect, it } from 'bun:test';
import { executeAutoDream } from '@openliri/infra/chronos';

describe('executeAutoDream：跳过信号', () => {
  it('未初始化（runner 未注册）⇒ false，调用方可据此补发事件', async () => {
    expect(await executeAutoDream()).toBe(false);
    expect(await executeAutoDream({ force: true })).toBe(false);
  });
});
