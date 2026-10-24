/**
 * DB 按身份分库（多租户 P1）
 *
 * 锁三件事：
 *  ① 已认证身份取到的 store 实例**不同**于本地实例（不是"共享实例换连接"）；
 *  ② 该身份的库文件落在 `<data>/tenants/<t>/users/<u>/app.db`；
 *  ③ 本地身份仍写共享 `<data>/app.db`（零变更）。
 *
 * 为什么必须"分实例"而不是"换连接"：这些 store 的 `this.db` 是单字段，
 * `await init()` 与后续 SQL 之间存在异步交错点 ⇒ 换连接会让并发请求串到别人的库。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import {
  getExecutionStore,
  resetExecutionStore,
} from '../../src/execution/ExecutionStore';
import { getCostRecordRepository } from '../../src/cost/CostRecordRepository';
import { getCheckpointDatabase } from '../../src/chat/services/CheckpointDatabase';
import { InboxManager } from '../../src/runtime/InboxManager';
import {
  getQueryLogStore,
  resetQueryLogStore,
} from '../../src/query/QueryLogStore';
import { getLLMTracker } from '../../src/monitoring/llm/getLLMTracker';
import { BalanceStore } from '../../src/ai/providers/BalanceStore';
import {
  getSettlementOutbox,
  resetSettlementOutboxForTest,
} from '../../src/chat/yield/SettlementOutbox';
import {
  getSessionRouterStore,
  resetSessionRouterStoreForTest,
} from '../../src/ai/router/SessionRouterStore';
import { KnowledgeGraph } from '../../src/knowledge/graph/KnowledgeGraph';
import { getProviderManager } from '../../src/ai/providers/ProviderManager';
import { getCredentialStore } from '../../src/ai/credentials/CredentialStore';
import { Database } from '@openliri/kernel/external/sqlite3';
import { resolveContextWindowAsync } from '../../src/utils/ContextWindowResolver';

const ALICE: Principal = {
  tenantId: 'acme',
  userId: 'alice',
  roles: ['user'],
};
const BOB: Principal = {
  tenantId: 'acme',
  userId: 'bob',
  roles: ['user'],
};

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tenant-db-'));
  process.env.LIRI_DATA_DIR = dataDir;
  resetExecutionStore();
  resetQueryLogStore();
  resetSettlementOutboxForTest();
  resetSessionRouterStoreForTest();
});

afterEach(() => {
  resetExecutionStore();
  resetQueryLogStore();
  resetSettlementOutboxForTest();
  resetSessionRouterStoreForTest();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows：未关闭的 SQLite 连接持有目录锁（EBUSY）⇒ 保留临时目录，由系统清理。
    // 该行为只影响测试隔离目录，不影响断言（断言均在删除前完成）。
  }
});

describe('ExecutionStore：按身份分实例', () => {
  it('已认证身份 ⇒ 独立实例 + 独立库文件；本地仍用共享库', async () => {
    const local = getExecutionStore();
    const alice = await runWithPrincipal(ALICE, async () => {
      const store = getExecutionStore();
      await store.init();
      return store;
    });

    expect(alice).not.toBe(local);

    const aliceDb = join(
      dataDir,
      'tenants',
      'acme',
      'users',
      'alice',
      'app.db'
    );
    expect(existsSync(aliceDb)).toBe(true);

    // 本地库不应出现在 tenants/ 下；且本地实例未初始化 ⇒ 共享 app.db 尚未创建（不臆造）
    expect(existsSync(join(dataDir, 'app.db'))).toBe(false);
  });

  it('两个身份拿到不同实例（互不共享连接）', () => {
    const alice = runWithPrincipal(ALICE, () => getExecutionStore());
    const bob = runWithPrincipal(BOB, () => getExecutionStore());
    expect(alice).not.toBe(bob);
  });
});

describe('CostRecordRepository：按身份分实例', () => {
  it('已认证身份 ⇒ 独立实例', () => {
    const local = getCostRecordRepository();
    const alice = runWithPrincipal(ALICE, () => getCostRecordRepository());
    expect(alice).not.toBe(local);
  });
});

describe('CheckpointDatabase：按身份分实例（经身份感知代理）', () => {
  it('代理每次调用按当前身份取库 ⇒ 两个身份拿到不同实例', () => {
    const local = getCheckpointDatabase();
    const alice = runWithPrincipal(ALICE, () => getCheckpointDatabase());
    const bob = runWithPrincipal(BOB, () => getCheckpointDatabase());
    expect(alice).not.toBe(local);
    expect(alice).not.toBe(bob);
  });
});

describe('InboxManager：审批库按身份分区', () => {
  it('已认证身份取连接 ⇒ 落在自己的 tenants 目录，本地共享库未被创建', async () => {
    const mgr = new InboxManager();
    // 白盒：getDb 是连接唯一入口（所有公开方法都保存为局部变量后使用）
    await runWithPrincipal(ALICE, () =>
      (mgr as unknown as { getDb: () => Promise<unknown> }).getDb()
    );

    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(true);
    expect(existsSync(join(dataDir, 'app.db'))).toBe(false);
  });
});

describe('QueryLogStore：租户级库 + 行级隔离（§6.1 期 2 试点）', () => {
  it('同租户两个用户拿到**同一实例**（同一个租户库文件）', () => {
    const local = getQueryLogStore();
    const alice = runWithPrincipal(ALICE, () => getQueryLogStore());
    const bob = runWithPrincipal(BOB, () => getQueryLogStore());

    expect(alice).not.toBe(local);
    expect(bob).toBe(alice);
  });

  it('写入落到 `tenants/acme/app.db`（不再建 users/<u> 目录），且 alice 的行对 bob 不可见', async () => {
    await runWithPrincipal(ALICE, () =>
      getQueryLogStore().log({
        sessionId: 's-alice',
        type: 'api_call',
        model: 'm',
        promptTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        durationMs: 1,
        success: true,
        timestamp: Date.now(),
      })
    );

    expect(existsSync(join(dataDir, 'tenants', 'acme', 'app.db'))).toBe(true);
    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(false);

    const bobRows = await runWithPrincipal(BOB, () =>
      getQueryLogStore().query()
    );
    expect(bobRows).toEqual([]);

    const aliceRows = await runWithPrincipal(ALICE, () =>
      getQueryLogStore().query()
    );
    expect(aliceRows.map((r) => r.sessionId)).toEqual(['s-alice']);
  });
});

describe('LLMTracker：按身份分实例', () => {
  it('两个身份拿到不同实例；分区实例**同步**开库（首条记录即可落库）', () => {
    const local = getLLMTracker();
    const alice = runWithPrincipal(ALICE, () => getLLMTracker());
    expect(alice).not.toBe(local);

    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(true);
  });
});

describe('BalanceStore：按身份分实例', () => {
  it('已认证身份 ⇒ 独立实例', () => {
    const local = BalanceStore.getInstance();
    const alice = runWithPrincipal(ALICE, () => BalanceStore.getInstance());
    expect(alice).not.toBe(local);
  });
});

describe('SettlementOutbox：按身份分实例', () => {
  it('已认证身份 ⇒ 独立实例 + 独立库文件', async () => {
    const local = getSettlementOutbox();
    const alice = await runWithPrincipal(ALICE, async () => {
      const outbox = getSettlementOutbox();
      await outbox.init();
      return outbox;
    });
    expect(alice).not.toBe(local);
    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(true);
  });
});

describe('SessionRouterStore：按身份分实例', () => {
  it('已认证身份 ⇒ 独立实例 + 独立库文件', async () => {
    const local = await getSessionRouterStore();
    const alice = await runWithPrincipal(ALICE, () => getSessionRouterStore());
    expect(alice).not.toBeNull();
    expect(local).not.toBeNull();
    expect(alice).not.toBe(local);
    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(true);
  });
});

describe('ProviderManager：按身份分实例', () => {
  it('已认证身份 ⇒ 独立实例（内存注册表与 DB 都不共享）', () => {
    const local = getProviderManager();
    const alice = runWithPrincipal(ALICE, () => getProviderManager());
    const bob = runWithPrincipal(BOB, () => getProviderManager());
    expect(alice).not.toBe(local);
    expect(alice).not.toBe(bob);
  });
});

describe('CredentialStore：按身份分实例（与 ProviderManager 同源分区）', () => {
  it('已认证身份 ⇒ 独立实例；写入落到 <scoped>/credentials.json', () => {
    const local = getCredentialStore();
    const alice = runWithPrincipal(ALICE, () => getCredentialStore());
    expect(alice).not.toBe(local);

    runWithPrincipal(ALICE, () => getCredentialStore().set('pid-1', 'sk-test'));
    expect(
      existsSync(
        join(dataDir, 'tenants', 'acme', 'users', 'alice', 'credentials.json')
      )
    ).toBe(true);
    // 本地凭据文件不应被写入（`~/.pyapp/credentials.json` 不在 dataDir 下，这里只验证分区侧）
    expect(
      runWithPrincipal(ALICE, () => getCredentialStore().get('pid-1'))
    ).toBe('sk-test');
    expect(getCredentialStore().get('pid-1')).toBeUndefined();
  });
});

describe('ContextWindowResolver：DB 读取路径随身份', () => {
  it('租户请求读自己的 model_registry（本地读不到）', async () => {
    const dir = join(dataDir, 'tenants', 'acme', 'users', 'alice');
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, 'app.db'));
    db.run(
      'CREATE TABLE IF NOT EXISTS model_registry (model_id TEXT, context_window INTEGER)'
    );
    db.run(
      "INSERT INTO model_registry (model_id, context_window) VALUES ('tenant-only-model', 123456)"
    );

    const scoped = await runWithPrincipal(ALICE, () =>
      resolveContextWindowAsync('tenant-only-model')
    );
    expect(scoped.tokens).toBe(123456);

    const local = await resolveContextWindowAsync('tenant-only-model');
    expect(local.tokens).not.toBe(123456);
  });
});

describe('KnowledgeGraph：构造期按身份解析库路径', () => {
  it('已认证作用域内 new ⇒ 落到自己的库；默认构造本地仍共享', async () => {
    const scoped = new KnowledgeGraph();
    // 本地（无作用域）⇒ 共享路径：init 后共享 app.db 出现
    await scoped.init();
    expect(existsSync(join(dataDir, 'app.db'))).toBe(true);

    const aliceGraph = await runWithPrincipal(ALICE, async () => {
      const graph = new KnowledgeGraph();
      await graph.init();
      return graph;
    });
    expect(aliceGraph).not.toBe(scoped);
    expect(
      existsSync(join(dataDir, 'tenants', 'acme', 'users', 'alice', 'app.db'))
    ).toBe(true);
  });
});
