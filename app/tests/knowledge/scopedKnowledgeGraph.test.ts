/**
 * ScopedKnowledgeGraph（多租户 P1）—— 注入 `KnowledgeRouter` 的图谱代理
 *
 * 锁四件事：
 *  ① 本地身份（无请求作用域）⇒ 共享 `app.db`，与改造前等价；
 *  ② 已认证身份 ⇒ `<data>/tenants/<t>/users/<u>/app.db`，且**读不到**本地写入的边；
 *  ③ 同一身份重复调用复用同一实例；并发首调只建一次；
 *  ④ `cleanupOrphans` 等下游实际调用经代理后仍作用于**当前身份**的库。
 *
 * 为什么必须验证"读不到"：`KnowledgeRouter` 是进程级单实例，若图谱被钉在共享库，
 * 租户的 GraphRAG 检索会读到别人的图谱（本代理存在的唯一理由）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import { ScopedKnowledgeGraph } from '../../src/knowledge/graph/ScopedKnowledgeGraph';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

let dataDir: string;
let graph: ScopedKnowledgeGraph;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'scoped-kg-'));
  process.env.LIRI_DATA_DIR = dataDir;
  graph = new ScopedKnowledgeGraph();
});

afterEach(async () => {
  await graph.close();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：未关闭的 SQLite 连接可能持有目录锁（EBUSY）⇒ 保留临时目录由系统清理。
  }
});

/** 代理的内部实例表（白盒，仅用于验证"复用 / 不共享"） */
function internals(): { local: unknown; scoped: Map<string, unknown> } {
  return graph as unknown as { local: unknown; scoped: Map<string, unknown> };
}

describe('ScopedKnowledgeGraph：按身份取图谱实例', () => {
  it('本地身份 ⇒ 共享 app.db；租户读不到本地写入的边', async () => {
    await graph.init();
    await graph.addEdge({ from: 'local:a', to: 'local:b', type: 'related' });

    expect(existsSync(join(dataDir, 'app.db'))).toBe(true);
    expect((await graph.queryEdges({})).map((e) => e.from)).toEqual([
      'local:a',
    ]);

    const aliceEdges = await runWithPrincipal(ALICE, async () => {
      await graph.addEdge({ from: 'alice:a', to: 'alice:b', type: 'related' });
      return graph.queryEdges({});
    });

    expect(aliceEdges.map((e) => e.from)).toEqual(['alice:a']);
    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(true);

    // 反向：租户写入不回流本地库
    expect((await graph.queryEdges({})).map((e) => e.from)).toEqual([
      'local:a',
    ]);
  });

  it('同一身份复用实例；不同身份各自建实例', async () => {
    await runWithPrincipal(ALICE, () => graph.init());
    const aliceInstance = internals().scoped.get('acme:alice');

    await runWithPrincipal(ALICE, () => graph.init());
    expect(internals().scoped.size).toBe(1);
    expect(internals().scoped.get('acme:alice')).toBe(aliceInstance);

    await runWithPrincipal(BOB, () => graph.init());
    expect(internals().scoped.size).toBe(2);
    expect(internals().scoped.get('acme:bob')).not.toBe(aliceInstance);
  });

  it('并发首调只建一次（pending 去重）', async () => {
    await runWithPrincipal(ALICE, () =>
      Promise.all([graph.init(), graph.init(), graph.init()])
    );
    expect(internals().scoped.size).toBe(1);
  });

  it('cleanupOrphans 经代理作用于当前身份的库', async () => {
    await runWithPrincipal(ALICE, async () => {
      await graph.addEdge({ from: 'keep:x', to: 'keep:y', type: 'related' });
      await graph.addEdge({ from: 'keep:x', to: 'gone:z', type: 'related' });
    });

    const removed = await runWithPrincipal(ALICE, () =>
      graph.cleanupOrphans(new Set(['keep:x', 'keep:y']))
    );
    expect(removed).toBe(1);

    // 本地库不受影响（本就无边）
    expect(await graph.cleanupOrphans(new Set(['keep:x']))).toBe(0);
  });
});
