/**
 * 2026-11-25：伙伴域实时推送的前端接线。
 *
 * 服务端已验证会广播 `buddy:hatched` / `buddy:growth`（SSE 抓包）；
 * 这里锁定前端行为：订阅这两个事件 ⇒ 重新拉取 `/v1/buddy/companion` 与 `/stats`，
 * 不再在本地累加经验。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  getBuddy: vi.fn(async () => ({
    name: '阿兔兔',
    level: 1,
    experience: 80,
    experienceToNext: 100,
  })),
  getStats: vi.fn(async () => ({
    interactions: 10,
    dreamsCompleted: 1,
    totalXp: 80,
  })),
}));

vi.mock('../services/sseService', () => ({
  sseService: {
    on: (event: string, handler: () => void) => {
      h.handlers.set(event, handler);
    },
    off: () => {
      /* noop */
    },
  },
}));

vi.mock('../services/userService', () => ({
  buddyService: {
    getBuddy: h.getBuddy,
    getStats: h.getStats,
    interact: vi.fn(),
  },
}));

describe('buddyStore 实时刷新（SSE）', () => {
  beforeAll(async () => {
    await import('../stores/buddyStore');
  });

  it('订阅 buddy:hatched 与 buddy:growth', () => {
    expect(h.handlers.has('buddy:hatched')).toBe(true);
    expect(h.handlers.has('buddy:growth')).toBe(true);
  });

  it('收到事件 ⇒ 重新拉取伙伴快照与统计', async () => {
    h.getBuddy.mockClear();
    h.getStats.mockClear();

    h.handlers.get('buddy:growth')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.getBuddy).toHaveBeenCalledTimes(1);
    expect(h.getStats).toHaveBeenCalledTimes(1);
  });
});
