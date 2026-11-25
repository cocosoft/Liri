/**
 * 团队记忆网络版 Phase 2N-3（2026-11-25）：墓碑归档 + 下载真实落盘。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §3.2 / §5.2（2N-3）
 * 覆盖：远端 `deletedAt` ⇒ 本地 `.trash` 归档（不物理删除、不复活）· 墓碑无本地文件 ⇒ 无事可做 ·
 * 远端新增/较新 ⇒ 下载真正写入本地 · 下载缺正文 ⇒ 如实报错（不假成功）· 不安全 id 拒绝落盘。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SyncStatus,
  TeamMemorySyncService,
} from '@openliri/infra/memory/services/TeamMemorySyncService';
import { TeamMemorySyncStateStore } from '@openliri/infra/memory/services/TeamMemorySyncStateStore';

const originalFetch = globalThis.fetch;
const createdDirs: string[] = [];

function makeDirs(): {
  root: string;
  localDir: string;
  store: TeamMemorySyncStateStore;
} {
  const root = mkdtempSync(join(tmpdir(), 'team-sync-tombstone-'));
  createdDirs.push(root);
  const localDir = join(root, 'team-memory');
  mkdirSync(localDir, { recursive: true });
  return {
    root,
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
    };
    captured.push(request);
    return handler(request);
  }) as typeof fetch;
  return captured;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 列表响应（单页、无更多） */
function list(items: unknown[]): Response {
  return json({ items, nextCursor: items.length, hasMore: false });
}

function makeService(
  localDir: string,
  store: TeamMemorySyncStateStore
): TeamMemorySyncService {
  return new TeamMemorySyncService(
    { serverUrl: 'http://srv.test', teamId: 'team-tomb', localDir },
    store
  );
}

describe('团队记忆同步 Phase 2N-3 墓碑与下载落盘', () => {
  it('远端 deletedAt ⇒ 本地文件归档到 .trash（不物理删除、不推回服务端）', async () => {
    const { localDir, store } = makeDirs();
    writeFileSync(join(localDir, 'm1.md'), 'LOCAL-BODY', 'utf-8');

    const captured = installFetch((request) =>
      request.pathname.endsWith('/memories')
        ? list([
            {
              id: 'm1',
              content: '',
              version: 3,
              deletedAt: '2026-11-25T00:00:00.000Z',
              metadata: { createdAt: '', modifiedAt: '', etag: 'W/"3-del"' },
            },
          ])
        : json({ content: 'SHOULD-NOT-DOWNLOAD' })
    );

    const result = await makeService(localDir, store).sync();

    expect(result.success).toBe(true);
    expect(result.archived).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.downloaded).toBe(0);
    // 本地正文已移入 .trash（可还原），原位置不再存在
    expect(existsSync(join(localDir, 'm1.md'))).toBe(false);
    const trash = readdirSync(join(localDir, '.trash'));
    expect(trash.some((name) => name.startsWith('m1.'))).toBe(true);
    // 没有被推回服务端（不复活）
    expect(captured.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('墓碑但本地无文件 ⇒ 归档数 0、无错误', async () => {
    const { localDir, store } = makeDirs();
    installFetch(() =>
      list([
        {
          id: 'gone',
          version: 2,
          deletedAt: '2026-11-25T00:00:00.000Z',
          metadata: { createdAt: '', modifiedAt: '', etag: 'e-gone' },
        },
      ])
    );

    const result = await makeService(localDir, store).sync();

    expect(result.success).toBe(true);
    expect(result.archived).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('远端新增 ⇒ 下载真正写入本地（不再只取 etag）', async () => {
    const { localDir, store } = makeDirs();
    installFetch((request) =>
      request.pathname.endsWith('/memories')
        ? list([
            {
              id: 'r1',
              version: 1,
              contentHash: 'h1',
              metadata: { createdAt: '', modifiedAt: '', etag: 'e1' },
            },
          ])
        : json({ content: 'REMOTE-BODY\n', metadata: { etag: 'e1' } })
    );

    const result = await makeService(localDir, store).sync();

    expect(result.downloaded).toBe(1);
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(localDir, 'r1.md'), 'utf-8').trim()).toBe(
      'REMOTE-BODY'
    );
  });

  it('下载缺正文 ⇒ 如实报错（不写空文件、不假成功）', async () => {
    const { localDir, store } = makeDirs();
    installFetch((request) =>
      request.pathname.endsWith('/memories')
        ? list([
            {
              id: 'r2',
              version: 1,
              metadata: { createdAt: '', modifiedAt: '', etag: 'e2' },
            },
          ])
        : json({ metadata: { etag: 'e2' } })
    );

    const service = makeService(localDir, store);
    const result = await service.sync();

    expect(result.downloaded).toBe(0);
    expect(result.success).toBe(false);
    expect(service.getStatus()).toBe(SyncStatus.ERROR);
    expect(result.errors.join(' ')).toContain('DOWNLOAD_CONTENT_MISSING');
    expect(existsSync(join(localDir, 'r2.md'))).toBe(false);
  });

  it('不安全 id（路径穿越）⇒ 拒绝落盘，且不写出团队目录', async () => {
    const { root, localDir, store } = makeDirs();
    installFetch((request) =>
      request.pathname.endsWith('/memories')
        ? list([
            {
              id: '../escape',
              version: 1,
              metadata: { createdAt: '', modifiedAt: '', etag: 'e3' },
            },
          ])
        : json({ content: 'PWNED' })
    );

    const result = await makeService(localDir, store).sync();

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Unsafe memory id');
    expect(existsSync(join(root, 'escape.md'))).toBe(false);
    expect(existsSync(join(localDir, '..', 'escape.md'))).toBe(false);
  });
});
