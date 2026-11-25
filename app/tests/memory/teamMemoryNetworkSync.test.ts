/**
 * 团队记忆网络版 Phase 2N-5（2026-11-25）：本机 `Bun.serve` mock 服务端全链集成测试。
 *
 * 规格：`.trae/specs/team-memory-sync.md` §5.2（2N-5）
 * 覆盖：拉取 → 本地改 → 远端并发改导致 412 → 人工采纳 → 再推成功；401/403/429 各一例。
 * 说明：mock 服务端实现了契约 §3.2 的三条端点与 §3.4 的 If-Match/412 语义，仅用于本机测试。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
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
  deletedAt: string | null;
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

/** 启动 mock 服务端（内存存储；`Authorization` 决定 401/403/429 分支）
 *
 * `honorCursor=true` ⇒ 列表按契约 §3.6 只返回 `version > cursor` 的条目（增量语义）；
 * 默认返回全量，保持既有用例的"快照"假设。
 */
function startServer(options: { honorCursor?: boolean } = {}): {
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
      deletedAt: null,
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
        const cursorParam = Number(url.searchParams.get('cursor') ?? 0);
        const all = Array.from(memories.values());
        const visible =
          options.honorCursor && Number.isFinite(cursorParam) && cursorParam > 0
            ? all.filter((m) => m.version > cursorParam)
            : all;
        const items = visible.map((m) => ({
          id: m.id,
          version: m.version,
          contentHash: hash(m.content),
          deletedAt: m.deletedAt,
          metadata: {
            createdAt: m.modifiedAt,
            modifiedAt: m.modifiedAt,
            etag: m.etag,
          },
        }));
        const cursor = Math.max(0, ...all.map((m) => m.version));
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

      if (req.method === 'DELETE') {
        if (!current) return json({ error: { code: 'NOT_FOUND' } }, 404);
        const ifMatch = req.headers.get('if-match');
        if (ifMatch && ifMatch !== current.etag) {
          return json(
            {
              error: { code: 'ETAG_MISMATCH' },
              current: { id, etag: current.etag },
            },
            412
          );
        }
        const tombstone: RemoteMemory = {
          ...current,
          version: current.version + 1,
          etag: `e${++etagSeq}`,
          deletedAt: '2026-11-25T00:00:00.000Z',
        };
        memories.set(id, tombstone);
        return json(
          { id, version: tombstone.version, deletedAt: tombstone.deletedAt },
          200
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

    // 候选落在**本服务配置的**团队目录（隔离目录），不写用户真实数据目录
    const candidates = JSON.parse(
      readFileSync(join(localDir, 'conflicts.json'), 'utf-8')
    ) as { candidates: Array<{ id: string; source?: string }> };
    expect(
      candidates.candidates.some(
        (candidate) =>
          candidate.id === 'net-m1' && candidate.source === 'network'
      )
    ).toBe(true);

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

  /** 制造一次网络冲突（拉取 → 本地改 → 远端并发改 ⇒ 412） */
  async function makeConflict(baseUrl: string, localDir: string) {
    const service = makeService(baseUrl, localDir, 'tok');
    await service.sync();
    writeFileSync(join(localDir, 'net-m1.md'), 'LOCAL-EDIT\n', 'utf-8');
    return service;
  }

  it('人工采纳 keep_local ⇒ 清除基线 + 候选移除，下次推送覆盖远端', async () => {
    const { baseUrl, memories, putRemote } = startServer();
    const localDir = makeDir('team-net-local-');
    putRemote('net-m1', 'REMOTE-V1');
    const service = await makeConflict(baseUrl, localDir);

    putRemote('net-m1', 'REMOTE-V2');
    const conflicted = await service.sync();
    expect(conflicted.conflicts).toContain('net-m1');

    const resolved = await service.resolveNetworkConflict(
      'net-m1',
      'keep_local'
    );
    expect(resolved).toBe(true);

    const pushed = await service.sync();
    expect(pushed.uploaded).toBe(1);
    expect(pushed.conflicts).toEqual([]);
    expect(memories.get('net-m1')?.content.trim()).toBe('LOCAL-EDIT');

    const candidates = JSON.parse(
      readFileSync(join(localDir, 'conflicts.json'), 'utf-8')
    ) as { candidates: Array<{ id: string }> };
    expect(candidates.candidates.some((c) => c.id === 'net-m1')).toBe(false);
  });

  it('人工采纳 keep_shared ⇒ 远端正文落本地 + 候选移除', async () => {
    const { baseUrl, memories, putRemote } = startServer();
    const localDir = makeDir('team-net-local-');
    putRemote('net-m1', 'REMOTE-V1');
    const service = await makeConflict(baseUrl, localDir);

    putRemote('net-m1', 'REMOTE-V2');
    const conflicted = await service.sync();
    expect(conflicted.conflicts).toContain('net-m1');

    const resolved = await service.resolveNetworkConflict(
      'net-m1',
      'keep_shared'
    );
    expect(resolved).toBe(true);
    expect(readFileSync(join(localDir, 'net-m1.md'), 'utf-8').trim()).toBe(
      'REMOTE-V2'
    );

    const next = await service.sync();
    expect(next.conflicts).toEqual([]);
    expect(memories.get('net-m1')?.content).toBe('REMOTE-V2');

    const candidates = JSON.parse(
      readFileSync(join(localDir, 'conflicts.json'), 'utf-8')
    ) as { candidates: Array<{ id: string }> };
    expect(candidates.candidates.some((c) => c.id === 'net-m1')).toBe(false);
  });

  it('本地删除 ⇒ 软删远端，且下次拉取不复活（2N-6）', async () => {
    const { baseUrl, memories, putRemote } = startServer();
    const localDir = makeDir('team-net-local-');
    putRemote('net-m1', 'REMOTE-V1');
    const service = makeService(baseUrl, localDir, 'tok');

    await service.sync();
    expect(existsSync(join(localDir, 'net-m1.md'))).toBe(true);

    rmSync(join(localDir, 'net-m1.md'));
    const deleted = await service.sync();
    expect(deleted.deleted).toBe(1);
    expect(deleted.errors).toEqual([]);
    expect(memories.get('net-m1')?.deletedAt).toBeTruthy();

    // 下一轮拉到墓碑：本地无文件 ⇒ 不下载、不复活、无错误
    const next = await service.sync();
    expect(next.errors).toEqual([]);
    expect(existsSync(join(localDir, 'net-m1.md'))).toBe(false);
  });

  it('本地删除 + 远端已变 ⇒ 只记 delete 候选，确认后软删远端（2N-6）', async () => {
    const { baseUrl, memories, putRemote } = startServer();
    const localDir = makeDir('team-net-local-');
    putRemote('net-m1', 'REMOTE-V1');
    const service = makeService(baseUrl, localDir, 'tok');

    await service.sync();
    putRemote('net-m1', 'REMOTE-V2'); // 远端在本地删除前已变化（etag 不再是基线）
    rmSync(join(localDir, 'net-m1.md'));

    const conflicted = await service.sync();
    expect(conflicted.deleted).toBe(0);
    expect(conflicted.conflicts).toContain('net-m1');
    expect(memories.get('net-m1')?.deletedAt ?? null).toBeNull(); // 未自动删除

    const file = JSON.parse(
      readFileSync(join(localDir, 'conflicts.json'), 'utf-8')
    ) as { candidates: Array<{ id: string; directions: string[] }> };
    expect(file.candidates.find((c) => c.id === 'net-m1')?.directions).toEqual([
      'delete',
    ]);

    const resolved = await service.resolveNetworkConflict(
      'net-m1',
      'keep_local'
    );
    expect(resolved).toBe(true);
    expect(memories.get('net-m1')?.deletedAt).toBeTruthy();
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

  it('本地命中密钥 ⇒ 只拒发该条，不计入 errors，审计 rejectedSecrets（2N-9）', async () => {
    const { baseUrl, memories } = startServer();
    const localDir = makeDir('team-net-local-');
    // `sk-proj-` 命中 openai-project-key 规则（见 MemorySecretScanner）
    writeFileSync(
      join(localDir, 'net-secret.md'),
      'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\n',
      'utf-8'
    );
    writeFileSync(join(localDir, 'net-ok.md'), 'plain content\n', 'utf-8');
    const service = makeService(baseUrl, localDir, 'tok');

    const result = await service.sync();

    // 拒发算"策略性拒发"，不算同步失败：其余条目照常上传
    expect(result.rejected).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.uploaded).toBe(1);
    expect(result.success).toBe(true);
    expect(memories.has('net-secret')).toBe(false);
    expect(memories.has('net-ok')).toBe(true);

    // 审计口径：`rejectedSecrets` 不再恒为 0
    const lines = readFileSync(join(localDir, 'sync-history.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    const last = JSON.parse(lines[lines.length - 1]) as {
      rejectedSecrets?: number;
      errors?: number;
    };
    expect(last.rejectedSecrets).toBe(1);
    expect(last.errors).toBe(0);
  });

  it('增量列表（version>cursor）⇒ 未变条目不再重复上传，本地改后才推（2N-12）', async () => {
    const { baseUrl, memories, putRemote } = startServer({ honorCursor: true });
    const localDir = makeDir('team-net-local-');
    putRemote('net-m1', 'REMOTE-V1');
    const service = makeService(baseUrl, localDir, 'tok');

    const first = await service.sync();
    expect(first.downloaded).toBe(1);

    // 第二轮：增量列表为空（远端未变）⇒ 不重复 PUT、远端 version 不涨
    const second = await service.sync();
    expect(second.uploaded).toBe(0);
    expect(second.downloaded).toBe(0);
    expect(second.skipped).toBe(1);
    expect(memories.get('net-m1')?.version).toBe(1);

    // 本地编辑 ⇒ 仍会推送（`If-Match` 用上次基线）
    writeFileSync(join(localDir, 'net-m1.md'), 'LOCAL-EDIT\n', 'utf-8');
    const third = await service.sync();
    expect(third.uploaded).toBe(1);
    expect(memories.get('net-m1')?.content.trim()).toBe('LOCAL-EDIT');

    // 第四轮：再次"两边都没变"⇒ 不再上传
    const fourth = await service.sync();
    expect(fourth.uploaded).toBe(0);
  });

  it('fullSync（2N-8 手动全量）⇒ 清基线后重新拉回本地误删的条目', async () => {
    const { baseUrl, putRemote } = startServer();
    const localDir = makeDir('team-net-local-');
    putRemote('net-m1', 'REMOTE-V1');
    const service = makeService(baseUrl, localDir, 'tok');

    await service.sync();
    expect(readFileSync(join(localDir, 'net-m1.md'), 'utf-8').trim()).toBe(
      'REMOTE-V1'
    );

    // 本地误删文件后若走普通 sync，会被判成"本地删除"并软删远端（2N-6）；
    // fullSync 先清空基线 ⇒ 按 remote_only 重新下载，是恢复入口而非删除入口。
    rmSync(join(localDir, 'net-m1.md'));

    const result = await service.fullSync();

    expect(result.downloaded).toBe(1);
    expect(result.deleted).toBe(0);
    expect(readFileSync(join(localDir, 'net-m1.md'), 'utf-8').trim()).toBe(
      'REMOTE-V1'
    );
  });
});
