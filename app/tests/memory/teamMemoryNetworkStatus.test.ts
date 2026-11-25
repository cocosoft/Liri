/**
 * 网络版团队记忆同步状态 DTO（2N-4 设置页状态，2026-11-25）。
 *
 * 覆盖：`serverUrl` 为空 ⇒ configured=false；从未同步 ⇒ lastSyncAt=null（不展示 1970）；
 * 有失败 ⇒ lastError 原样透出；成功后 lastError 为 null。
 */
import { describe, expect, it } from 'bun:test';
import { buildTeamMemoryNetworkStatus } from '../../src/infrastructure/http/handlers/teamMemoryNetworkStatus';

function makeSource(overrides: {
  serverUrl?: string;
  teamId?: string;
  status?: string;
  lastSyncTime?: number;
  lastError?: string | null;
}) {
  return {
    getConfig: () => ({
      serverUrl: overrides.serverUrl ?? '',
      teamId: overrides.teamId ?? 'default',
    }),
    getStatus: () => overrides.status ?? 'idle',
    getLastSyncTime: () => overrides.lastSyncTime ?? 0,
    getLastError: () => overrides.lastError ?? null,
  };
}

describe('buildTeamMemoryNetworkStatus', () => {
  it('未配置 serverUrl ⇒ configured=false（默认关）', () => {
    const dto = buildTeamMemoryNetworkStatus(makeSource({}));
    expect(dto.configured).toBe(false);
    expect(dto.lastSyncAt).toBeNull();
    expect(dto.lastError).toBeNull();
  });

  it('已配置 + 已同步 ⇒ 透出 teamId/status/最近同步时间', () => {
    const dto = buildTeamMemoryNetworkStatus(
      makeSource({
        serverUrl: 'https://team.example',
        teamId: 'team-a',
        status: 'success',
        lastSyncTime: 1_763_000_000_000,
      })
    );
    expect(dto.configured).toBe(true);
    expect(dto.teamId).toBe('team-a');
    expect(dto.status).toBe('success');
    expect(dto.lastSyncAt).toBe(1_763_000_000_000);
  });

  it('失败 ⇒ lastError 如实透出（不清空、不脱敏篡改）', () => {
    const dto = buildTeamMemoryNetworkStatus(
      makeSource({
        serverUrl: 'https://team.example',
        status: 'error',
        lastError: 'HTTP 401 UNAUTHORIZED: Unauthorized',
      })
    );
    expect(dto.status).toBe('error');
    expect(dto.lastError).toContain('UNAUTHORIZED');
  });
});
