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
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '../../src/core/identity/principal';
import { runWithPrincipal } from '../../src/core/identity/requestScope';
import {
  getExecutionStore,
  resetExecutionStore,
} from '../../src/execution/ExecutionStore';
import { getCostRecordRepository } from '../../src/cost/CostRecordRepository';
import { getCheckpointDatabase } from '../../src/chat/services/CheckpointDatabase';

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
});

afterEach(() => {
  resetExecutionStore();
  delete process.env.LIRI_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
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
