/**
 * 团队记忆网络版 Phase 2N-0（2026-11-25）：传输层契约单测。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §3.2 / §3.4 / §5.2（2N-0）
 * 覆盖：路径前缀（apiPrefix）· Bearer 头 · 401/403/429 分类上抛（fail-closed，不再吞成"空表"）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  classifyTeamMemoryHttpStatus,
  SyncStatus,
  TeamMemorySyncService,
} from '@openliri/infra/memory/services/TeamMemorySyncService';

const originalFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

function installFetch(
  status: number,
  body: unknown = { memories: [] }
): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = typeof input === 'string' ? input : String(input);
    captured.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeService(apiPrefix?: string): TeamMemorySyncService {
  return new TeamMemorySyncService({
    serverUrl: 'http://srv.test',
    teamId: 'team-a',
    ...(apiPrefix ? { apiPrefix } : {}),
  });
}

describe('团队记忆同步 Phase 2N-0 传输层', () => {
  it('默认前缀 /teams/{teamId}/memories，且带 Bearer 令牌', async () => {
    const captured = installFetch(200);
    const service = makeService();
    service.setAuthToken('tok-123');

    const result = await service.sync();

    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    const url = new URL(captured[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'http://srv.test/teams/team-a/memories'
    );
    expect(url.searchParams.get('cursor')).toBe('0');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(captured[0].headers.Authorization).toBe('Bearer tok-123');
    expect(captured[0].headers.Accept).toBe('application/json');
  });

  it('未设置令牌 ⇒ 不伪造 Authorization 头（由服务端 401 如实暴露）', async () => {
    const captured = installFetch(200);
    const service = makeService();

    await service.sync();

    expect(captured[0].headers.Authorization).toBeUndefined();
  });

  it('apiPrefix 可覆盖（部署需要 /v1 等前缀时只改一处）', async () => {
    const captured = installFetch(200);
    const service = makeService('/v1/teams');

    await service.sync();

    const url = new URL(captured[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'http://srv.test/v1/teams/team-a/memories'
    );
  });

  it('401 ⇒ 同步失败并带 UNAUTHORIZED（fail-closed，不再当作"远端为空"）', async () => {
    installFetch(401, { error: { code: 'UNAUTHORIZED' } });
    const service = makeService();
    service.setAuthToken('bad');

    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(service.getStatus()).toBe(SyncStatus.ERROR);
    expect(result.errors.join(' ')).toContain('UNAUTHORIZED');
  });

  it('429 ⇒ 分类为 RATE_LIMITED（供后续退避重试分支使用）', async () => {
    installFetch(429, { error: { code: 'RATE_LIMITED' } });
    const service = makeService();

    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('RATE_LIMITED');
  });

  it('状态码分类表（契约 §3.4）', () => {
    expect(classifyTeamMemoryHttpStatus(401)).toBe('UNAUTHORIZED');
    expect(classifyTeamMemoryHttpStatus(403)).toBe('FORBIDDEN');
    expect(classifyTeamMemoryHttpStatus(404)).toBe('NOT_FOUND');
    expect(classifyTeamMemoryHttpStatus(409)).toBe('CONFLICT');
    expect(classifyTeamMemoryHttpStatus(412)).toBe('PRECONDITION_FAILED');
    expect(classifyTeamMemoryHttpStatus(428)).toBe('PRECONDITION_REQUIRED');
    expect(classifyTeamMemoryHttpStatus(429)).toBe('RATE_LIMITED');
    expect(classifyTeamMemoryHttpStatus(503)).toBe('SERVER_ERROR');
    expect(classifyTeamMemoryHttpStatus(418)).toBe('HTTP_ERROR');
  });
});
