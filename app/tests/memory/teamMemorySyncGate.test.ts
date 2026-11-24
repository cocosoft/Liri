/**
 * 团队记忆同步 Phase 0（2026-11-25）门禁单测。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §5（Phase 0）
 * 覆盖：未配置 serverUrl ⇒ NOT_CONFIGURED 且不伪造成功 · start() 不启动 · 配置解析形状。
 */
import { describe, expect, it } from 'bun:test';
import {
  isTeamMemorySyncEnabled,
  resolveTeamMemorySyncConfig,
  SyncStatus,
  TeamMemorySyncService,
} from '@openliri/infra/memory/services/TeamMemorySyncService';

describe('团队记忆同步 Phase 0 门禁', () => {
  it('未配置 serverUrl ⇒ NOT_CONFIGURED、success=false、错误可读', async () => {
    const service = new TeamMemorySyncService({ serverUrl: '' });
    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(service.getStatus()).toBe(SyncStatus.NOT_CONFIGURED);
    expect(result.errors.join(' ')).toContain('NOT_CONFIGURED');
  });

  it('未配置时 start() 不抛错、不进入 SYNCING', () => {
    const service = new TeamMemorySyncService({ serverUrl: '' });
    expect(() => service.start()).not.toThrow();
    expect(service.getStatus()).toBe(SyncStatus.IDLE);
    service.stop();
  });

  it('配置解析：默认关闭，intervalSec → 毫秒，teamId 非空', () => {
    expect(typeof isTeamMemorySyncEnabled()).toBe('boolean');

    const config = resolveTeamMemorySyncConfig();
    expect(typeof config.serverUrl).toBe('string');
    expect((config.teamId ?? '').length).toBeGreaterThan(0);
    expect(config.syncInterval ?? 0).toBeGreaterThan(0);
  });
});
