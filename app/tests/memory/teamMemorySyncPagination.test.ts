/**
 * 团队记忆网络版 Phase 2N-1（2026-11-25）：cursor 分页 + 断点续传 + etag 落库。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §3.2 / §3.6 / §5.2（2N-1）
 * 覆盖：两页拉取（cursor 推进）· 重启续传（cursor 从库读回）· incremental=false 单页全量。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SyncStatus,
  TeamMemorySyncService,
} from '@openliri/infra/memory/services/TeamMemorySyncService';
import { TeamMemorySyncStateStore } from '@openliri/infra/memory/services/TeamMemorySyncStateStore';

const originalFetch = globalThis.fetch;
const createdDirs: string[] = [];

function makeStore(): TeamMemorySyncStateStore {
  const dir = mkdtempSync(join(tmpdir(), 'team-sync-state-'));
  createdDirs.push(dir);
  return new TeamMemorySyncStateStore(join(dir, 'app.db'));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

interface ListCall {
  cursor: string | null;
  limit: string | null;
}

/** 列表接口按 cursor 返回两页；单条接口返回固定条目 */
function installPagingFetch(): ListCall[] {
  const calls: ListCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const isList = url.pathname.endsWith('/memories');
    if (!isList) {
      return new Response(
        JSON.stringify({
          content: 'single',
          metadata: { createdAt: '', modifiedAt: '', etag: 'e1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const cursor = url.searchParams.get('cursor');
    calls.push({ cursor, limit: url.searchParams.get('limit') });
    const numeric = Number(cursor ?? 0);
    const page =
      numeric === 0
        ? {
            items: [
              {
                id: 'a',
                content: 'A',
                version: 1,
                etag: 'e1',
                metadata: { createdAt: '', modifiedAt: '', etag: 'e1' },
              },
            ],
            nextCursor: 1,
            hasMore: true,
          }
        : numeric === 1
          ? {
              items: [
                {
                  id: 'b',
                  content: 'B',
                  version: 2,
                  etag: 'e2',
                  metadata: { createdAt: '', modifiedAt: '', etag: 'e2' },
                },
              ],
              nextCursor: 2,
              hasMore: false,
            }
          : { items: [], nextCursor: numeric, hasMore: false };
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function makeService(
  store: TeamMemorySyncStateStore,
  incremental = true
): TeamMemorySyncService {
  return new TeamMemorySyncService(
    {
      serverUrl: 'http://srv.test',
      teamId: 'team-page',
      incremental,
    },
    store
  );
}

describe('团队记忆同步 Phase 2N-1 分页与续传', () => {
  it('两页拉取：cursor 0 → 1，cursor 与 etag 落库', async () => {
    const store = makeStore();
    const calls = installPagingFetch();
    const service = makeService(store);

    const result = await service.sync();

    expect(result.success).toBe(true);
    expect(calls.map((c) => c.cursor)).toEqual(['0', '1']);
    expect(calls[0].limit).toBe('100');

    const state = await store.get('team-page');
    expect(state?.cursor).toBe(2);
    expect(state?.etags).toEqual({ a: 'e1', b: 'e2' });
    expect(state?.lastSyncAt).not.toBeNull();
  });

  it('重启续传：新实例从库里读回 cursor（不从头拉）', async () => {
    const store = makeStore();
    installPagingFetch();
    await makeService(store).sync();

    const calls = installPagingFetch();
    const restarted = makeService(store);
    const result = await restarted.sync();

    expect(result.success).toBe(true);
    expect(calls.map((c) => c.cursor)).toEqual(['2']);
  });

  it('incremental=false ⇒ 单页全量（不带 cursor 参数）', async () => {
    const store = makeStore();
    const calls = installPagingFetch();
    const service = makeService(store, false);

    await service.sync();

    expect(calls).toHaveLength(1);
    expect(calls[0].cursor).toBeNull();
    expect(calls[0].limit).toBe('100');
  });

  it('失败 ⇒ 状态 ERROR 且 lastError 落库（cursor 保留）', async () => {
    const store = makeStore();
    installPagingFetch();
    await makeService(store).sync(); // 先建立 cursor=2

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const service = makeService(store);
    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(service.getStatus()).toBe(SyncStatus.ERROR);
    const state = await store.get('team-page');
    expect(state?.cursor).toBe(2);
    expect(state?.lastError).toContain('UNAUTHORIZED');
  });
});
