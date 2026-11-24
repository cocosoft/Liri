/**
 * P0-1（2026-11-25）：`POST /v1/memory/dream` 统一经 `DreamEngine` 触发
 * （与 cron / 空闲触发同一管线：写 `dream_cycles` + 广播 `dream:cycle:completed`）。
 *
 * 回归点：后台维护未启动时**不得**静默回退到"只精炼记忆"，必须如实返回 not_running，
 * 由 handler 报 503（旧实现直调 `runMemoryDream` ⇒ 周期列表 / 伙伴经验不更新）。
 */
import { describe, expect, it } from 'bun:test';
import { triggerManualDream } from '@openliri/infra/chronos/maintenance/ChronosBackgroundHousekeeping';

describe('triggerManualDream：引擎状态如实返回（P0-1）', () => {
  it('未注入/未启动引擎 ⇒ not_running', async () => {
    expect(await triggerManualDream()).toBe('not_running');
  });
});
