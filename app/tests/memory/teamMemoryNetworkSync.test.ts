/**
 * 团队记忆网络版 Phase 2N-5（2026-11-25）：本机 `Bun.serve` mock 服务端全链集成测试。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §5.2（2N-5）
 * 覆盖：拉取 → 本地改 → 远端并发改导致 412 → 人工采纳 → 再推成功；401/403/429 各一例。
 * 说明：mock 服务端实现了契约 §3.2 的三条端点与 §3.4 的 If-Match/412 语义，仅用于本机测试。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SyncStatus,
  TeamMemorySyncService,
} from '@openliri/infra/memory/services/TeamMemorySyncService';
import { TeamMemorySyncStateStore } from '@openliri/infra/memory/services/TeamMemorySyncStateStore';

interface BunServer {
  port: number;
  stop(): void;
}

interface RemoteMemory {
  id: string;
  content: string;
  version: number;
  etag: string;
  modifiedAt: string;
}

const createdDirs: string[] = [];
const servers: BunServer[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

/** 与客户端同口径：CRLF → LF、去首尾空白后 sha256 */
function hash(text: string): string {
  return createHash('sha256')
    .update(text.replace(/\r\n/g, '\n').trim())
    .digest('hex');
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** 启动 mock 服务端（内存存储；`Authorization` 决定 401/403/429 分支） */
function startServer(): {
  baseUrl: string;
  memories: Map<string, RemoteMemory>;
  putRemote: (id: string, content: string) => RemoteMemory;
} {
  const memories = new Map<string, RemoteMemory>();
  let etagSeq = 0;

  const putRemote = (id: string, content: string): RemoteMemory => {
    const version = (memories.get(id)?.version ?? 0) + 1;
    const memory: RemoteMemory = {
      id,
      content,
      version,
      etag: `e${++etagSeq}`,
      modifiedAt: '2020-01-01T00:00:00.000Z',
    };
    memories.set(id, memory);
    return memory;
  };

  const server = (
    Bun as unknown as {
      serve(options: {
        port: number;
        hostname: string;
        fetch: (req: Request) => Promise<Response> | Response;
      }): BunServer;
    }
  ).serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const auth = req.headers.get('authorization') ?? '';
      if (!auth) return json({ error: { code: 'UNAUTHORIZED' } }, 401);
      if (auth === 'Bearer forbidden') {
        return json({ error: { code: 'FORBIDDEN' } }, 403);
      }
      if (auth === 'Bearer limited') {
        return json({ error: { code: 'RATE_LIMITED' } }, 429);
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'teams' || parts[2] !== 'memories') {
        return json({ error: { code: 'NOT_FOUND' } }, 404);
      }
      const id = parts[3];

      if (!id) {
        const items = Array.from(memories.values()).map((m) => ({
          id: m.id,
          version: m.version,
          contentHash: hash(m.content),
          metadata: {
            createdAt: m.modifiedAt,
            modifiedAt: m.modifiedAt,
            etag: m.etag,
          },
        }));
        const cursor = Math.max(0, ...items.map((i) => i.version));
        return json({ items, nextCursor: cursor, hasMore: false });
      }

      const current = memories.get(id);
      if (req.method === 'GET') {
        if (!current) return json({ error: { code: 'NOT_FOUND' } }, 404);
        return json(
          {
            content: current.content,
            metadata: {
              createdAt: current.modifiedAt,
              modifiedAt: current.modifiedAt,
              etag: current.etag,
            },
          },
          200,
          { ETag: current.etag }
        );
      }

      if (req.method === 'PUT') {
        const body = (await req.json()) as { content?: string };
        const ifMatch = req.headers.get('if-match');
        if (current && ifMatch && ifMatch !== current.etag) {
          return json(
            {
              error: { code: 'ETAG_MISMATCH', message: 'remote changed' },
              current: {
                id,
                version: current.version,
                etag: current.etag,
                content: current.content,
                contentHash: hash(current.content),
              },
            },
            412
          );
        }
        const saved = putRemote(id, String(body.content ?? ''));
        return json({ id, version: saved.version, etag: saved.etag }, 200, {
          ETag: saved.etag,
        });
      }

      return json({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
    },
  });
  servers.push(server);

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    memories,
    putRemote,
  };
}

function makeService(
  baseUrl: string,
  localDir: string,
  token?: string
): TeamMemorySyncService {
  const store = new TeamMemorySyncStateStore(
    join(makeDir('team-net-db-'), 'app.db')
  );
  const service = new TeamMemorySyncService(
    { serverUrl: baseUrl, teamId: 'team-net', localDir },
    store
  );
  if (token) service.setAuthToken(token);
  return service;
}

afterEach(() => {
  while (servers.length > 0) {
    const server = servers.pop();
    try {
      server?.stop();
    } catch {
      // 已停止
    }
  }
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

describe('团队记忆网络版 2N-5 全链（Bun.serve mock）', () => {
  it('拉取 → 本地改 → 412 → 人工采纳 → 再推成功', async () => {
    const { baseUrl, memories, putRemote } = startServer();
    const localDir = makeDir('team-net-local-');
    putRemote('net-m1', 'REMOTE-V1');

    const service = makeService(baseUrl, localDir, 'tok');

    // ① 拉取并落盘
    const pulled = await service.sync();
    expect(pulled.downloaded).toBe(1);
    expect(readFileSync(join(localDir, 'net-m1.md'), 'utf-8').trim()).toBe(
      'REMOTE-V1'
    );

    // ② 本地修改
    writeFileSync(join(localDir, 'net-m1.md'), 'LOCAL-EDIT\n', 'utf-8');

    // ③ 远端并发修改（他人推送）⇒ 本次推送 412，只产候选、不覆盖两侧
    putRemote('net-m1', 'REMOTE-V2');
    const conflicted = await service.sync();
    expect(conflicted.conflicts).toContain('net-m1');
    expect(service.getStatus()).toBe(SyncStatus.CONFLICT);
    expect(readFileSync(join(localDir, 'net-m1.md'), 'utf-8').trim()).toBe(
      'LOCAL-EDIT'
    );
    expect(memories.get('net-m1')?.content).toBe('REMOTE-V2');

    // ④ 人工采纳：本地内容改成与远端一致（下轮判 synced ⇒ 采用远端 etag 作新基线）
    writeFileSync(join(localDir, 'net-m1.md'), 'REMOTE-V2\n', 'utf-8');
    const adopted = await service.sync();
    expect(adopted.conflicts).toEqual([]);
    expect(adopted.uploaded).toBe(0);

    // ⑤ 采纳后做新的本地修改，再推成功（基线已更新为远端 e2）
    writeFileSync(join(localDir, 'net-m1.md'), 'LOCAL-V3\n', 'utf-8');
    const pushed = await service.sync();
    expect(pushed.uploaded).toBe(1);
    expect(pushed.conflicts).toEqual([]);
    expect(memories.get('net-m1')?.content.trim()).toBe('LOCAL-V3');
  });

  it('401（无令牌）⇒ ERROR + lastError，不上抛', async () => {
    const { baseUrl } = startServer();
    const service = makeService(baseUrl, makeDir('team-net-local-'));
    service.setAuthToken(null);

    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(service.getStatus()).toBe(SyncStatus.ERROR);
    expect(service.getLastError() ?? '').toContain('UNAUTHORIZED');
  });

  it('403（非团队成员）⇒ ERROR，不降级为"空团队"', async () => {
    const { baseUrl } = startServer();
    const service = makeService(
      baseUrl,
      makeDir('team-net-local-'),
      'forbidden'
    );

    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(service.getLastError() ?? '').toContain('FORBIDDEN');
  });

  it('429（限流）⇒ ERROR + RATE_LIMITED（进入退避分支）', async () => {
    const { baseUrl } = startServer();
    const service = makeService(baseUrl, makeDir('team-net-local-'), 'limited');

    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(service.getStatus()).toBe(SyncStatus.ERROR);
    expect(service.getLastError() ?? '').toContain('RATE_LIMITED');
  });
});
