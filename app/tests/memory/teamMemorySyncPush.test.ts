/**
 * 团队记忆网络版 Phase 2N-2（2026-11-25）：推送契约与冲突候选。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §3.2 / §3.4 / §5.2（2N-2）
 * 覆盖：上传 body（contentHash/accessLevel）· `If-Match` 基线 · 412 ⇒ 冲突候选（不覆盖）·
 * 成功上传后 etag 落库。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveTeamMemoryDir } from '@openliri/infra/environment';
import {
  SyncStatus,
  TeamMemorySyncService,
} from '@openliri/infra/memory/services/TeamMemorySyncService';
import { TeamMemorySyncStateStore } from '@openliri/infra/memory/services/TeamMemorySyncStateStore';

const originalFetch = globalThis.fetch;
const createdDirs: string[] = [];

function makeDirs(): { localDir: string; store: TeamMemorySyncStateStore } {
  const root = mkdtempSync(join(tmpdir(), 'team-sync-push-'));
  createdDirs.push(root);
  const localDir = join(root, 'team-memory');
  mkdirSync(localDir, { recursive: true });
  return {
    localDir,
    store: new TeamMemorySyncStateStore(join(root, 'app.db')),
  };
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

interface Captured {
  method: string;
  pathname: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (request: Captured) => Response): Captured[] {
  const captured: Captured[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const request: Captured = {
      method: init?.method ?? 'GET',
      pathname: url.pathname,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    captured.push(request);
    return handler(request);
  }) as typeof fetch;
  return captured;
}

const hash = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

function makeService(
  localDir: string,
  store: TeamMemorySyncStateStore
): TeamMemorySyncService {
  return new TeamMemorySyncService(
    {
      serverUrl: 'http://srv.test',
      teamId: 'team-push',
      localDir,
      accessLevel: 'team',
    },
    store
  );
}

describe('团队记忆同步 Phase 2N-2 推送', () => {
  it('412 ⇒ 记录冲突候选、不覆盖任一侧、状态 CONFLICT', async () => {
    const { localDir, store } = makeDirs();
    writeFileSync(join(localDir, 'm1.md'), 'LOCAL', 'utf-8');

    const captured = installFetch((request) => {
      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'm1',
                content: 'REMOTE',
                version: 2,
                contentHash: hash('REMOTE'),
                metadata: {
                  createdAt: '2020-01-01T00:00:00.000Z',
                  modifiedAt: '2020-01-01T00:00:00.000Z',
                  etag: 'W/"2-remote"',
                },
              },
            ],
            nextCursor: 2,
            hasMore: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          error: { code: 'ETAG_MISMATCH' },
          current: { content: 'REMOTE', contentHash: hash('REMOTE') },
        }),
        { status: 412, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const service = makeService(localDir, store);
    service.setAuthToken('tok');
    const result = await service.sync();

    expect(result.conflicts).toContain('m1');
    expect(result.success).toBe(true); // 冲突不是"上传失败"
    expect(service.getStatus()).toBe(SyncStatus.CONFLICT);

    const put = captured.find((request) => request.method === 'PUT');
    expect(put).toBeDefined();
    expect(put?.headers.Authorization).toBe('Bearer tok');
    expect(put?.headers['If-Match']).toBe('W/"2-remote"');
    const body = JSON.parse(put?.body ?? '{}') as {
      content?: string;
      contentHash?: string;
      accessLevel?: string;
    };
    expect(body.content).toBe('LOCAL');
    expect(body.contentHash).toBe(hash('LOCAL'));
    expect(body.accessLevel).toBe('team');

    // 只尝试一次（不自动覆盖、不重试）
    expect(captured.filter((request) => request.method === 'PUT')).toHaveLength(
      1
    );

    // 候选落 conflicts.json（与共享目录版同一审阅入口）
    const conflicts = JSON.parse(
      readFileSync(join(resolveTeamMemoryDir(), 'conflicts.json'), 'utf-8')
    ) as {
      candidates: Array<{
        id: string;
        source?: string;
        localHash: string | null;
        sharedHash: string | null;
      }>;
    };
    const candidate = conflicts.candidates.find((c) => c.id === 'm1');
    expect(candidate?.source).toBe('network');
    expect(candidate?.localHash).toBe(hash('LOCAL'));
    expect(candidate?.sharedHash).toBe(hash('REMOTE'));
  });

  it('上传成功 ⇒ 新 etag 落库（作为下次 If-Match 基线）', async () => {
    const { localDir, store } = makeDirs();
    writeFileSync(join(localDir, 'm2.md'), 'NEW', 'utf-8');

    installFetch((request) =>
      request.method === 'GET'
        ? new Response(
            JSON.stringify({ items: [], nextCursor: 0, hasMore: false }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        : new Response(JSON.stringify({ id: 'm2', version: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ETag: 'W/"1-new"' },
          })
    );

    const service = makeService(localDir, store);
    const result = await service.sync();

    expect(result.uploaded).toBe(1);
    expect(result.errors).toEqual([]);
    const state = await store.get('team-push');
    expect(state?.etags.m2).toBe('W/"1-new"');
  });
});
